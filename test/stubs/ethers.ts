/**
 * Hermetic unit-test stub for `ethers`. The wallet module references
 * `ethers.*` only at call time (never at import), so a universal callable
 * Proxy satisfies the binding without pulling the real library into unit tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const universal: any = new Proxy(function () {}, {
  get: () => universal,
  apply: () => universal,
  construct: () => universal,
})

export const ethers = universal
export default universal
