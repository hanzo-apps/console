/**
 * Team API — an ORG admin managing their OWN organization's members, over the
 * console's own server-gated `/org/iam` proxy.
 *
 * Distinct from `IamAdminApi` (the `/admin/iam` GLOBAL cross-tenant proxy, which a
 * customer can't reach): this proxy authorizes ANY authenticated member to READ
 * their own org's members/roles and an ORG ADMIN to invite / change-role / remove
 * — always pinned to the caller's OWN org (`X-Org-Id` / the resolved owner),
 * server-side, so no tenant can touch another's users. This is what closes
 * "can't manage members in an org" for a customer like maxpower.
 *
 * The browser holds no IAM credential — it calls same-origin with the session
 * cookie; the proxy forwards to IAM as the user. Shares the ONE envelope client
 * with the admin API (DRY), differing only in the gated base path.
 */
import { makeIamClient, DEFAULT_PAGE_SIZE, type Paged } from './iam-envelope'
import { ApiError } from './client'
import { listQuery, type ListParams } from './types'
import type { Organization, IamUser, Role } from './admin'

const org = makeIamClient('/org/iam')

/** A shareable accept link for a pending member (delivery is a link hand-off —
 *  email/OTP is not wired on this deployment). */
export type InviteLink = { link: string; org: string; name: string; email: string }

export const TeamApi = {
  /** Members of `orgName` (the caller's own org, or any for a global admin). */
  members: (orgName: string, params: ListParams = {}): Promise<Paged<IamUser>> =>
    org.iamList<IamUser>('get-users', listQuery({ owner: orgName, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  /** A single member by id (`owner/name`). */
  member: (id: string): Promise<IamUser> => org.iamOne<IamUser>('get-user', { id }),

  /** RBAC roles defined in `orgName` (read-only surface). */
  roles: (orgName: string, params: ListParams = {}): Promise<Paged<Role>> =>
    org.iamList<Role>('get-roles', listQuery({ owner: orgName, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  /** The org record (name, displayName, created) for the Settings General tab. */
  organization: (orgName: string): Promise<Organization> =>
    org.iamOne<Organization>('get-organization', { id: `admin/${orgName}` }),

  /**
   * Save the org's branding/settings (displayName, logo, favicon, website, theme).
   * Send the FULL record back — IAM replaces the row — so callers spread the loaded
   * org and override only the edited fields. `?id=admin/<name>` locates it; the proxy
   * requires an ORG ADMIN and pins the name to the caller's own org (no cross-tenant
   * write). Org objects are owned by the `admin` metadata org.
   */
  updateOrganization: (organization: Organization): Promise<void> =>
    org.iamMutate('update-organization', organization, { id: `admin/${organization.name}` }),

  /** Invite (create) a member. `user.owner` MUST be the caller's org (the proxy
   *  rejects any other owner in the body — the cross-tenant write guard). */
  invite: (user: IamUser): Promise<void> => org.iamMutate('add-user', user),

  /** Change a member (role/admin flag). `id` = `owner/name`; body is the full user. */
  update: (id: string, user: IamUser): Promise<void> => org.iamMutate('update-user', user, { id }),

  /** Remove a member. Body is the full user object (owner must be the caller's org). */
  remove: (user: IamUser): Promise<void> => org.iamMutate('delete-user', user),

  /**
   * Mint a shareable ACCEPT LINK for a pending member (`/console/invite-link`, the
   * console's own org-admin-gated BFF). The invitee opens it to set a password and
   * sign in — the honest, no-email delivery for a deployment where IAM's
   * `send-invitation` is a stub. Server-gated to an org admin of the member's org.
   */
  inviteLink: async (member: { org: string; name: string; email?: string }): Promise<InviteLink> => {
    let res: Response
    try {
      res = await fetch('/console/invite-link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(member),
      })
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
    }
    const j = (await res.json().catch(() => null)) as (InviteLink & { error?: string }) | null
    if (!res.ok || !j?.link) {
      throw new ApiError(j?.error || `Could not create an invite link (HTTP ${res.status})`, res.status)
    }
    return { link: j.link, org: j.org, name: j.name, email: j.email }
  },
}
