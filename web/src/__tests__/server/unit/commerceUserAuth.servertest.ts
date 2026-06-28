import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the unit: stub the heavy env module and the IAM client so the test
// exercises ONLY the fail-closed decision logic.
vi.mock("@/src/env.mjs", () => ({
  env: { COMMERCE_API_AUDIENCE: "hanzo-console" },
}));

const iamIssueUserToken = vi.fn();
vi.mock("@/src/features/auth/lib/iamServer", () => ({
  iamIssueUserToken: (...args: unknown[]) => iamIssueUserToken(...args),
}));

import { commerceUserAuthorization } from "@/src/server/commerceUserAuth";

describe("commerceUserAuthorization — fail-closed per-user commerce auth", () => {
  beforeEach(() => iamIssueUserToken.mockReset());

  it("throws (never bills via a shared token) when there is no IAM identity", async () => {
    await expect(commerceUserAuthorization(undefined)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // It must short-circuit BEFORE attempting to mint — no identity, no call.
    expect(iamIssueUserToken).not.toHaveBeenCalled();
  });

  it("throws (fail-closed, no service-token fallback) when no token can be issued", async () => {
    iamIssueUserToken.mockResolvedValue(null);
    await expect(
      commerceUserAuthorization("acme/alice"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // The signed-in user's own sub + the commerce audience are forwarded.
    expect(iamIssueUserToken).toHaveBeenCalledWith(
      "acme/alice",
      "hanzo-console",
    );
  });

  it("returns a Bearer header carrying the per-user IAM JWT on success", async () => {
    iamIssueUserToken.mockResolvedValue("eyJhbG.payload.sig");
    await expect(commerceUserAuthorization("acme/alice")).resolves.toBe(
      "Bearer eyJhbG.payload.sig",
    );
  });
});
