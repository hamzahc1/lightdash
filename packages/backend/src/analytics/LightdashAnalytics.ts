/// <reference path="../@types/rudder-sdk-node.d.ts" />
import Analytics, {
    Track as AnalyticsTrack,
} from '@rudderstack/rudder-sdk-node';
import {
    LightdashInstallType,
    ProjectType,
    TableSelectionType,
    WarehouseTypes,
} from 'common';
import { v4 as uuidv4 } from 'uuid';
import { VERSION } from '../version';

type Identify = {
    userId: string;
    traits: {
        email?: string;
        first_name?: string;
        last_name?: string;
        is_tracking_anonymized: boolean;
        is_marketing_opted_in?: boolean;
    };
};
type BaseTrack = Omit<AnalyticsTrack, 'context'>;
type Group = {
    userId: string;
    groupId: string;
    traits: {
        name?: string;
    };
};
type TrackSimpleEvent = BaseTrack & {
    event:
        | 'user.created'
        | 'user.logged_in'
        | 'user.updated'
        | 'password.updated'
        | 'invite_link.created'
        | 'invite_link.all_revoked'
        | 'sql.executed';
};

type QueryExecutionEvent = BaseTrack & {
    event: 'query.executed';
    properties: {
        metricsCount: number;
        dimensionsCount: number;
        tableCalculationsCount: number;
        filtersCount: number;
        sortsCount: number;
        hasExampleMetric: boolean;
    };
};

type TrackOrganizationEvent = BaseTrack & {
    event: 'organization.created' | 'organization.updated';
    properties: {
        type: string;
        organizationId: string;
        organizationName: string;
    };
};

type TrackUserDeletedEvent = BaseTrack & {
    event: 'user.deleted';
    properties: {
        deletedUserUuid: string;
    };
};

type TrackSavedChart = BaseTrack & {
    event:
        | 'saved_chart.created'
        | 'saved_chart.updated'
        | 'saved_chart.deleted'
        | 'saved_chart_version.created';
    properties: {
        savedQueryId: string;
    };
};

type ProjectEvent = BaseTrack & {
    event: 'project.updated' | 'project.created';
    userId: string;
    properties: {
        projectId: string;
        projectType: ProjectType;
        warehouseConnectionType: WarehouseTypes;
    };
};

type ProjectTablesConfigurationEvent = BaseTrack & {
    event: 'project_tables_configuration.updated';
    userId: string;
    properties: {
        projectId: string;
        project_table_selection_type: TableSelectionType;
    };
};

type ProjectCompiledEvent = BaseTrack & {
    event: 'project.compiled';
    userId?: string;
    properties: {
        projectType: ProjectType;
        warehouseType?: WarehouseTypes;
        modelsCount: number;
        modelsWithErrorsCount: number;
        metricsCount: number;
        packagesCount?: number;
    };
};

type ProjectErrorEvent = BaseTrack & {
    event: 'project.error';
    userId?: string;
    properties: {
        name: string;
        statusCode: number;
        projectType: ProjectType;
    };
};

type DashboardEvent = BaseTrack & {
    event:
        | 'dashboard.created'
        | 'dashboard.updated'
        | 'dashboard.deleted'
        | 'dashboard_version.created';
    userId: string;
    properties: {
        dashboardId: string;
    };
};

type ApiErrorEvent = BaseTrack & {
    event: 'api.error';
    userId?: string;
    anonymousId?: string;
    properties: {
        name: string;
        statusCode: number;
        route: string;
        method: string;
    };
};

type Track =
    | TrackSimpleEvent
    | QueryExecutionEvent
    | TrackSavedChart
    | TrackUserDeletedEvent
    | ProjectErrorEvent
    | ApiErrorEvent
    | ProjectEvent
    | ProjectCompiledEvent
    | DashboardEvent
    | ProjectTablesConfigurationEvent
    | TrackOrganizationEvent;

export class LightdashAnalytics extends Analytics {
    static lightdashContext = {
        app: {
            namespace: 'lightdash',
            name: 'lightdash_server',
            version: VERSION,
            installId: process.env.LIGHTDASH_INSTALL_ID || uuidv4(),
            installType:
                process.env.LIGHTDASH_INSTALL_TYPE ||
                LightdashInstallType.UNKNOWN,
        },
    };

    static anonymousId = process.env.LIGHTDASH_INSTALL_ID || uuidv4();

    identify(payload: Identify) {
        super.identify({
            ...payload,
            context: { ...LightdashAnalytics.lightdashContext }, // NOTE: spread because rudderstack manipulates arg
        });
    }

    track(payload: Track) {
        super.track({
            ...payload,
            event: `${LightdashAnalytics.lightdashContext.app.name}.${payload.event}`,
            context: { ...LightdashAnalytics.lightdashContext }, // NOTE: spread because rudderstack manipulates arg
        });
    }

    group(payload: Group) {
        super.group({
            ...payload,
            context: { ...LightdashAnalytics.lightdashContext }, // NOTE: spread because rudderstack manipulates arg
        });
    }
}
