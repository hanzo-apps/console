/**
 * ZAP capability context — the auth core for native ZAP capability-RPC.
 *
 * Replaces tRPC's `createTRPCContext(req,res)` + next-auth `getServerAuthSession`.
 * Where tRPC threaded a `Session` through every procedure, ZAP threads a verified
 * {@link Capability}: a typed, unforgeable, attenuable authority that REPLACES the
 * bearer JWT (see zap-proto/zap-spec/SPEC.md §1).
 *
 * Decomplected on purpose (church of Rich Hickey): "what a method needs" (the
 * Capability + backend handles) is one value; "is this caller allowed" is ONE
 * function in ONE place — {@link requirePermission}. No router re-implements the
 * permission check; they call the chokepoint. Verification logic and policy
 * enforcement are not braided.
 */
// Type-only import: erased at compile time so this module pulls in NO runtime DB
// dependency. The concrete prisma singleton is injected by the caller (the route /
// dispatch layer), keeping "hold the handle" separate from "source the singleton".
import type { PrismaClient } from "@hanzo/shared/src/db";

// ---------------------------------------------------------------------------
// Wire enums — normative copy of zap-proto/zap-spec/capabilities_kinds.md.
// Kept in lockstep with that file (it is part of the wire contract). Codegen
// will emit these from the spec later; for now they live here as named consts.
// ---------------------------------------------------------------------------

/** Capability.Kind (u32) — authority profile. */
export const CapKind = {
  Reserved: 0x00,
  /** replaces bearer JWT session tokens */
  IAMSession: 0x01,
  /** replaces client-credentials API keys */
  IAMAPIKey: 0x02,
  /** meta: ability to attenuate-and-reissue */
  Delegate: 0xff,
} as const;
export type CapKindValue = (typeof CapKind)[keyof typeof CapKind];

/**
 * Capability.Permissions (u64) bits. Bits are per-CapKind (verifiers dispatch on
 * Kind first); the bottom 32 belong to the Kind, the top 32 are cross-cutting.
 * Modeled as bigint because the field is u64 and PermAttenuate is `1 << 32`.
 */
export const Perm = {
  // CapKindIAMSession (0x01) low bits
  SessionRead: 1n << 0n,
  SessionWrite: 1n << 1n,
  SessionDelete: 1n << 2n,
  SessionAssumeOrg: 1n << 3n,
  // cross-cutting (top 32, all CapKinds)
  Attenuate: 1n << 32n,
  Audit: 1n << 33n,
  Root: 1n << 63n,
} as const;

/** Capability.Sig algorithm tag (final byte of the 3408-byte footer). */
export const Scheme = {
  Reserved: 0x00,
  Secp256k1: 0x01,
  Ed25519: 0x02,
  MLDSA65: 0x03,
  Hybrid: 0x04,
} as const;

// ---------------------------------------------------------------------------
// Capability — decoded, already-verified inbound authority.
// ---------------------------------------------------------------------------

/**
 * A verified Capability as seen by a server method. This is the in-memory view
 * of the `Capability` wire struct (zap-proto/zap-spec/capabilities.zap): the
 * cryptographic verification (signature chain, revocation, caveats) has already
 * happened in {@link verifyCapability} before a value of this type exists.
 *
 * Fields are the subset a server actually reasons about. `holder` / `issuer` are
 * the 32-byte BLAKE3 pubkey hashes; `permissions` is the u64 bitmask.
 */
export interface Capability {
  kind: CapKindValue;
  /** 32B hash of the wielder's pubkey (binds to keypair, not bearer). */
  holder: Uint8Array;
  /** 32B hash of the issuer's pubkey. */
  issuer: Uint8Array;
  /** u64 permission bitmask — checked with {@link requirePermission}. */
  permissions: bigint;
  /** unix seconds; 0 = never. */
  expiresAt: bigint;
  /** Caveat kinds present on the chain (already evaluated by the verifier). */
  caveatKinds: number[];
}

/** Backend services a server method may reach. Prisma is our PostgreSQL client. */
export interface ZapContext {
  /** the verified inbound capability (REPLACES the next-auth session). */
  cap: Capability;
  /** PostgreSQL via Prisma. (Mongo is being killed in a separate workstream.) */
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Verification + the single policy chokepoint.
// ---------------------------------------------------------------------------

/** Raised by {@link requirePermission} when the cap lacks a required bit. */
export class CapabilityDeniedError extends Error {
  readonly code = "CAPABILITY_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "CapabilityDeniedError";
  }
}

/** Raised by {@link verifyCapability} when the inbound proof does not verify. */
export class CapabilityVerificationError extends Error {
  readonly code = "CAPABILITY_VERIFICATION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "CapabilityVerificationError";
  }
}

/**
 * Verify an inbound capability presentation and produce a {@link Capability}.
 *
 * TODO(zap-crypto): wire the real verifier per zap-proto/zap-spec/SPEC.md §2.3 —
 *   1. holderSig over a per-session nonce verifies against pubkey-for(Leaf.Holder)
 *   2. walk [Leaf]++Chain: per-link signature (tag at Sig[3407]), revocation,
 *      expiry, Issuer == hash(parent.Holder-pubkey), Permissions subset, caveat
 *      add-only union. Resolve issuer pubkeys via Hanzo IAM's registry.
 * This is its own milestone (the framework lives now; the crypto verify wiring is
 * tracked separately). Until then we decode-and-trust the presented header so the
 * RPC plumbing, permission gating, and pipelining can be exercised end-to-end.
 *
 * @param presented the already-decoded header a transport handed us.
 */
export function verifyCapability(presented: Capability): Capability {
  // Fail-closed shape checks that are cheap and real even pre-crypto.
  if (presented.kind === CapKind.Reserved) {
    throw new CapabilityVerificationError(
      "CapKindReserved is not a usable kind",
    );
  }
  if (presented.holder.length !== 32) {
    throw new CapabilityVerificationError(
      "Holder must be a 32-byte pubkey hash",
    );
  }
  if (
    presented.expiresAt !== 0n &&
    presented.expiresAt < BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new CapabilityVerificationError("capability expired");
  }
  // TODO(zap-crypto): replace decode-and-trust with the SPEC.md §2.3 chain walk.
  return presented;
}

/**
 * THE permission chokepoint. Every ZAP server method that needs authority calls
 * this exactly once at the top of its impl; no method re-implements the check.
 * Dispatches on Kind only implicitly (callers pass the bit that is meaningful for
 * the cap's Kind). Throws {@link CapabilityDeniedError} — the bridge maps that to
 * a capability-denied RPC exception.
 */
export function requirePermission(ctx: ZapContext, bit: bigint): void {
  if ((ctx.cap.permissions & bit) !== bit) {
    throw new CapabilityDeniedError(
      `capability denied: missing permission bit 0x${bit.toString(16)} ` +
        `(holder has 0x${ctx.cap.permissions.toString(16)})`,
    );
  }
}

/**
 * Build a ZapContext from a verified capability + an injected prisma handle.
 * The caller (route / dispatch) sources the concrete PostgreSQL singleton; this
 * keeps context.ts free of any runtime DB import so the no-DB test lane can load
 * it. Servers that need the DB read `ctx.prisma`.
 */
export function createZapContext(
  cap: Capability,
  prisma: PrismaClient,
): ZapContext {
  return { cap, prisma };
}
