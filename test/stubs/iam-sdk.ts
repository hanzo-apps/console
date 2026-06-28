/**
 * Hermetic unit-test stub for `@hanzo/iam-js-sdk`. The real SDK touches
 * `window`/`sessionStorage`; unit tests only need the constructable shape and
 * the two URL builders. Live OIDC behavior is covered by the E2E suite.
 */
export default class Sdk {
  constructor(_opts?: unknown) {}
  getSigninUrl(): string {
    return 'https://stub.iam/login/oauth/authorize?client_id=stub'
  }
  getSignupUrl(): string {
    return 'https://stub.iam/signup'
  }
}
