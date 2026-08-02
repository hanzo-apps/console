/**
 * IS_EMBED — true only in the STATIC bundle that hanzoai/cloud go:embeds and serves
 * itself (set by scripts/build-embed.mjs via NEXT_PUBLIC_CONSOLE_EMBED=1, inlined at
 * build time). In that deployment there is NO Node BFF runtime, so the server-side
 * session routes — /auth/refresh, /auth/session, /auth/signin (all `runtime = 'nodejs'`)
 * — do not exist; their POSTs fall through to the GET-only SPA fallback and 405.
 * The console runs on the casibase session there (the
 * durable console session is an optional BFF-only enhancement), so callers guard on
 * IS_EMBED to SKIP the doomed probe: identical behavior, minus the 405 console noise.
 *
 * The regular Next-server console (console2.hanzo.ai, admin.hanzo.ai) leaves this
 * false and keeps the full durable-session BFF — nothing changes there.
 */
export const IS_EMBED = process.env.NEXT_PUBLIC_CONSOLE_EMBED === '1'
