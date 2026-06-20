/**
 * Pure IAM identity types + response-mapping helpers.
 *
 * Env-free and side-effect-free so the credential-authority parsing (how an IAM
 * response envelope becomes a console identity) is unit-testable in isolation
 * from the HTTP client and env. {@link iamServer} composes these with the
 * `@hanzo/iam` SDK.
 */

export type IamIdentity = {
  /** IAM subject — canonical `org/username` user id. Authoritative identity. */
  sub: string;
  email: string;
  name: string | null;
  image: string | null;
};

export type IamLoginResult =
  | { ok: true; identity: IamIdentity }
  | { ok: false; error: string };

/** Shape of the Casdoor `Response` envelope returned by IAM endpoints. */
export type IamResponse<T = unknown> = {
  status: "ok" | "error";
  msg?: string;
  sub?: string;
  name?: string;
  data?: T;
  data2?: unknown;
  data3?: unknown;
};

/**
 * Pure mapping from an IAM `/v1/iam/login` response envelope to an
 * {@link IamLoginResult}. The IAM `sub` (org/username) is taken from `res.sub`,
 * falling back to `res.data` (Casdoor returns the user id there when no OAuth
 * `type` is requested).
 */
export function identityFromLoginResponse(
  res: IamResponse<string>,
  email: string,
): IamLoginResult {
  if (res.status !== "ok") {
    return { ok: false, error: res.msg || "Invalid credentials" };
  }
  const sub = res.sub || (typeof res.data === "string" ? res.data : "");
  if (!sub) return { ok: false, error: "IAM did not return an identity." };
  return {
    ok: true,
    identity: {
      sub,
      email: email.toLowerCase(),
      name: res.name || null,
      image: null,
    },
  };
}
