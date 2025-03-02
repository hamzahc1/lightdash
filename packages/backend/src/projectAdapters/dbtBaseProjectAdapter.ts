import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AnyValidateFunction } from 'ajv/dist/types';
import {
    DbtMetric,
    DbtModelNode,
    DbtPackages,
    DbtRawModelNode,
    Explore,
    ExploreError,
    isSupportedDbtAdapter,
    SupportedDbtAdapter,
} from 'common';
import {
    attachTypesToModels,
    convertExplores,
    getSchemaStructureFromDbtModels,
    normaliseModelDatabase,
} from '../dbt/translator';
import { MissingCatalogEntryError, ParseError } from '../errors';
import Logger from '../logger';
import dbtManifestSchema from '../manifestv4.json';
import lightdashDbtSchema from '../schema.json';
import {
    DbtClient,
    ProjectAdapter,
    WarehouseCatalog,
    WarehouseClient,
} from '../types';

const ajv = new Ajv({ schemas: [lightdashDbtSchema, dbtManifestSchema] });
addFormats(ajv);

const getModelValidator = () => {
    const modelValidator = ajv.getSchema<DbtRawModelNode>(
        'https://schemas.lightdash.com/dbt/manifest/v4.json#/definitions/LightdashCompiledModelNode',
    );
    if (modelValidator === undefined) {
        throw new ParseError('Could not parse Lightdash schema.');
    }
    return modelValidator;
};

const getMetricValidator = () => {
    const metricValidator = ajv.getSchema<DbtMetric>(
        'https://schemas.getdbt.com/dbt/manifest/v4.json#/definitions/ParsedMetric',
    );
    if (metricValidator === undefined) {
        throw new ParseError('Could not parse dbt schema.');
    }
    return metricValidator;
};

const formatAjvErrors = (validator: AnyValidateFunction): string =>
    (validator.errors || [])
        .map((err) => `Field at "${err.instancePath}" ${err.message}`)
        .join('\n');

export class DbtBaseProjectAdapter implements ProjectAdapter {
    dbtClient: DbtClient;

    warehouseClient: WarehouseClient;

    warehouseCatalog: WarehouseCatalog | undefined;

    constructor(dbtClient: DbtClient, warehouseClient: WarehouseClient) {
        this.dbtClient = dbtClient;
        this.warehouseClient = warehouseClient;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function,class-methods-use-this
    async destroy(): Promise<void> {}

    public async test(): Promise<void> {
        Logger.debug('Test dbt client');
        await this.dbtClient.test();
        Logger.debug('Test warehouse client');
        await this.warehouseClient.test();
    }

    public async getDbtPackages(): Promise<DbtPackages | undefined> {
        if (this.dbtClient.getDbtPackages) {
            return this.dbtClient.getDbtPackages();
        }
        return undefined;
    }

    public async compileAllExplores(
        loadSources: boolean = false,
    ): Promise<(Explore | ExploreError)[]> {
        Logger.debug('Install dependencies');
        // Install dependencies for dbt and fetch the manifest - may raise error meaning no explores compile
        await this.dbtClient.installDeps();
        Logger.debug('Get dbt manifest');
        const { manifest } = await this.dbtClient.getDbtManifest();

        // Type of the target warehouse
        if (!isSupportedDbtAdapter(manifest.metadata)) {
            throw new ParseError(
                `Dbt project not supported. Lightdash does not support adapter ${manifest.metadata.adapter_type}`,
                {},
            );
        }
        const adapterType = manifest.metadata.adapter_type;

        // Validate models in the manifest - models with invalid metadata will compile to failed Explores
        const models = Object.values(manifest.nodes).filter(
            (node) => node.resource_type === 'model',
        ) as DbtRawModelNode[];
        Logger.debug(`Validate ${models.length} models in manifest`);
        const [validModels, failedExplores] =
            DbtBaseProjectAdapter._validateDbtModelMetadata(
                adapterType,
                models,
            );

        // Validate metrics in the manifest - compile fails if any invalid
        const metrics = DbtBaseProjectAdapter._validateDbtMetrics(
            Object.values(manifest.metrics),
        );

        // Be lazy and try to attach types to the remaining models without refreshing the catalog
        try {
            Logger.debug(`Attach types to ${validModels.length} models`);
            const lazyTypedModels = attachTypesToModels(
                validModels,
                this.warehouseCatalog || {},
                true,
            );
            Logger.debug('Convert explores');
            const lazyExplores = await convertExplores(
                lazyTypedModels,
                loadSources,
                adapterType,
                metrics,
            );
            return [...lazyExplores, ...failedExplores];
        } catch (e) {
            if (e instanceof MissingCatalogEntryError) {
                Logger.debug(
                    'Get warehouse catalog after missing catalog error',
                );
                this.warehouseCatalog = await this.warehouseClient.getCatalog(
                    getSchemaStructureFromDbtModels(validModels),
                );
                Logger.debug(
                    'Attach types to models after missing catalog error',
                );
                // Some types were missing so refresh the schema and try again
                const typedModels = attachTypesToModels(
                    validModels,
                    this.warehouseCatalog,
                    false,
                );
                Logger.debug('Convert explores after missing catalog error');
                const explores = await convertExplores(
                    typedModels,
                    loadSources,
                    adapterType,
                    metrics,
                );
                return [...explores, ...failedExplores];
            }
            throw e;
        }
    }

    public async runQuery(sql: string): Promise<Record<string, any>[]> {
        // Possible error if query is ran before dependencies are installed
        return this.warehouseClient.runQuery(sql);
    }

    static _validateDbtMetrics(metrics: DbtMetric[]): DbtMetric[] {
        const validator = getMetricValidator();
        metrics.forEach((metric) => {
            const isValid = validator(metric);
            if (!isValid) {
                throw new ParseError(
                    `Could not parse dbt metric with id ${
                        metric.unique_id
                    }: ${formatAjvErrors(validator)}`,
                    {},
                );
            }
        });
        return metrics;
    }

    static _validateDbtModelMetadata(
        adapterType: SupportedDbtAdapter,
        models: DbtRawModelNode[],
    ): [DbtModelNode[], ExploreError[]] {
        const validator = getModelValidator();
        return models.reduce(
            ([validModels, invalidModels], model) => {
                // Match against json schema
                const isValid = validator(model);
                if (isValid) {
                    // Fix null databases
                    const validatedModel = normaliseModelDatabase(
                        model,
                        adapterType,
                    );
                    return [[...validModels, validatedModel], invalidModels];
                }
                const exploreError: ExploreError = {
                    name: model.name,
                    errors: [
                        {
                            type: 'MetadataParseError',
                            message: formatAjvErrors(validator),
                        },
                    ],
                };
                return [validModels, [...invalidModels, exploreError]];
            },
            [[] as DbtModelNode[], [] as ExploreError[]],
        );
    }
}
