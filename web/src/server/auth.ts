/**
 * Auth entrypoint — IAM-native, decomplected from any login library.
 *
 * NextAuth has been removed. Identity is Hanzo IAM (credentials verified by
 * `iamServer`, tokens validated against IAM's JWKS); the console session is the
 * signed `hi_session` cookie resolved by `iamSession`. There is no provider
 * translation layer, no adapter, no JWT/CSRF machinery here.
 *
 * `getServerAuthSession` is kept as the historical server accessor name (now a
 * thin alias of `getIamServerSession`) so the existing server call sites need
 * no change — they already consume the same `Session` shape.
 */
export { getIamServerSession as getServerAuthSession } from "@/src/features/auth/lib/iamSession";
export { type Session, type User } from "@/src/features/auth/session-types";
