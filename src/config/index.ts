/**
 * Runtime configuration — one place that reads the environment.
 *
 * Everything here is `NEXT_PUBLIC_*`: the console is a browser app that talks to
 * the unified Hanzo Cloud `/v1` backend with cookie credentials, and to Hanzo
 * IAM for sign-in. No secrets live here.
 */

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export type ConsoleConfig = {
  /** Unified cloud backend base URL (casibase /v1 API). */
  cloudUrl: string
  /** Hanzo PaaS base URL (platform.hanzo.ai) — DOKS cluster control plane. */
  platformUrl: string
  /** Hanzo IAM OIDC authority. */
  iamUrl: string
  /** IAM application name. console2 is a browser front-end OF the shared Hanzo
   * Cloud `/v1` backend, which exchanges the OIDC code and validates the token as
   * IAM app `hanzo-cloud` (aud=hanzo-cloud). The front-end MUST present the same
   * app/client_id, so this is `hanzo-cloud` — not a console-specific app. */
  iamAppName: string
  /** IAM organization name. */
  iamOrgName: string
  /** IAM OAuth client id for this application. */
  iamClientId: string
  /** Billing/account portal (hanzoai/billing over the commerce backend). The
   * console LINKS here — billing is not reimplemented in the console. */
  billingUrl: string
}

export const config: ConsoleConfig = {
  cloudUrl: trimSlash(process.env.NEXT_PUBLIC_CLOUD_URL ?? 'https://cloud.hanzo.ai'),
  platformUrl: trimSlash(process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'https://platform.hanzo.ai'),
  iamUrl: trimSlash(process.env.NEXT_PUBLIC_IAM_URL ?? 'https://hanzo.id'),
  iamAppName: process.env.NEXT_PUBLIC_IAM_APP_NAME ?? 'hanzo-cloud',
  iamOrgName: process.env.NEXT_PUBLIC_IAM_ORG_NAME ?? 'hanzo',
  iamClientId: process.env.NEXT_PUBLIC_IAM_CLIENT_ID ?? 'hanzo-cloud',
  billingUrl: trimSlash(process.env.NEXT_PUBLIC_BILLING_URL ?? 'https://billing.hanzo.ai'),
}

export const branding = {
  name: 'Hanzo Cloud Console',
  short: 'Cloud Console',
} as const
