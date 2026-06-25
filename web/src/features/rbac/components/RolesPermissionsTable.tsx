/**
 * Roles & Permissions reference — a read-only matrix of organization role ×
 * organization scope, derived from the authoritative native RBAC model
 * (`organizationRoleAccessRights`). It tells a tenant exactly what each role
 * they can assign in the Members table is allowed to do, scoped to THEIR org.
 *
 * This is a reference view, not an editor: org roles are a fixed, well-defined
 * set (Owner / Admin / Admin Billing / Member / Viewer / None) and are assigned
 * per-member in the Members table. There is no cross-org or global surface here.
 */
import { Check } from "lucide-react";
import Header from "@/src/components/layouts/header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { type Role } from "@hanzo/console";
import {
  organizationScopes,
  organizationRoleAccessRights,
  type OrganizationScope,
} from "@/src/features/rbac/constants/organizationAccessRights";
import {
  orderedRoles,
  formatRole,
} from "@/src/features/rbac/constants/orderedRoles";

// Most-privileged first, so the matrix reads top-down from Owner.
const rolesByPrivilegeDesc = (Object.keys(orderedRoles) as Role[]).sort(
  (a, b) => orderedRoles[b] - orderedRoles[a],
);

// Friendly labels for the Resource:Action scope strings.
const scopeLabels: Record<OrganizationScope, string> = {
  "projects:create": "Create projects",
  "projects:transfer_org": "Transfer projects between orgs",
  "organization:CRUD_apiKeys": "Manage API keys",
  "organization:update": "Update organization",
  "organization:delete": "Delete organization",
  "organizationMembers:read": "View members",
  "organizationMembers:CUD": "Manage members",
  "hanzoCloudBilling:CRUD": "Manage billing",
  "auditLogs:read": "View audit logs",
};

export function RolesPermissionsTable() {
  return (
    <div>
      <Header title="Roles & Permissions" />
      <p className="text-muted-foreground mb-4 text-sm">
        Each member of this organization is assigned a role in the Members tab.
        The role determines what they can do inside this organization and its
        projects. This is a reference for what each role grants — roles apply
        only to this organization.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">Permission</TableHead>
              {rolesByPrivilegeDesc.map((role) => (
                <TableHead key={role} className="text-center">
                  {formatRole(role)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizationScopes.map((scope) => (
              <TableRow key={scope}>
                <TableCell className="font-medium">
                  {scopeLabels[scope]}
                </TableCell>
                {rolesByPrivilegeDesc.map((role) => {
                  const granted =
                    organizationRoleAccessRights[role].includes(scope);
                  return (
                    <TableCell key={role} className="text-center">
                      {granted ? (
                        <Check
                          className="text-primary mx-auto h-4 w-4"
                          aria-label="granted"
                        />
                      ) : (
                        <span
                          className="text-muted-foreground"
                          aria-label="not granted"
                        >
                          —
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
