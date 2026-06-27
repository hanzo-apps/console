/**
 * Admin API — identity & access, served by Hanzo IAM (casdoor) under `/v1/iam/*`.
 *
 * IAM is the canonical authority for organizations, users, roles, and the audit
 * trail (HIP-0111). The gateway routes `/v1/iam/*` to it, and it speaks the same
 * `{status,msg,data,data2}` envelope as the cloud backend, so these go through
 * the SAME cookie `/v1` client (`getList`) as every other module — one transport.
 *
 * Tenancy is server-side: the gateway injects the org from the validated session.
 * We still pass `owner` where casdoor requires it (users/roles are org-scoped;
 * organizations are owned by the built-in `admin`). If a deployment doesn't proxy
 * `/v1/iam` yet, the list 404s and the module shows an honest empty state.
 */
import { getList } from './client'
import { listQuery, type ListParams } from './types'

/** A casdoor organization (`/v1/iam/get-organizations`). */
export type Organization = {
  owner: string
  name: string
  displayName?: string
  createdTime?: string
  websiteUrl?: string
  passwordType?: string
  [key: string]: unknown
}

/** A casdoor user (`/v1/iam/get-users`). */
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
  [key: string]: unknown
}

/** A casdoor role — the RBAC grant (`/v1/iam/get-roles`). */
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

/** A casdoor audit record (`/v1/iam/get-records`). */
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

/** Paged result — rows plus the backend's total (data2). */
export type Paged<T> = { rows: T[]; total: number }

const DEFAULT_PAGE_SIZE = 50

export const IamAdminApi = {
  /** Organizations are owned by the built-in `admin` account in casdoor. */
  organizations: (params: ListParams = {}): Promise<Paged<Organization>> =>
    getList<Organization[]>('iam/get-organizations', listQuery({ owner: 'admin', pageSize: DEFAULT_PAGE_SIZE, ...params })),

  users: (owner: string, params: ListParams = {}): Promise<Paged<IamUser>> =>
    getList<IamUser[]>('iam/get-users', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  roles: (owner: string, params: ListParams = {}): Promise<Paged<Role>> =>
    getList<Role[]>('iam/get-roles', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),

  records: (owner: string, params: ListParams = {}): Promise<Paged<AuditRecord>> =>
    getList<AuditRecord[]>('iam/get-records', listQuery({ owner, pageSize: DEFAULT_PAGE_SIZE, ...params })),
}
