/**
 * Cross-surface deep links + the ONE shared project key (pure, injection-safe, tested).
 *
 * A project is IAM-native (org→project in IAM/hanzo.id); its `name` is the SINGLE
 * shared key across every surface — console, hanzo.app (the builder), hanzo.chat
 * (project chat) — and doubles as the deploy site slug. No `svc` suffix. Every
 * cross-surface link carries it as `?project=<iamProjectId>` (the exact param
 * hanzo.app already reads at /dev, `apps.ts` builderEditUrl) so all three surfaces
 * resolve the SAME project.
 */
import { builderEditUrl } from '~/lib/api/apps'

/** The query param every surface exchanges the shared project key under. */
export const PROJECT_PARAM = 'project'

/**
 * A DNS/identifier-safe project slug, matching the cloud site store's slugRE
 * (`^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`): lowercase, non-alnum → '-', collapse
 * repeats, trim, cap at 40. The IAM project `name` IS this slug (created slug-safe),
 * so `name === siteSlug === ?project=` — one key. Idempotent for an already-clean name.
 */
export function slugifyProjectName(name: string): string {
  let out = ''
  let prevDash = false
  for (const ch of name.toLowerCase().trim()) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      out += ch
      prevDash = false
    } else if (!prevDash) {
      out += '-'
      prevDash = true
    }
  }
  out = out.replace(/^-+|-+$/g, '')
  if (out.length > 40) out = out.slice(0, 40).replace(/-+$/g, '')
  return out
}

/** True iff `name` is already a valid project slug (no transform needed). */
export function isValidProjectSlug(name: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(name)
}

/**
 * "Edit in hanzo.app" — opens the builder scoped to this project. Reuses the ONE
 * established convention (`builderEditUrl` → `<appBase>/dev?project=<id>`), so the
 * console and hanzo.app never diverge on the shape.
 */
export function appEditUrl(projectId: string, appBase: string): string {
  return builderEditUrl(projectId, appBase)
}

/**
 * "Chat about it in hanzo.chat" — opens a project-scoped chat. `projectId` is a single
 * URL-encoded query param (`URLSearchParams` encodes `&`/`=`/`#`/spaces), so nothing in
 * a project id can inject another param or escape the query.
 */
export function chatProjectUrl(projectId: string, chatBase: string): string {
  const url = new URL(`${chatBase.replace(/\/+$/, '')}/`)
  url.searchParams.set(PROJECT_PARAM, projectId)
  return url.toString()
}

/** Both cross-surface links for a project, keyed on the ONE shared IAM project id. */
export function crossSurfaceLinks(
  projectId: string,
  bases: { appUrl: string; chatUrl: string },
): { editInApp: string; chatAbout: string } {
  return {
    editInApp: appEditUrl(projectId, bases.appUrl),
    chatAbout: chatProjectUrl(projectId, bases.chatUrl),
  }
}
