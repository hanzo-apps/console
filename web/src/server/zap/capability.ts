/**
 * capability.ts — build the opaque ZAP Capability buffer the Go service expects.
 *
 * A ZAP Capability REPLACES the bearer JWT (zap-proto/zap-spec/SPEC.md §1). The
 * browser presents its session capability in the `x-zap-capability` header; this
 * module turns that into the binary zap-proto/go Capability buffer the
 * ui-customization Go service re-Wraps and gates on.
 *
 * The Go server runs with no issuer registry (bootstrap), so it enforces Kind +
 * Permissions and skips the signature step — the Sig footer is left zero here.
 * When the IAM-issued cap path ships, the browser will present a real signed
 * CapProof and the server will wire its IssuerKey; this builder is the dev/
 * bootstrap producer for the same wire shape.
 *
 * Constants mirror zap-proto/zap-spec/capabilities_kinds.md (the canonical
 * CapKind / Permission assignments) and the Go cap package.
 */
import { newCapability } from "@/src/server/zap/gen/capabilities_zap";

/** CapKind values (capabilities_kinds.md / zap-proto/go cap.KindXxx). */
export const CapKind = {
  Reserved: 0x00,
  IAMSession: 0x01,
  IAMAPIKey: 0x02,
} as const;
export type CapKindValue = (typeof CapKind)[keyof typeof CapKind];

/** Permission bits (capabilities_kinds.md). CapKindIAMSession low bits. */
export const Perm = {
  SessionRead: 1n << 0n,
  SessionWrite: 1n << 1n,
} as const;

/** A decoded inbound capability (the dev JSON header shape). */
export interface CapabilityFields {
  kind: CapKindValue;
  holder: Uint8Array; // 32B
  issuer: Uint8Array; // 32B
  permissions: bigint;
  expiresAt: bigint;
}

/** Raised when the inbound capability header is missing or malformed. */
export class CapabilityVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityVerificationError";
  }
}

const ZERO32 = new Uint8Array(32);
const ZERO_SIG = new Uint8Array(3408);

/**
 * Decode the dev JSON capability header into {@link CapabilityFields}. Returns
 * null when absent/malformed (the caller maps that to 401). The JSON shape is
 * the one zapClient sends: {kind, holder, issuer, permissions, expiresAt}.
 */
export function decodeCapabilityHeader(
  raw: string | string[] | undefined,
): CapabilityFields | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: {
    kind?: number;
    holder?: string;
    issuer?: string;
    permissions?: string;
    expiresAt?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const hex = (s: string | undefined): Uint8Array => {
    const out = new Uint8Array(32);
    if (!s) return out;
    const clean = s.startsWith("0x") ? s.slice(2) : s;
    for (let i = 0; i < 32 && i * 2 + 1 < clean.length; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
  return {
    kind: (parsed.kind ?? CapKind.IAMSession) as CapKindValue,
    holder: hex(parsed.holder),
    issuer: hex(parsed.issuer),
    permissions: BigInt(parsed.permissions ?? Perm.SessionRead.toString()),
    expiresAt: BigInt(parsed.expiresAt ?? "0"),
  };
}

/**
 * Verify the structural invariants the bridge enforces before shipping a cap.
 * Fail-closed on the reserved kind. (Cryptographic verification is the Go
 * server's job; this is the boundary check that the dev header is well-formed.)
 */
export function verifyCapabilityFields(c: CapabilityFields): CapabilityFields {
  if (c.kind === CapKind.Reserved) {
    throw new CapabilityVerificationError(
      "CapKindReserved is not a usable kind",
    );
  }
  if (
    c.expiresAt !== 0n &&
    c.expiresAt < BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new CapabilityVerificationError("capability expired");
  }
  return c;
}

/**
 * Build the opaque binary Capability buffer from decoded fields. This is the
 * exact wire shape github.com/zap-proto/go/cap.Wrap parses and the
 * ui-customization server gates on (Kind + Permissions). The Sig footer is
 * zero (bootstrap; the server skips the signature step with no issuer registry).
 */
export function buildCapabilityBuffer(c: CapabilityFields): Uint8Array {
  return newCapability({
    kind: c.kind,
    target: ZERO32,
    holder: c.holder,
    issuer: c.issuer,
    permissions: c.permissions,
    parent: ZERO32,
    issuedAt: 0n,
    expiresAt: c.expiresAt,
    caveats: [],
    sig: ZERO_SIG,
  });
}
