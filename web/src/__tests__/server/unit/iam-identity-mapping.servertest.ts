import { describe, expect, it } from "vitest";
import {
  identityFromLoginResponse,
  type IamResponse,
} from "@/src/features/auth/lib/iamIdentity";

/**
 * Unit coverage for the IAM credential-authority parsing: how an IAM
 * `/v1/iam/login` response envelope maps to the console-side identity. This is
 * the load-bearing logic that makes IAM the native identity source.
 */
describe("identityFromLoginResponse", () => {
  it("maps an ok response with sub to an IAM-verified identity", () => {
    const res: IamResponse<string> = {
      status: "ok",
      sub: "hanzo/jane",
      name: "Jane Doe",
    };
    const result = identityFromLoginResponse(res, "[email protected]");
    expect(result).toEqual({
      ok: true,
      identity: {
        sub: "hanzo/jane",
        email: "[email protected]",
        name: "Jane Doe",
        image: null,
      },
    });
  });

  it("falls back to data as the sub (IAM returns userId in data with no OAuth type)", () => {
    const res: IamResponse<string> = {
      status: "ok",
      data: "hanzo/bob",
    };
    const result = identityFromLoginResponse(res, "[email protected]");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.sub).toBe("hanzo/bob");
      expect(result.identity.email).toBe("[email protected]");
      expect(result.identity.name).toBeNull();
    }
  });

  it("lowercases the email so the console user is keyed canonically", () => {
    const res: IamResponse<string> = { status: "ok", sub: "hanzo/x" };
    const result = identityFromLoginResponse(res, "[email protected]");
    expect(result.ok && result.identity.email).toBe("[email protected]");
  });

  it("returns the IAM error message when status is not ok", () => {
    const res: IamResponse<string> = {
      status: "error",
      msg: "password is incorrect",
    };
    const result = identityFromLoginResponse(res, "[email protected]");
    expect(result).toEqual({ ok: false, error: "password is incorrect" });
  });

  it("rejects an ok response that carries no identity", () => {
    const res: IamResponse<string> = { status: "ok" };
    const result = identityFromLoginResponse(res, "[email protected]");
    expect(result).toEqual({
      ok: false,
      error: "IAM did not return an identity.",
    });
  });
});
