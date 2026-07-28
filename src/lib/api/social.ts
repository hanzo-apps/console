/**
 * Social — the console's BINDING to the one `/v1/social` contract, which lives in
 * `@hanzo/ui/product/social/api` (`createSocialApi` + the types + the normalizers). This file used
 * to carry its own copy of that contract; the copy is gone, because the dedicated
 * social.hanzo.ai app renders the same component and there can only be one.
 *
 * All this owns is TRANSPORT. Every call is same-origin, keyless and prefix-free
 * (`originV1Url('social/...')` → `<origin>/v1/social/...`), the exact per-tenant path
 * CRM/Agents/Prompts use: the console's OWN `app/v1` user-bearer BFF serves the `social`
 * head (allow-listed in `proxy-allow.ts` CLOUD_HEADS), minting a short-lived user-bound
 * IAM token server-side, and the cloud backend resolves the org from the token's `owner`
 * claim — so every read/write is org-scoped SERVER-SIDE and no credential reaches the
 * browser. A cookie-only call would 403 ("X-Org-Id required"), so the bearer BFF is
 * mandatory — never a direct call.
 *
 * Backend: cloud `clients/social` — a native-Go per-org accounts+posts store on
 * Base/SQLite, the in-process fold of the standalone social stack, twin of clients/crm.
 */
import { createSocialApi, type SocialRest } from '@hanzo/ui/product/social/api'

import { restGet, restPost, restPut, restDelete, originV1Url } from './client'

/** `path` is relative to `/v1/social` — the contract's form, resolved on our origin. */
const rest: SocialRest = {
  get: (path) => restGet<unknown>(originV1Url(`social/${path}`)),
  post: (path, body) => restPost<unknown>(originV1Url(`social/${path}`), body),
  put: (path, body) => restPut<unknown>(originV1Url(`social/${path}`), body),
  del: (path) => restDelete(originV1Url(`social/${path}`)),
}

export const SocialApi = createSocialApi(rest)

// The contract itself — re-exported so console call sites keep ONE import path.
export {
  PROVIDERS,
  ACCOUNT_STATUSES,
  POST_STATUSES,
  normalizeAccount,
  normalizeAccounts,
  normalizePost,
  normalizePosts,
  normalizeProviderCapability,
  normalizeProviders,
  normalizeSummary,
} from '@hanzo/ui/product/social/api'
export type {
  Account,
  NewAccount,
  NewPost,
  Post,
  Provider,
  ProviderCapability,
  SocialSummary,
} from '@hanzo/ui/product/social/api'
