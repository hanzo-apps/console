import type { NextApiRequest, NextApiResponse } from "next";
import { ZapClient, Method, Status, type Response } from "@hanzo/zap";
import {
  decodeCapabilityHeader,
  verifyCapabilityFields,
  buildCapabilityBuffer,
  CapabilityVerificationError,
} from "@/src/server/zap/capability";
import {
  UiCustomizationConfig,
  VisibleModules,
} from "@/src/server/zap/gen/ui-customization_zap";

/**
 * ZAP capability-RPC bridge (Pages Router; next.config maps /v1/zap/* here).
 *
 * Thin HTTP -> TCP proxy onto the native ZAP service binary. The wielder's
 * Capability REPLACES the bearer JWT (zap-proto/zap-spec/SPEC.md §1) and travels
 * in `x-zap-capability`; the bridge decodes it, builds the opaque binary cap
 * buffer, and ships it over the @hanzo/zap TCP client to the Go ui-customization
 * service. NO capnp, NO in-process server — the backend lives in Go.
 *
 *   POST /v1/zap/ui-customization   { "method": "get" | "getModules" }
 *
 * Target service address: UI_CUSTOMIZATION_ZAP_URL (default tcp://127.0.0.1:9999).
 */

/** Parse tcp://host:port (or host:port) into {host, port}. */
function parseZapUrl(raw: string): { host: string; port: number } {
  const s = raw.startsWith("tcp://") ? raw.slice("tcp://".length) : raw;
  const i = s.lastIndexOf(":");
  if (i < 0) return { host: s, port: 9999 };
  const port = parseInt(s.slice(i + 1), 10);
  return {
    host: s.slice(0, i) || "127.0.0.1",
    port: Number.isFinite(port) ? port : 9999,
  };
}

function serviceAddr(): { host: string; port: number } {
  return parseZapUrl(
    process.env.UI_CUSTOMIZATION_ZAP_URL ?? "tcp://127.0.0.1:9999",
  );
}

/** A plain-object UiCustomizationConfig — the JSON the frontend reads. */
export interface UiCustomizationConfigJSON {
  present: boolean;
  hostname: string;
  documentationHref: string;
  supportHref: string;
  feedbackHref: string;
  logoLightModeHref: string;
  logoDarkModeHref: string;
  defaultModelAdapter: string;
  defaultBaseUrlOpenAI: string;
  defaultBaseUrlAnthropic: string;
  defaultBaseUrlAzure: string;
  visibleModules: string[];
}

function configToJSON(c: UiCustomizationConfig): UiCustomizationConfigJSON {
  return {
    present: c.present,
    hostname: c.hostname,
    documentationHref: c.documentationHref,
    supportHref: c.supportHref,
    feedbackHref: c.feedbackHref,
    logoLightModeHref: c.logoLightModeHref,
    logoDarkModeHref: c.logoDarkModeHref,
    defaultModelAdapter: c.defaultModelAdapter,
    defaultBaseUrlOpenAI: c.defaultBaseUrlOpenAI,
    defaultBaseUrlAnthropic: c.defaultBaseUrlAnthropic,
    defaultBaseUrlAzure: c.defaultBaseUrlAzure,
    visibleModules: c.visibleModules.toStringArray(),
  };
}

/** Decode an error body ({"error":"…"}) into a message. */
function errorMessage(resp: Response): string {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(resp.body)) as {
      error?: string;
    };
    return parsed.error ?? `status ${resp.status}`;
  } catch {
    return `status ${resp.status}`;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const pathParts = (req.query.path ?? []) as string[];
  const iface = pathParts[0];
  if (iface !== "ui-customization") {
    return res
      .status(404)
      .json({ error: `Unknown ZAP interface: ${iface ?? "(none)"}` });
  }

  // Decode + verify the inbound capability (REPLACES next-auth session).
  const fields = decodeCapabilityHeader(req.headers["x-zap-capability"]);
  if (!fields) {
    return res
      .status(401)
      .json({ error: "Missing or malformed x-zap-capability" });
  }
  let capBuf: Uint8Array;
  try {
    capBuf = buildCapabilityBuffer(verifyCapabilityFields(fields));
  } catch (err) {
    if (err instanceof CapabilityVerificationError) {
      return res.status(401).json({ error: err.message });
    }
    throw err;
  }

  const body = req.body as { method?: string };
  const method = body?.method ?? "get";

  const addr = serviceAddr();
  let client: ZapClient;
  try {
    client = await ZapClient.connect(
      { host: addr.host, port: addr.port, nodeID: "console-bridge" },
      capBuf,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "connect failed";
    console.error("[zap/ui-customization] connect", message);
    return res
      .status(502)
      .json({ error: `ZAP service unreachable: ${message}` });
  }

  try {
    if (method === "get") {
      const resp = await client.call(Method.Get);
      if (resp.status === Status.Forbidden) {
        return res.status(403).json({ error: errorMessage(resp) });
      }
      if (resp.status !== Status.OK) {
        return res.status(resp.status >= 400 ? resp.status : 500).json({
          error: errorMessage(resp),
        });
      }
      return res
        .status(200)
        .json({ result: configToJSON(UiCustomizationConfig.wrap(resp.body)) });
    }
    if (method === "getModules") {
      const resp = await client.call(Method.GetModules);
      if (resp.status === Status.Forbidden) {
        return res.status(403).json({ error: errorMessage(resp) });
      }
      if (resp.status !== Status.OK) {
        return res.status(resp.status >= 400 ? resp.status : 500).json({
          error: errorMessage(resp),
        });
      }
      const mods = VisibleModules.wrap(resp.body).modules.toStringArray();
      return res.status(200).json({ result: mods });
    }
    return res.status(404).json({ error: `Unknown method: ${method}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[zap/ui-customization]", message);
    return res.status(500).json({ error: message });
  } finally {
    client.close();
  }
}
