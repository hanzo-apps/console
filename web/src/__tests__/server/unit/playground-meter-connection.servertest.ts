/**
 * Unit coverage for the Playground BYO-vs-meter connection decision.
 *
 * The Playground must meter AI usage to the signed-in user's org via the Hanzo
 * single meter (`api.hanzo.ai`) when the project has no BYO provider key — and
 * must NEVER route unmetered. This exercises the pure decision + the
 * resolve-or-mint of the user's `hk-` key + the synthetic meter connection,
 * with prisma + IAM + encryption mocked (no Postgres, no live IAM).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, iamGetUser, iamMintUserKeys } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  iamGetUser: vi.fn(),
  iamMintUserKeys: vi.fn(),
}));

// No CLOUD_API_URL set (mirrors live console) → meter base defaults to the
// public gateway.
vi.mock("@/src/env.mjs", () => ({ env: { CLOUD_API_URL: undefined } }));

vi.mock("@hanzo/console/src/db", () => ({
  prisma: { llmApiKeys: { findFirst } },
}));

vi.mock("@/src/features/auth/lib/iamServer", () => ({
  iamGetUser,
  iamMintUserKeys,
}));

// Faithful, hermetic encrypt/decrypt roundtrip: the helper must ENCRYPT the
// hk- key (fetchLLMCompletion decrypts secretKey before use), so we assert the
// key is recoverable rather than stored raw — without needing a real
// ENCRYPTION_KEY.
vi.mock("@hanzo/console/encryption", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
}));

import { decrypt } from "@hanzo/console/encryption";
import {
  buildMeterConnection,
  meterBaseUrl,
  resolvePlaygroundLlmConnection,
  resolveUserHkKey,
} from "@/src/features/playground/server/meterConnection";

const PROJECT = "proj_1";
const PROVIDER = "hanzo";
const SUB = "hanzo/[email protected]";
const METER = "https://api.hanzo.ai/v1";

// A minimal, schema-valid BYO row: encrypted secretKey, NON-meter baseURL.
const byoRow = {
  id: "key_byo",
  projectId: PROJECT,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  adapter: "openai",
  provider: PROVIDER,
  displaySecretKey: "sk-...byo",
  secretKey: "enc:sk-byo-secret",
  extraHeaders: null,
  extraHeaderKeys: [],
  baseURL: "https://byo.example.com/v1",
  customModels: [],
  withDefaultModels: true,
  config: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("meterBaseUrl", () => {
  it("defaults to the public Hanzo meter on the /v1 surface when CLOUD_API_URL is unset", () => {
    expect(meterBaseUrl()).toBe(METER);
  });
});

describe("buildMeterConnection", () => {
  it("builds a schema-valid OpenAI meter connection with the hk- key encrypted", () => {
    const conn = buildMeterConnection({
      hkKey: "hk-USER",
      provider: PROVIDER,
      projectId: PROJECT,
    });
    expect(conn.adapter).toBe("openai");
    expect(conn.provider).toBe(PROVIDER);
    expect(conn.baseURL).toBe(METER);
    expect(conn.secretKey).not.toBe("hk-USER"); // never stored raw
    expect(decrypt(conn.secretKey)).toBe("hk-USER"); // recoverable by fetchLLMCompletion
  });
});

describe("resolveUserHkKey", () => {
  it("returns the existing hk- key without minting", async () => {
    iamGetUser.mockResolvedValue({ accessKey: "hk-EXISTING" });
    await expect(resolveUserHkKey(SUB)).resolves.toBe("hk-EXISTING");
    expect(iamMintUserKeys).not.toHaveBeenCalled();
  });

  it("mints when the IAM user has no hk- key", async () => {
    iamGetUser.mockResolvedValue({ accessKey: undefined });
    iamMintUserKeys.mockResolvedValue({ ok: true, accessKey: "hk-MINTED" });
    await expect(resolveUserHkKey(SUB)).resolves.toBe("hk-MINTED");
    expect(iamMintUserKeys).toHaveBeenCalledWith(SUB);
  });

  it("throws (fail-closed) when there is no IAM identity, and does not mint", async () => {
    await expect(resolveUserHkKey(undefined)).rejects.toThrow(
      /No IAM identity/,
    );
    expect(iamGetUser).not.toHaveBeenCalled();
    expect(iamMintUserKeys).not.toHaveBeenCalled();
  });

  it("throws (fail-closed) when the key cannot be resolved or minted", async () => {
    iamGetUser.mockResolvedValue(null);
    iamMintUserKeys.mockResolvedValue({ ok: false, error: "IAM down" });
    await expect(resolveUserHkKey(SUB)).rejects.toThrow(
      /refusing to route Playground completion unmetered/,
    );
  });
});

describe("resolvePlaygroundLlmConnection (connection decision)", () => {
  it("BYO key present → project-key path; baseURL is NOT the meter; IAM untouched", async () => {
    findFirst.mockResolvedValue(byoRow);

    const conn = await resolvePlaygroundLlmConnection({
      projectId: PROJECT,
      provider: PROVIDER,
      iamSub: SUB,
    });

    expect(conn.baseURL).toBe("https://byo.example.com/v1");
    expect(conn.baseURL).not.toContain("api.hanzo.ai");
    expect(decrypt(conn.secretKey)).toBe("sk-byo-secret");
    expect(iamGetUser).not.toHaveBeenCalled();
    expect(iamMintUserKeys).not.toHaveBeenCalled();
  });

  it("no BYO key, user has hk- key → meter connection on the user's hk- key", async () => {
    findFirst.mockResolvedValue(null);
    iamGetUser.mockResolvedValue({ accessKey: "hk-USER" });

    const conn = await resolvePlaygroundLlmConnection({
      projectId: PROJECT,
      provider: PROVIDER,
      iamSub: SUB,
    });

    expect(conn.baseURL).toBe(METER);
    expect(decrypt(conn.secretKey)).toBe("hk-USER");
    expect(iamMintUserKeys).not.toHaveBeenCalled();
  });

  it("no BYO key, no hk- key, mint succeeds → uses the freshly-minted key", async () => {
    findFirst.mockResolvedValue(null);
    iamGetUser.mockResolvedValue({ accessKey: undefined });
    iamMintUserKeys.mockResolvedValue({ ok: true, accessKey: "hk-MINTED" });

    const conn = await resolvePlaygroundLlmConnection({
      projectId: PROJECT,
      provider: PROVIDER,
      iamSub: SUB,
    });

    expect(conn.baseURL).toBe(METER);
    expect(decrypt(conn.secretKey)).toBe("hk-MINTED");
    expect(iamMintUserKeys).toHaveBeenCalledWith(SUB);
  });

  it("no BYO key, mint fails → throws (fail-closed); no connection produced", async () => {
    findFirst.mockResolvedValue(null);
    iamGetUser.mockResolvedValue(null);
    iamMintUserKeys.mockResolvedValue({ ok: false, error: "IAM down" });

    await expect(
      resolvePlaygroundLlmConnection({
        projectId: PROJECT,
        provider: PROVIDER,
        iamSub: SUB,
      }),
    ).rejects.toThrow(/refusing to route Playground completion unmetered/);
  });
});
