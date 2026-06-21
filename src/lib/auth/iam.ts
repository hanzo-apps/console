/**
 * Hanzo IAM (OIDC) client.
 *
 * Wraps `@hanzo/iam-js-sdk`. The SDK touches `window`/`sessionStorage`, so it is
 * constructed lazily and only in the browser. Sign-in is the standard authorize
 * redirect: `getSigninUrl()` -> IAM login -> our `/auth/callback?code&state` ->
 * the backend `/v1/signin` exchanges code+state for a session cookie.
 */
import Sdk from '@hanzo/iam-js-sdk'

import { config } from '~/config'

/** Path IAM redirects back to after authorize. */
export const CALLBACK_PATH = '/auth/callback'

let sdk: Sdk | null = null

function iam(): Sdk {
  if (typeof window === 'undefined') {
    throw new Error('IAM SDK is browser-only')
  }
  if (!sdk) {
    sdk = new Sdk({
      serverUrl: config.iamUrl,
      clientId: config.iamClientId,
      appName: config.iamAppName,
      organizationName: config.iamOrgName,
      redirectPath: CALLBACK_PATH,
      scope: 'openid profile email',
    })
  }
  return sdk
}

/** Full IAM authorize URL to begin sign-in. */
export const getSigninUrl = (): string => iam().getSigninUrl()

/** Full IAM signup URL. */
export const getSignupUrl = (): string => iam().getSignupUrl()
