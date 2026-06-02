import { env } from "@/src/env.mjs";
import { prisma, Role } from "@hanzo/shared/src/db";
import { logger } from "@hanzo/shared/src/server";
import { ServerPosthog } from "@/src/features/posthog-analytics/ServerPosthog";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { getOrganizationPlanServerSide } from "@/src/features/entitlements/server/getPlan";
import { shouldAutoEnableV4 } from "@/src/features/events/lib/v4Rollout";

export async function createProjectMembershipsOnSignup(user: { id: string; email: string | null }) {
  try {
    const isCloudDeployment = Boolean(env.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION);

    // in no case do we want to send duplicate sign up events to posthog
    const isNewUser = !(await prisma.organizationMembership.findFirst({
      where: { userId: user.id },
      select: { id: true },
    }));

    // Hanzo Cloud: provide view-only access to the demo project, none access to the demo org
    const demoProject =
      env.NEXT_PUBLIC_DEMO_ORG_ID && env.NEXT_PUBLIC_DEMO_PROJECT_ID
        ? ((await prisma.project.findUnique({
            where: {
              orgId: env.NEXT_PUBLIC_DEMO_ORG_ID,
              id: env.NEXT_PUBLIC_DEMO_PROJECT_ID,
            },
          })) ?? undefined)
        : undefined;
    if (demoProject !== undefined) {
      await prisma.organizationMembership.upsert({
        where: {
          orgId_userId: { orgId: demoProject.orgId, userId: user.id },
        },
        update: {}, // No-op: preserve existing role
        create: {
          userId: user.id,
          orgId: demoProject.orgId,
          role: Role.VIEWER,
        },
      });
    }

    // self-hosted: HANZO_DEFAULT_ORG_ID
    const defaultOrg = env.HANZO_DEFAULT_ORG_ID
      ? ((await prisma.organization.findUnique({
          where: {
            id: env.HANZO_DEFAULT_ORG_ID,
          },
        })) ?? undefined)
      : undefined;
    const defaultOrgMembership =
      defaultOrg !== undefined
        ? await prisma.organizationMembership.upsert({
            where: {
              orgId_userId: { orgId: defaultOrg.id, userId: user.id },
            },
            update: {}, // No-op: preserve existing role
            create: {
              orgId: defaultOrg.id,
              userId: user.id,
              role: env.HANZO_DEFAULT_ORG_ROLE ?? "VIEWER",
            },
          })
        : undefined;

    // self-hosted: HANZO_DEFAULT_PROJECT_ID
    const defaultProject = env.HANZO_DEFAULT_PROJECT_ID
      ? ((await prisma.project.findUnique({
          where: {
            id: env.HANZO_DEFAULT_PROJECT_ID,
          },
        })) ?? undefined)
      : undefined;
    if (defaultProject !== undefined) {
      if (defaultOrgMembership) {
        // (1) used together with HANZO_DEFAULT_ORG_ID -> create project role for the project within the org, do nothing if the project is not in the org
        if (defaultProject.orgId === defaultOrgMembership.orgId) {
          await prisma.projectMembership.upsert({
            where: {
              projectId_userId: {
                projectId: defaultProject.id,
                userId: user.id,
              },
            },
            update: {}, // No-op: preserve existing role
            create: {
              userId: user.id,
              orgMembershipId: defaultOrgMembership.id,
              projectId: defaultProject.id,
              role: env.HANZO_DEFAULT_PROJECT_ROLE ?? "VIEWER",
            },
          });
        }
      } else {
        // (2) used without HANZO_DEFAULT_ORG_ID (legacy) -> create org membership for the project's org
        await prisma.organizationMembership.upsert({
          where: {
            orgId_userId: { orgId: defaultProject.orgId, userId: user.id },
          },
          update: {}, // No-op: preserve existing role
          create: {
            orgId: defaultProject.orgId,
            userId: user.id,
            role: env.HANZO_DEFAULT_PROJECT_ROLE ?? "VIEWER",
          },
        });
      }
    }

    // Invites do not work for users without emails (some future SSO users)
    if (user.email) await processMembershipInvitations(user.email, user.id);

    if (isCloudDeployment && (options?.userWasJustCreated || isNewUser)) {
      const userRolloutState = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          createdAt: true,
          v4BetaEnabled: true,
          organizationMemberships: {
            select: {
              organization: {
                select: {
                  id: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });

      if (userRolloutState) {
        const shouldAutoEnableV4ForUser = shouldAutoEnableV4({
          userCreatedAt: userRolloutState.createdAt,
          organizations: userRolloutState.organizationMemberships.map(
            (membership) => ({
              id: membership.organization.id,
              createdAt: membership.organization.createdAt,
            }),
          ),
          excludedOrganizationIds: env.NEXT_PUBLIC_DEMO_ORG_ID
            ? [env.NEXT_PUBLIC_DEMO_ORG_ID]
            : [],
        });
        const shouldInitializeForNewUser =
          options?.userWasJustCreated &&
          !userRolloutState.v4BetaEnabled &&
          shouldAutoEnableV4ForUser;
        const shouldInitializeForFirstOrganization =
          !options?.userWasJustCreated &&
          isNewUser &&
          !userRolloutState.v4BetaEnabled &&
          shouldAutoEnableV4ForUser;

        if (
          shouldInitializeForNewUser ||
          shouldInitializeForFirstOrganization
        ) {
          await prisma.user.update({
            where: { id: user.id },
            data: { v4BetaEnabled: true },
          });
        }
      }
    }

    // for conversion metric tracking in posthog: did a new user sign up?
    if (isNewUser && env.NEXT_PUBLIC_HANZO_CLOUD_REGION && ["EU", "US"].includes(env.NEXT_PUBLIC_HANZO_CLOUD_REGION)) {
      try {
        const posthog = new ServerPosthog();
        posthog.capture({
          distinctId: user.id,
          event: "cloud_signup_complete",
          properties: {
            cloudRegion: env.NEXT_PUBLIC_HANZO_CLOUD_REGION,
            hasDemoAccess: demoProject !== undefined,
            hasDefaultOrg: defaultOrg !== undefined,
            hasDefaultProject: defaultProject !== undefined,
          },
        });
        await posthog.shutdown();
      } catch {
        // analytics tracking failure is not critical, just fail
      }
    }
  } catch (e) {
    logger.error("Error assigning project access to new user", e);
  }
}

async function processMembershipInvitations(email: string, userId: string) {
  const invitationsForUser = await prisma.membershipInvitation.findMany({
    where: {
      email: email.toLowerCase(),
    },
  });
  if (invitationsForUser.length === 0) return;

  // Map to individual payloads instead of using createMany as we can thereby use nested writes for ProjectMemberships
  const createOrgMembershipData = invitationsForUser.map((invitation) => ({
    userId: userId,
    orgId: invitation.orgId,
    role: invitation.orgRole,
    ...(invitation.projectId && invitation.projectRole
      ? {
          ProjectMemberships: {
            create: {
              userId: userId,
              projectId: invitation.projectId,
              role: invitation.projectRole,
            },
          },
        }
      : {}),
  }));

  const createOrgMembershipsPromises = createOrgMembershipData.map((inviteData) =>
    prisma.organizationMembership.create({ data: inviteData }),
  );

  await prisma.$transaction([
    ...createOrgMembershipsPromises,
    prisma.membershipInvitation.deleteMany({
      where: {
        id: {
          in: invitationsForUser.map((invitation) => invitation.id),
        },
        email: email.toLowerCase(),
      },
    }),
  ]);
}
