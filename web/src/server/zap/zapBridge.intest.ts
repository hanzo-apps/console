/**
 * Native ZAP bridge integration test (vitest `in-source` project — no DB).
 *
 * Drives the WHOLE native path end-to-end: it boots the real ui-customization
 * Go service binary, points the bridge at it via UI_CUSTOMIZATION_ZAP_URL, and
 * exercises the Next API handler exactly as a browser request would — building
 * the capability, shipping it over the @hanzo/zap TCP transport to the Go
 * service, and decoding the typed result. NO capnp anywhere.
 *
 * Covers: (1) a CapKindIAMSession cap holding PermSessionRead succeeds for both
 * get and getModules; (2) a cap lacking PermSessionRead is denied (403).
 *
 * Guarded by RUN_ZAP_E2E=1 (it spawns an external process + binds TCP ports);
 * skipped otherwise so the default in-source lane stays hermetic. The test
 * block is tree-shaken out of production by the `import.meta.vitest` guard.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";

/** CapKindIAMSession (0x01); PermSessionRead = 1<<0, PermSessionWrite = 1<<1. */
const CAP_KIND_IAM_SESSION = 0x01;
const PERM_SESSION_READ = "1";
const PERM_SESSION_WRITE = "2";

/** Build the dev JSON capability header zapClient sends. */
function capHeader(permissions: string): string {
  return JSON.stringify({
    kind: CAP_KIND_IAM_SESSION,
    holder: "00".repeat(32),
    issuer: "00".repeat(32),
    permissions,
    expiresAt: "0",
    caveatKinds: [],
  });
}

/** Wait until host:port accepts a TCP connection, or throw after `timeoutMs`. */
async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((res) => {
      const sock = createConnection({ host, port }, () => {
        sock.destroy();
        res(true);
      });
      sock.on("error", () => res(false));
      sock.setTimeout(500, () => {
        sock.destroy();
        res(false);
      });
    });
    if (ok) return;
    if (Date.now() > deadline)
      throw new Error(`port ${host}:${port} not up in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, afterAll } = import.meta.vitest;

  const run = process.env.RUN_ZAP_E2E === "1";
  const ZAP_PORT = 19999;
  const HTTP_PORT = 18090;
  // ui-customization repo: ~/work/hanzo/ui-customization (peer of console).
  const SVC_DIR = resolve(process.cwd(), "../../../hanzo/ui-customization");

  describe.skipIf(!run)("native ZAP bridge -> Go service (e2e)", () => {
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      const bin = resolve(SVC_DIR, "ui-customization");
      if (!existsSync(bin)) {
        const build = spawnSync(
          "go",
          ["build", "-o", "ui-customization", "."],
          {
            cwd: SVC_DIR,
            env: { ...process.env, CGO_ENABLED: "0", GOWORK: "off" },
            encoding: "utf8",
          },
        );
        if (build.status !== 0) {
          throw new Error(`go build failed: ${build.stderr || build.stdout}`);
        }
      }
      proc = spawn(
        bin,
        [
          "serve",
          `--http=127.0.0.1:${HTTP_PORT}`,
          `--zap=127.0.0.1:${ZAP_PORT}`,
          "--vaultDir=/tmp/uic-e2e-vault",
          "--org=test-org",
        ],
        {
          cwd: SVC_DIR,
          env: {
            ...process.env,
            HANZO_UI_PRESENT: "true",
            HANZO_UI_API_HOST: "ui.example.test",
          },
          stdio: "ignore",
        },
      );
      process.env.UI_CUSTOMIZATION_ZAP_URL = `tcp://127.0.0.1:${ZAP_PORT}`;
      await waitForPort("127.0.0.1", ZAP_PORT, 30_000);
      // Small settle so the ZAP node finishes its handshake listener wiring.
      await new Promise((r) => setTimeout(r, 300));
    }, 60_000);

    afterAll(() => {
      proc?.kill("SIGKILL");
    });

    async function callBridge(method: string, permissions: string) {
      // Import the handler fresh so it reads the env we set above.
      const handler = (await import("@/src/pages/api/zap/[[...path]]")).default;
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        query: { path: ["ui-customization"] },
        headers: { "x-zap-capability": capHeader(permissions) },
        body: { method },
      });
      await handler(req, res);
      return { status: res._getStatusCode(), json: res._getJSONData() };
    }

    it("get succeeds with PermSessionRead and returns the seeded config", async () => {
      const { status, json } = await callBridge("get", PERM_SESSION_READ);
      expect(status).toBe(200);
      expect(json.result.present).toBe(true);
      expect(json.result.hostname).toBe("ui.example.test");
      expect(Array.isArray(json.result.visibleModules)).toBe(true);
      expect(json.result.visibleModules.length).toBeGreaterThan(0);
    });

    it("getModules succeeds with PermSessionRead and returns the module list", async () => {
      const { status, json } = await callBridge(
        "getModules",
        PERM_SESSION_READ,
      );
      expect(status).toBe(200);
      expect(Array.isArray(json.result)).toBe(true);
      expect(json.result.length).toBeGreaterThan(0);
    });

    it("denies a cap lacking PermSessionRead (capability-denied, 403)", async () => {
      const { status, json } = await callBridge("get", PERM_SESSION_WRITE);
      expect(status).toBe(403);
      expect(typeof json.error).toBe("string");
      expect(json.error).toMatch(/PermSessionRead|forbidden|capability/i);
    });
  });
}
