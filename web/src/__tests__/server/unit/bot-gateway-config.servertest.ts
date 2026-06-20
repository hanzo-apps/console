/**
 * Unit coverage for the bot gateway configuration gate.
 *
 * `isBotGatewayConfigured()` is the single source of truth that lets read-only
 * bot endpoints (e.g. `bots.list`) degrade gracefully to an empty result when
 * the optional bot control plane is not wired up for a deployment — instead of
 * throwing PRECONDITION_FAILED (412), which surfaces an error and can combine
 * with a re-auth bounce to eject the user out of console.
 *
 * No Postgres needed: this exercises pure env-driven detection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Mutable env stand-in so each case can toggle the gateway token vars.
const mockEnv: Record<string, string | undefined> = {};

vi.mock("@/src/env.mjs", () => ({
  get env() {
    return mockEnv;
  },
}));

afterEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  vi.resetModules();
});

async function loadIsConfigured() {
  const mod = await import("@/src/features/bots/server/zapClient");
  return mod.isBotGatewayConfigured;
}

describe("isBotGatewayConfigured", () => {
  it("returns false when no gateway token is set (graceful-degradation case)", async () => {
    const isBotGatewayConfigured = await loadIsConfigured();
    expect(isBotGatewayConfigured()).toBe(false);
  });

  it("returns true when ZAP_BOT_GATEWAY_TOKEN is set", async () => {
    mockEnv.ZAP_BOT_GATEWAY_TOKEN = "zap-token";
    const isBotGatewayConfigured = await loadIsConfigured();
    expect(isBotGatewayConfigured()).toBe(true);
  });

  it("returns true when the legacy BOT_GATEWAY_TOKEN is set", async () => {
    mockEnv.BOT_GATEWAY_TOKEN = "legacy-token";
    const isBotGatewayConfigured = await loadIsConfigured();
    expect(isBotGatewayConfigured()).toBe(true);
  });

  it("treats an empty-string token as not configured", async () => {
    mockEnv.ZAP_BOT_GATEWAY_TOKEN = "";
    mockEnv.BOT_GATEWAY_TOKEN = "";
    const isBotGatewayConfigured = await loadIsConfigured();
    expect(isBotGatewayConfigured()).toBe(false);
  });
});
