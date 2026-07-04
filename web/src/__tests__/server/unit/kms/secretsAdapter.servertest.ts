/**
 * Unit coverage for the unified Hanzo Cloud KMS secrets adapter — the ONE place
 * the console maps between its Infisical-shaped secret model and the unified KMS
 * REST contract at `/v1/kms/orgs/:org/secrets` (cloud/clients/kmssvc).
 *
 * No Postgres / no network: the transport (kmsClient) is mocked, so these tests
 * pin exactly the URLs, query params, and request bodies the adapter emits, plus
 * the metadata+value → KmsSecret mapping the UI consumes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { kmsGet, kmsPost, kmsDelete } = vi.hoisted(() => ({
  kmsGet: vi.fn(),
  kmsPost: vi.fn(),
  kmsDelete: vi.fn(),
}));

vi.mock("@/src/features/kms/server/kmsClient", () => ({
  kmsGet,
  kmsPost,
  kmsDelete,
}));

async function loadAdapter() {
  return import("@/src/features/kms/server/secretsAdapter");
}

beforeEach(() => {
  kmsGet.mockReset();
  kmsPost.mockReset();
  kmsDelete.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("listOrgSecrets", () => {
  it("lists metadata then inlines each value, mapping to the KmsSecret shape", async () => {
    const { listOrgSecrets } = await loadAdapter();

    kmsGet.mockImplementation((path: string) => {
      if (path === "/v1/kms/orgs/acme/secrets") {
        return Promise.resolve({
          secrets: [
            { name: "DB_URL", path: "/orgs/acme", env: "dev", scheme: "aead" },
            {
              name: "API_KEY",
              path: "/orgs/acme/ci",
              env: "dev",
              scheme: "aead",
            },
          ],
        });
      }
      if (path === "/v1/kms/orgs/acme/secrets/DB_URL") {
        return Promise.resolve({
          name: "DB_URL",
          env: "dev",
          value: "postgres://x",
        });
      }
      if (path === "/v1/kms/orgs/acme/secrets/ci/API_KEY") {
        return Promise.resolve({
          name: "API_KEY",
          env: "dev",
          value: "hk-123",
        });
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const { secrets } = await listOrgSecrets("acme", "dev", "/");

    // Root list carries the env; an empty subpath is elided (undefined).
    expect(kmsGet).toHaveBeenCalledWith("/v1/kms/orgs/acme/secrets", {
      env: "dev",
      path: undefined,
    });
    // The nested secret's value is read at its org-relative subpath, not the
    // full /orgs/:org store path returned in the metadata.
    expect(kmsGet).toHaveBeenCalledWith(
      "/v1/kms/orgs/acme/secrets/ci/API_KEY",
      {
        env: "dev",
      },
    );

    expect(secrets).toEqual([
      {
        id: "DB_URL",
        version: 1,
        secretKey: "DB_URL",
        secretValue: "postgres://x",
        secretComment: undefined,
        environment: "dev",
        type: "shared",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "ci/API_KEY",
        version: 1,
        secretKey: "API_KEY",
        secretValue: "hk-123",
        secretComment: undefined,
        environment: "dev",
        type: "shared",
        createdAt: "",
        updatedAt: "",
      },
    ]);
  });

  it("shows a key with an empty value when its value read fails (best effort)", async () => {
    const { listOrgSecrets } = await loadAdapter();

    kmsGet.mockImplementation((path: string) => {
      if (path === "/v1/kms/orgs/acme/secrets") {
        return Promise.resolve({
          secrets: [
            { name: "DB_URL", path: "/orgs/acme", env: "dev", scheme: "aead" },
          ],
        });
      }
      return Promise.reject(new Error("read failed"));
    });

    const { secrets } = await listOrgSecrets("acme", "dev", "/");
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ secretKey: "DB_URL", secretValue: "" });
  });
});

describe("putOrgSecret", () => {
  it("upserts with the normalized subpath, name, env and value", async () => {
    const { putOrgSecret } = await loadAdapter();
    kmsPost.mockResolvedValue({ stored: true });

    await putOrgSecret("acme", "dev", "/ci", "API_KEY", "hk-123");

    expect(kmsPost).toHaveBeenCalledWith("/v1/kms/orgs/acme/secrets", {
      path: "ci",
      name: "API_KEY",
      env: "dev",
      value: "hk-123",
    });
  });

  it("defaults an empty environment to the KMS 'default' env and roots at ''", async () => {
    const { putOrgSecret } = await loadAdapter();
    kmsPost.mockResolvedValue({ stored: true });

    await putOrgSecret("acme", "", "/", "DB_URL", "postgres://x");

    expect(kmsPost).toHaveBeenCalledWith("/v1/kms/orgs/acme/secrets", {
      path: "",
      name: "DB_URL",
      env: "default",
      value: "postgres://x",
    });
  });
});

describe("deleteOrgSecret", () => {
  it("deletes the wildcard target with the env query", async () => {
    const { deleteOrgSecret } = await loadAdapter();
    kmsDelete.mockResolvedValue({ deleted: true });

    await deleteOrgSecret("acme", "dev", "/ci", "API_KEY");

    expect(kmsDelete).toHaveBeenCalledWith(
      "/v1/kms/orgs/acme/secrets/ci/API_KEY",
      {
        env: "dev",
      },
    );
  });
});
