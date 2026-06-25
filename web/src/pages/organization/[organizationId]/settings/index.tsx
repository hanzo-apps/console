import { PagedSettingsContainer } from "@/src/components/PagedSettingsContainer";
import Header from "@/src/components/layouts/header";
import { MembershipInvitesPage } from "@/src/features/rbac/components/MembershipInvitesPage";
import { MembersTable } from "@/src/features/rbac/components/MembersTable";
import { IdentityAndAccessSettings } from "@/src/features/rbac/components/IdentityAndAccessSettings";
import { JSONView } from "@/src/components/ui/CodeJsonViewer";
import RenameOrganization from "@/src/features/organizations/components/RenameOrganization";
import { useQueryOrganization } from "@/src/features/organizations/hooks";
import { useRouter } from "next/router";
import { SettingsDangerZone } from "@/src/components/SettingsDangerZone";
import { DeleteOrganizationButton } from "@/src/features/organizations/components/DeleteOrganizationButton";
import ContainerPage from "@/src/components/layouts/container-page";
import { useQueryProjectOrOrganization } from "@/src/features/projects/hooks";
import { ApiKeyList } from "@/src/features/public-api/components/ApiKeyList";
import { CloudApiKeys } from "@/src/features/cloud-api-keys/components/CloudApiKeys";
import AIFeatureSwitch from "@/src/features/organizations/components/AIFeatureSwitch";
import { OrgAuditLogsSettingsPage } from "@/src/features/audit-log-viewer/OrgAuditLogsSettingsPage";
import { BillingSettings } from "@/src/features/billing/components/BillingSettings";
import { env } from "@/src/env.mjs";

type OrganizationSettingsPage = {
  title: string;
  slug: string;
  show?: boolean | (() => boolean);
  cmdKKeywords?: string[];
} & ({ content: React.ReactNode } | { href: string });

export function useOrganizationSettingsPages(): OrganizationSettingsPage[] {
  const { organization } = useQueryProjectOrOrganization();

  if (!organization) return [];

  return getOrganizationSettingsPages({ organization });
}

export const getOrganizationSettingsPages = ({
  organization,
}: {
  organization: { id: string; name: string; metadata: Record<string, unknown> };
}): OrganizationSettingsPage[] => [
  {
    title: "General",
    slug: "index",
    cmdKKeywords: ["name", "id", "delete"],
    content: (
      <div className="flex flex-col gap-6">
        <RenameOrganization />
        <div>
          <Header title="Debug Information" />
          <JSONView
            title="Metadata"
            json={{
              name: organization.name,
              id: organization.id,
              ...organization.metadata,
              ...(env.NEXT_PUBLIC_HANZO_CLOUD_REGION && {
                cloudRegion: env.NEXT_PUBLIC_HANZO_CLOUD_REGION,
              }),
            }}
          />
        </div>
        <AIFeatureSwitch />
        <SettingsDangerZone
          items={[
            {
              title: "Delete this organization",
              description:
                "Once you delete an organization, there is no going back. Please be certain.",
              button: <DeleteOrganizationButton />,
            },
          ]}
        />
      </div>
    ),
  },
  {
    title: "Identity & Access",
    slug: "iam",
    cmdKKeywords: [
      "iam",
      "identity",
      "access",
      "members",
      "invite",
      "user",
      "rbac",
      "roles",
      "permissions",
      "api key",
      "hk",
      "cloud",
      "token",
    ],
    content: <IdentityAndAccessSettings orgId={organization.id} />,
  },
  {
    title: "API Keys",
    slug: "api-keys",
    cmdKKeywords: ["cloud", "hk", "api key", "token", "completions"],
    content: (
      <div className="flex flex-col gap-8">
        <CloudApiKeys orgId={organization.id} />
        <ApiKeyList entityId={organization.id} scope="organization" />
      </div>
    ),
  },
  {
    title: "Members",
    slug: "members",
    cmdKKeywords: ["invite", "user", "rbac"],
    content: (
      <div className="flex flex-col gap-6">
        <div>
          <Header title="Organization Members" />
          <MembersTable orgId={organization.id} />
        </div>
        <div>
          <MembershipInvitesPage orgId={organization.id} />
        </div>
      </div>
    ),
  },
  {
    title: "Audit Logs",
    slug: "audit-logs",
    cmdKKeywords: ["audit", "logs", "history", "changes"],
    content: <OrgAuditLogsSettingsPage orgId={organization.id} />,
  },
  {
    title: "Billing",
    slug: "billing",
    cmdKKeywords: ["payment", "subscription", "plan", "invoice", "usage"],
    content: <BillingSettings />,
  },
  // KMS removed: it is a separate service, not an organization setting.
  {
    title: "Projects",
    slug: "projects",
    href: `/organization/${organization.id}`,
  },
];

const OrgSettingsPage = () => {
  const organization = useQueryOrganization();
  const router = useRouter();
  const { page } = router.query;
  const pages = useOrganizationSettingsPages();

  if (!organization) return null;

  return (
    <ContainerPage
      headerProps={{
        title: "Organization Settings",
      }}
    >
      <PagedSettingsContainer
        activeSlug={page as string | undefined}
        pages={pages}
      />
    </ContainerPage>
  );
};

export default OrgSettingsPage;
