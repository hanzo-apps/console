/**
 * Admin API — identity & access (IAM) and secrets (KMS), via the console's OWN
 * server-gated proxies, NOT the cloud `/v1` backend.
 *
 * The browser holds no IAM/KMS credential. Every call here is SAME-ORIGIN to
 * `/admin/iam/*` or `/admin/kms/*`, sending only the first-party session cookie;
 * the server route (`app/admin/{iam,kms}/[...path]/route.ts`) enforces the GLOBAL
 * admin gate and forwards to IAM / KMS as the user. IAM speaks the
 * `{status,msg,data,data2}` envelope; KMS speaks plain JSON.
 *
 * Cross-tenant (any org) is global-admin only — a customer managing their OWN org
 * uses `TeamApi` (the `/org/iam` proxy) instead. Both share the ONE envelope
 * client (`makeIamClient`), differing only in the gated base path.
 */
import { ApiError, iamList as cloudIamList, iamOne as cloudIamOne, iamMutate as cloudIamMutate } from './client'
import { IS_EMBED } from '~/lib/embed'
import { listQuery, type ListParams } from './types'
import { makeIamClient, DEFAULT_PAGE_SIZE, qs, type Query, type Paged } from './iam-envelope'

export type { Paged }

/** An IAM organization's theme (`themeData`) — the accent + surface style the org
 *  brands with. Mirrors the IAM `ThemeData` shape. */
export type ThemeData = {
  themeType?: string
  /** Primary accent color (hex), e.g. `#D4D4D4`. */
  colorPrimary?: string
  borderRadius?: number
  isCompact?: boolean
  /** When true the org's custom theme is applied (else the default). */
  isEnabled?: boolean
}

/** An IAM organization (`get-organizations`). */
export type Organization = {
  owner: string
  name: string
  displayName?: string
  createdTime?: string
  websiteUrl?: string
  passwordType?: string
  /** Org logo URL (IAM `logo`); shown in the console chrome when set. */
  logo?: string
  favicon?: string
  /** Org theme (accent color, radius, …) — the branding surface. */
  themeData?: ThemeData
  [key: string]: unknown
}

/** An IAM user (`get-users`), including the MFA surface (`get-user`). */
export type IamUser = {
  owner: string
  name: string
  displayName?: string
  email?: string
  phone?: string
  createdTime?: string
  isAdmin?: boolean
  isForbidden?: boolean
  isDeleted?: boolean
  type?: string
  signupApplication?: string
  /** Stored credential — a hash (or masked `***`) when set, `''` for a pending
   *  member who hasn't accepted their invite yet. Presence, not the value, is read. */
  password?: string
  /** Preferred 2FA channel ("", "app", "sms", "email"). */
  preferredMfaType?: string
  mfaPhoneEnabled?: boolean
  mfaEmailEnabled?: boolean
  [key: string]: unknown
}

/** An IAM application (`get-applications`). */
export type IamApplication = {
  owner: string
  name: string
  displayName?: string
  organization?: string
  createdTime?: string
  clientId?: string
  description?: string
  [key: string]: unknown
}

/** An IAM identity provider (`get-providers`). */
export type IamProvider = {
  owner: string
  name: string
  displayName?: string
  category?: string
  type?: string
  createdTime?: string
  [key: string]: unknown
}

/** An IAM role — the RBAC grant (`get-roles`). */
export type Role = {
  owner: string
  name: string
  displayName?: string
  description?: string
  createdTime?: string
  isEnabled?: boolean
  users?: string[]
  roles?: string[]
  domains?: string[]
  [key: string]: unknown
}

/** An IAM audit record (`get-records`). */
export type AuditRecord = {
  id?: string | number
  owner?: string
  name?: string
  createdTime?: string
  organization?: string
  user?: string
  clientIp?: string
  method?: string
  requestUri?: string
  action?: string
  [key: string]: unknown
}

// ── IAM admin (global; IAM envelope over /admin/iam/*) ────────────────────────

/**
 * The IAM-admin transport, split by DEPLOYMENT topology (one gate, two transports):
 *  - STANDALONE console (console2/admin.hanzo.ai): the cross-tenant `/admin/iam/*`
 *    server proxy — global-admin gated, cookie-authenticated, mints the IAM bearer
 *    server-side. The generic `/v1` bearer proxy deliberately EXCLUDES `iam/*`
 *    (proxy-allow.ts:7), so IAM keeps its own gated proxy here — unchanged.
 *  - go:embed console (IS_EMBED, console.hanzo.ai / cloud.hanzo.ai): the static export
 *    has NO server routes — `/admin/iam/*` is pruned and cloud's catch-all serves the
 *    SPA index (HTTP 200 HTML) for any non-`/v1/` path, so the cookie-only `/admin/iam`
 *    client parsed the SPA and threw — the missing-org-switcher bug (OrgSwitcher/
 *    OrgPicker swallow the error → empty list). Cloud serves the SAME IAM reads/writes
 *    natively at `/v1/iam/<segment>` (bearer-scoped, org from the validated principal),
 *    so in the embed we use the cloud-native IAM client (client.ts iamList/iamOne/
 *    iamMutate). Scoping is unchanged: the OrgSwitcher still only lists cross-tenant
 *    for a super admin, and cloud/IAM enforces the per-principal org scope.
 */
type IamClient = {
  iamList: <T>(segment: string, query: Query) => Promise<Paged<T>>
  iamOne: <T>(segment: string, query: Query) => Promise<T>
  iamMutate: (segment: string, body: unknown, query?: Query) => Promise<void>
}
const admin: IamClient = IS_EMBED
  ? { iamList: cloudIamList, iamOne: cloudIamOne, iamMutate: cloudIamMutate }
  : makeIamClient('/admin/iam')

export const IamAdminApi = {
  /** Organizations are owned by the built-in `admin`; IAM scopes to the caller. */
  organizations: (params: ListParams = {}): Promise<Paged<Organization>> =>
    admin.iamList<Organization>('get-organizations', listQuery({ owner: 'admin', pageSize: DEFAULT_PAGE_SIZE, ...params })),

  /** A single organization by name (IAM orgs are owned by `admin`). */
  organization: (name: string): Promise<Organization> =>
    admin.iamOne<Organization>('get-organization', { id: `admin/${name}` }),

  /**
   * Create a tenant ORG (the white-label tenant record). Global-admin only.
   * IAM orgs are owned by the reserved `admin` org; the record's `name` is the
   * tenant slug. This is the DATA-DRIVEN create — a new tenant is a new org row.
   */
  addOrganization: (org: Organization): Promise<void> =>
    admin.iamMutate('add-organization', { ...org, owner: 'admin' }),

  /**
   * Update a tenant ORG — the BRAND write (logo / favicon / themeData are real IAM
   * org fields). Global-admin only; the proxy pins the org name so a write can't
   * retarget another tenant. This is how the Tenants board persists a brand as DATA
   * (no hardcoded brand map).
   */
  updateOrganization: (name: string, org: Organization): Promise<void> =>
    admin.iamMutate('update-organization', { ...org, owner: 'admin' }, { id: `admin/${name}` }),

  /** Delete a tenant ORG (the whole tenant record). Global-admin only. */
  deleteOrganization: (org: Organization): Promise<void> =>
    admin.iamMutate('delete-organization', { ...org, owner: 'admin' }),

  users: (owner: string, params: ListParams = {}): Promise<Paged<IamUser>> =>
    admin.iamList<IamUser>('get-users', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  /** A single user by id (`owner/name`) — includes the MFA fields. */
  getUser: (id: string): Promise<IamUser> => admin.iamOne<IamUser>('get-user', { id }),

  applications: (owner: string, params: ListParams = {}): Promise<Paged<IamApplication>> =>
    admin.iamList<IamApplication>('get-applications', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  application: (id: string): Promise<IamApplication> =>
    admin.iamOne<IamApplication>('get-application', { id }),

  providers: (owner: string, params: ListParams = {}): Promise<Paged<IamProvider>> =>
    admin.iamList<IamProvider>('get-providers', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  roles: (owner: string, params: ListParams = {}): Promise<Paged<Role>> =>
    admin.iamList<Role>('get-roles', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  records: (owner: string, params: ListParams = {}): Promise<Paged<AuditRecord>> =>
    admin.iamList<AuditRecord>('get-records', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  // Mutations — IAM takes the object as the JSON body; updates take `?id`.
  addUser: (user: IamUser): Promise<void> => admin.iamMutate('add-user', user),
  updateUser: (id: string, user: IamUser): Promise<void> => admin.iamMutate('update-user', user, { id }),
  deleteUser: (user: IamUser): Promise<void> => admin.iamMutate('delete-user', user),

  addApplication: (app: IamApplication): Promise<void> => admin.iamMutate('add-application', app),
  updateApplication: (id: string, app: IamApplication): Promise<void> => admin.iamMutate('update-application', app, { id }),
  deleteApplication: (app: IamApplication): Promise<void> => admin.iamMutate('delete-application', app),

  addProvider: (p: IamProvider): Promise<void> => admin.iamMutate('add-provider', p),
  updateProvider: (id: string, p: IamProvider): Promise<void> => admin.iamMutate('update-provider', p, { id }),
  deleteProvider: (p: IamProvider): Promise<void> => admin.iamMutate('delete-provider', p),

  addRole: (role: Role): Promise<void> => admin.iamMutate('add-role', role),
  updateRole: (id: string, role: Role): Promise<void> => admin.iamMutate('update-role', role, { id }),
  deleteRole: (role: Role): Promise<void> => admin.iamMutate('delete-role', role),

  // ── Waitlist approval queue (iam#104) — the launch dashboard's Pending-Users
  //    board. REUSES the IAM approval API through the SAME global-admin /admin/iam
  //    proxy; there is no second approval store. `owner` optionally scopes the
  //    queue to one org (global admin sees all when omitted).
  pendingUsers: (owner?: string, params: ListParams = {}): Promise<Paged<IamUser>> =>
    admin.iamList<IamUser>('get-pending-users', listQuery({ pageSize: DEFAULT_PAGE_SIZE, ...(owner ? { owner } : {}), ...params })),
  /** Approve a pending user off the waitlist (globally). id = `owner/name`. */
  approveUser: (id: string): Promise<void> => admin.iamMutate('approve-user', { id }),
  /** Reject a pending user's access request. id = `owner/name`. */
  rejectUser: (id: string): Promise<void> => admin.iamMutate('reject-user', { id }),
}

// ── KMS admin (plain JSON over /admin/kms/secrets) ───────────────────────────

/** Secret metadata row (no value) — what a future kmsd list endpoint returns. */
export type KmsSecretMeta = {
  path: string
  name: string
  env: string
  version: number
  updatedTime?: string
}

/** A revealed secret — value shown once, never stored. */
export type KmsSecretValue = { value: string; version: number }

export type KmsScope = { org?: string }
export type KmsRef = KmsScope & { path: string; name: string; env?: string }

const KMS_SECRETS = '/admin/kms/secrets'

async function kmsReq<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', query?: Query, body?: unknown): Promise<T | undefined> {
  let res: Response
  try {
    res = await fetch(`${KMS_SECRETS}${qs(query)}`, {
      method,
      credentials: 'include',
      headers: body !== undefined
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
  }
  if (res.status === 403) throw new ApiError('forbidden', 403)
  const text = await res.text()
  let json: unknown
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      if (!res.ok) throw new ApiError(`Request failed (HTTP ${res.status})`, res.status)
    }
  }
  if (!res.ok) {
    const m = json && typeof json === 'object' && typeof (json as { message?: unknown }).message === 'string'
      ? (json as { message: string }).message
      : `Request failed (HTTP ${res.status})`
    throw new ApiError(m, res.status)
  }
  return json as T
}

type ListShape = KmsSecretMeta[] | { secrets?: KmsSecretMeta[] }

function normalizeMeta(raw: ListShape | undefined): KmsSecretMeta[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.secrets) ? raw.secrets : []
  return arr.map((x) => ({
    path: String(x.path ?? ''),
    name: String(x.name ?? ''),
    env: String(x.env ?? 'default'),
    version: Number(x.version ?? 0),
    updatedTime: x.updatedTime ? String(x.updatedTime) : undefined,
  }))
}

export const KmsAdminApi = {
  /**
   * List secret metadata under a prefix. kmsd has no list endpoint yet → 404,
   * surfaced honestly by the module (never a fabricated table).
   */
  list: (opts: KmsScope & { prefix?: string; env?: string } = {}): Promise<KmsSecretMeta[]> =>
    kmsReq<ListShape>('GET', { org: opts.org, prefix: opts.prefix, env: opts.env }).then(normalizeMeta),

  /** Reveal ONE value (shown once, never stored). */
  reveal: (ref: KmsRef): Promise<KmsSecretValue> =>
    kmsReq<{ secret?: { value?: string }; value?: string; version?: number }>('GET', {
      org: ref.org,
      path: ref.path,
      name: ref.name,
      env: ref.env,
    }).then((r) => ({ value: r?.secret?.value ?? r?.value ?? '', version: Number(r?.version ?? 0) })),

  /** Create/upsert a secret (value write-only; the version is bumped). */
  create: (ref: KmsRef & { value: string }): Promise<{ version: number }> =>
    kmsReq<{ version?: number }>('POST', { org: ref.org }, {
      path: ref.path,
      name: ref.name,
      env: ref.env ?? '',
      value: ref.value,
    }).then((r) => ({ version: Number(r?.version ?? 0) })),

  /** Rotate a secret with compare-and-set on the current version. */
  rotate: (ref: KmsRef & { value: string; version: number }): Promise<{ version: number }> =>
    kmsReq<{ version?: number }>('PATCH', { org: ref.org, path: ref.path, name: ref.name }, {
      value: ref.value,
      version: ref.version,
      env: ref.env ?? '',
    }).then((r) => ({ version: Number(r?.version ?? 0) })),

  /** Delete a secret. */
  remove: (ref: KmsRef): Promise<void> =>
    kmsReq<unknown>('DELETE', { org: ref.org, path: ref.path, name: ref.name, env: ref.env }).then(() => undefined),
}
