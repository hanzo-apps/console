/**
 * Identity & Access — the single, unified IAM management panel for a tenant.
 *
 * A tenant manages THEIR organization's identity and access entirely from here,
 * per-org, without ever touching a raw IAM/Casdoor admin UI:
 *   - Members:      list / invite / remove, and assign each member an org role
 *   - Roles:        a reference matrix of what each org role grants
 *   - API keys:     the Hanzo Cloud API key (hk-) for api.hanzo.ai, plus the
 *                   observability keys (pk-/sk-)
 *
 * Every sub-panel is scoped to `orgId` and gated by the org's RBAC
 * (`protectedOrganizationProcedure` server-side, `useHasOrganizationAccess`
 * client-side), so a tenant only ever sees and manages their own organization.
 * No cross-org data, no global-admin surface.
 */
import { Users, Shield, KeyRound } from "lucide-react";
import Header from "@/src/components/layouts/header";
import { MembersTable } from "@/src/features/rbac/components/MembersTable";
import { MembershipInvitesPage } from "@/src/features/rbac/components/MembershipInvitesPage";
import { RolesPermissionsTable } from "@/src/features/rbac/components/RolesPermissionsTable";
import { CloudApiKeys } from "@/src/features/cloud-api-keys/components/CloudApiKeys";
import { ApiKeyList } from "@/src/features/public-api/components/ApiKeyList";

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Users;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground h-4 w-4" />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {description ? (
        <p className="text-muted-foreground -mt-2 text-sm">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

export function IdentityAndAccessSettings({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col gap-10">
      <p className="text-muted-foreground text-sm">
        Manage who can access this organization, what each role can do, and the
        API keys used to call Hanzo services. Everything here applies only to
        this organization.
      </p>

      <Section
        icon={Users}
        title="Members"
        description="People with access to this organization. Invite teammates by email and assign each a role."
      >
        <div className="flex flex-col gap-6">
          <div>
            <Header title="Organization Members" />
            <MembersTable orgId={orgId} />
          </div>
          <MembershipInvitesPage orgId={orgId} />
        </div>
      </Section>

      <Section icon={Shield} title="Roles">
        <RolesPermissionsTable />
      </Section>

      <Section
        icon={KeyRound}
        title="API Keys"
        description="Keys that authenticate requests on behalf of this organization."
      >
        <div className="flex flex-col gap-8">
          <CloudApiKeys orgId={orgId} />
          <ApiKeyList entityId={orgId} scope="organization" />
        </div>
      </Section>
    </div>
  );
}
