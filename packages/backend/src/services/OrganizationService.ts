import {
    LightdashMode,
    OnbordingRecord,
    OrganizationProject,
    OrganizationUser,
    SessionUser,
} from 'common';
import { analytics } from '../analytics/client';
import { lightdashConfig } from '../config/lightdashConfig';
import { NotExistsError } from '../errors';
import { InviteLinkModel } from '../models/InviteLinkModel';
import { OnboardingModel } from '../models/OnboardingModel/OnboardingModel';
import { OrganizationModel } from '../models/OrganizationModel';
import { ProjectModel } from '../models/ProjectModel/ProjectModel';
import { UserModel } from '../models/UserModel';

type OrganizationServiceDependencies = {
    organizationModel: OrganizationModel;
    userModel: UserModel;
    projectModel: ProjectModel;
    onboardingModel: OnboardingModel;
    inviteLinkModel: InviteLinkModel;
};

export class OrganizationService {
    private readonly organizationModel: OrganizationModel;

    private readonly userModel: UserModel;

    private readonly projectModel: ProjectModel;

    private readonly onboardingModel: OnboardingModel;

    private readonly inviteLinkModel: InviteLinkModel;

    constructor({
        organizationModel,
        userModel,
        projectModel,
        onboardingModel,
        inviteLinkModel,
    }: OrganizationServiceDependencies) {
        this.organizationModel = organizationModel;
        this.userModel = userModel;
        this.projectModel = projectModel;
        this.onboardingModel = onboardingModel;
        this.inviteLinkModel = inviteLinkModel;
    }

    async updateOrg(
        user: SessionUser,
        data: { organizationName: string },
    ): Promise<void> {
        const { organizationUuid, organizationName } = user;
        if (organizationUuid === undefined) {
            throw new NotExistsError('Organization not found');
        }
        await this.organizationModel.update(organizationUuid, data);
        analytics.track({
            userId: user.userUuid,
            event: 'organization.updated',
            organizationId: organizationUuid,
            properties: {
                type:
                    lightdashConfig.mode === LightdashMode.CLOUD_BETA
                        ? 'cloud'
                        : 'self-hosted',
                organizationId: organizationUuid,
                organizationName,
            },
        });
    }

    async hasInvitedUser(user: SessionUser): Promise<boolean> {
        return (
            (await this.inviteLinkModel.hasActiveInvites()) ||
            (await this.getUsers(user)).length > 1
        );
    }

    async getUsers(user: SessionUser): Promise<OrganizationUser[]> {
        const { organizationUuid } = user;
        if (organizationUuid === undefined) {
            throw new NotExistsError('Organization not found');
        }
        const users = await this.userModel.getAllByOrganization(
            organizationUuid,
        );

        return users.map(({ user_uuid, first_name, last_name, email }) => ({
            userUuid: user_uuid,
            firstName: first_name,
            lastName: last_name,
            email,
        }));
    }

    async getProjects(user: SessionUser): Promise<OrganizationProject[]> {
        const { organizationUuid } = user;
        if (organizationUuid === undefined) {
            throw new NotExistsError('Organization not found');
        }
        return this.projectModel.getAllByOrganizationUuid(organizationUuid);
    }

    async getOnboarding(user: SessionUser): Promise<OnbordingRecord> {
        const { organizationUuid } = user;
        if (organizationUuid === undefined) {
            throw new NotExistsError('Organization not found');
        }
        return this.onboardingModel.getByOrganizationUuid(organizationUuid);
    }

    async setOnboardingSuccessDate(user: SessionUser): Promise<void> {
        const { shownSuccessAt } = await this.getOnboarding(user);
        if (shownSuccessAt) {
            throw new NotExistsError('Can not override "shown success" date');
        }
        return this.onboardingModel.update(user.organizationUuid, {
            shownSuccessAt: new Date(),
        });
    }
}
