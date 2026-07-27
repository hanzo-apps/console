/**
 * OSS App Store catalog — the console's view of the shared catalog module.
 *
 * The catalog shape, its normalizer, the asset-URL builders and the blueprint reader
 * live in `@hanzo/ui/oss` and are re-exported here. They used to be a full copy in this
 * file, with a second copy in platform and a third in the oss.hanzo.ai gallery — three
 * readers of one format, free to drift until two surfaces disagreed about what a deploy
 * would start. This module now adds only what is genuinely console-specific.
 *
 * The import path is unchanged on purpose: every caller in this app keeps importing
 * from `~/lib/api/oss-apps`, so collapsing the duplication touched no call site.
 *
 * DEPLOY remains a SEPARATE concern (`store/DeployDialog`): it reuses the console's real
 * PaaS path (`PaasApi`, `/v1/platform/*` on the cloud binary) — this module only reads.
 */
export {
  type OssApp,
  normalizeOssApp,
  normalizeOssApps,
  blueprintBase,
  logoUrl,
  ownerRepo,
  hasDeploySource,
  fetchOssApps,
  fetchCompose,
} from '@hanzo/ui/oss'

import { ownerRepo, type OssApp } from '@hanzo/ui/oss'

/**
 * The in-console Authors deep link the maker hook opens: `/authors` (the OSS Author
 * program), carrying the derived `owner/repo` as a forward-compatible `?claim=` hint.
 * Console-specific — it names a console route — so it stays here rather than in the
 * shared module. Injection-safe (the repo is URL-encoded).
 */
export function claimPath(app: OssApp): string {
  const repo = ownerRepo(app.links.github)
  return repo ? `/authors?claim=${encodeURIComponent(repo)}` : '/authors'
}
