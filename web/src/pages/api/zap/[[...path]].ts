import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@hanzo/shared/src/db";
import {
  CapKind,
  Perm,
  verifyCapability,
  CapabilityDeniedError,
  CapabilityVerificationError,
  type Capability,
} from "@/src/server/zap/context";
import {
  uiCustomizationGet,
  uiCustomizationGetModules,
} from "@/src/server/zap/dispatch";

/**
 * ZAP capability-RPC HTTP bridge (Pages Router — matches the repo's existing
 * pages/api/zap/* convention; next.config.js maps /v1/zap/* here).
 *
 * Wire: a ZAP Capability REPLACES the bearer JWT. The wielder presents it in the
 * `x-zap-capability` header. For dev we accept a JSON-encoded capability (the
 * binary CapProof + holderSig path is the same milestone as the real verifier —
 * see verifyCapability TODO). The body selects the method:
 *
 *   POST /v1/zap/ui-customization   { "method": "get" | "getModules" }
 *
 * Returns JSON. Dispatch runs through a real zap-es Conn (see dispatch.ts), so
 * capability gating, Server.impl, and promise pipelining all execute.
 */

/** Decode the dev JSON capability header into a {@link Capability}. */
function decodeCapabilityHeader(req: NextApiRequest): Capability | null {
  const raw = req.headers["x-zap-capability"];
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: {
    kind?: number;
    holder?: string; // hex
    issuer?: string; // hex
    permissions?: string; // bigint as decimal/hex string
    expiresAt?: string;
    caveatKinds?: number[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const hex = (s: string | undefined, len: number): Uint8Array => {
    const out = new Uint8Array(len);
    if (!s) return out;
    const clean = s.startsWith("0x") ? s.slice(2) : s;
    for (let i = 0; i < len && i * 2 + 1 < clean.length; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
  return {
    kind: (parsed.kind ?? CapKind.IAMSession) as Capability["kind"],
    holder: hex(parsed.holder, 32),
    issuer: hex(parsed.issuer, 32),
    permissions: BigInt(parsed.permissions ?? Perm.SessionRead.toString()),
    expiresAt: BigInt(parsed.expiresAt ?? "0"),
    caveatKinds: parsed.caveatKinds ?? [],
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Resolve the target interface from the path: /v1/zap/<interface>.
  const pathParts = (req.query.path ?? []) as string[];
  const iface = pathParts[0];
  if (iface !== "ui-customization") {
    return res
      .status(404)
      .json({ error: `Unknown ZAP interface: ${iface ?? "(none)"}` });
  }

  // Decode + verify the inbound capability (REPLACES next-auth session).
  const presented = decodeCapabilityHeader(req);
  if (!presented) {
    return res
      .status(401)
      .json({ error: "Missing or malformed x-zap-capability" });
  }
  let cap: Capability;
  try {
    cap = verifyCapability(presented);
  } catch (err) {
    if (err instanceof CapabilityVerificationError) {
      return res.status(401).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  const body = req.body as { method?: string };
  const method = body?.method ?? "get";

  try {
    if (method === "get") {
      return res
        .status(200)
        .json({ result: await uiCustomizationGet(cap, prisma) });
    }
    if (method === "getModules") {
      return res
        .status(200)
        .json({ result: await uiCustomizationGetModules(cap, prisma) });
    }
    return res.status(404).json({ error: `Unknown method: ${method}` });
  } catch (err) {
    if (err instanceof CapabilityDeniedError) {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[zap/ui-customization]", message);
    return res.status(500).json({ error: message });
  }
}
