/**
 * Console-native client session — the one client surface for auth, backed
 * directly by Hanzo IAM (no next-auth). It mirrors the `useSession`/`signIn`/
 * `signOut`/`SessionProvider` contract so call sites are unchanged, but every
 * path talks to IAM or console's own `/v1/iam/*` routes:
 *
 *   - SessionProvider polls `GET /v1/iam/session` for the hydrated console
 *     session (server validates the signed `hi_session` cookie).
 *   - signIn("credentials", {email,password}) → POST /v1/iam/signin
 *   - signIn("iam-token", {accessToken})       → POST /v1/iam/token-session
 *   - signIn(<social provider>)                → IAM OIDC/PKCE redirect
 *   - signOut() → POST /v1/iam/signout (+ IAM logout)
 *
 * The rich session shape is defined in `./session-types` and hydrated server-side.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { env } from "@/src/env.mjs";
import { type Session } from "@/src/features/auth/session-types";
import { getBrandFromHost } from "@/src/features/branding/brandRegistry";

export { type Session } from "@/src/features/auth/session-types";

const BASE = env.NEXT_PUBLIC_BASE_PATH ?? "";
const SESSION_URL = `${BASE}/v1/iam/session`;

export type SessionStatus = "authenticated" | "unauthenticated" | "loading";

export type SessionContextValue = {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
};

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined,
);

async function fetchSession(): Promise<Session | null> {
  try {
    const res = await fetch(SESSION_URL, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Session | Record<string, never>;
    // Endpoint returns `{}` (not null) when unauthenticated, mirroring next-auth.
    return data && "user" in data && data.user ? (data as Session) : null;
  } catch {
    return null;
  }
}

/**
 * Mirrors next-auth's `<SessionProvider>` so it is a drop-in at the app shell.
 * Extra next-auth props (basePath, refetchOnWindowFocus, …) are accepted and
 * ignored for source compatibility.
 */
export function SessionProvider({
  children,
  refetchInterval,
}: {
  children: ReactNode;
  session?: Session | null;
  basePath?: string;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
}) {
  const [data, setData] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const mounted = useRef(true);

  const update = useCallback(async () => {
    const s = await fetchSession();
    if (!mounted.current) return s;
    setData(s);
    setStatus(s ? "authenticated" : "unauthenticated");
    return s;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void update();
    return () => {
      mounted.current = false;
    };
  }, [update]);

  useEffect(() => {
    if (!refetchInterval) return;
    const id = setInterval(() => void update(), refetchInterval * 1000);
    return () => clearInterval(id);
  }, [refetchInterval, update]);

  const value = useMemo<SessionContextValue>(
    () => ({ data, status, update }),
    [data, status, update],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/** Drop-in for next-auth's non-hook `getSession()` — fetches the current session. */
export async function getSession(): Promise<Session | null> {
  return fetchSession();
}

/** Drop-in for next-auth's `useSession()`. */
export function useSession(): {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
} {
  const ctx = useContext(SessionContext);
  if (!ctx) return { data: null, status: "loading", update: async () => null };
  return ctx;
}

// ── Imperative auth actions (next-auth-compatible signatures) ────────────────

// The IAM browser SDK is loaded lazily (dynamic import) so a resolution issue
// can never crash this module's primary surface (useSession/credentials login,
// which never touch it). Only social signIn + signOut token-clear use it; the
// PKCE callback itself runs through the proven @hanzo/iam/react IamProvider.
type IamBrowser = {
  signinRedirect(opts?: {
    additionalParams?: Record<string, string>;
  }): Promise<void>;
  clearTokens(): void;
};
let cachedSdk: IamBrowser | null = null;
async function browserIam(): Promise<IamBrowser | null> {
  if (cachedSdk) return cachedSdk;
  if (typeof window === "undefined") return null;
  // White-label by host: resolve the brand's public IAM OIDC config at runtime
  // from the brand registry, so client SSO works without build-time
  // NEXT_PUBLIC_IAM_* inlining (one image serves every brand). A deploy-set
  // NEXT_PUBLIC_IAM_* still wins if present.
  const brand = getBrandFromHost(window.location.hostname);
  const serverUrl = env.NEXT_PUBLIC_IAM_SERVER_URL || brand.iamServerUrl;
  const clientId = env.NEXT_PUBLIC_IAM_CLIENT_ID || brand.iamClientId;
  if (!serverUrl || !clientId) return null;
  const { BrowserIamSdk } = await import("@hanzo/iam/browser");
  cachedSdk = new BrowserIamSdk({
    serverUrl,
    clientId,
    redirectUri: `${window.location.origin}${BASE}/auth/iam/callback`,
    scope: "openid profile email",
    proxyBaseUrl: `${window.location.origin}${BASE}/v1/iam`,
  }) as unknown as IamBrowser;
  return cachedSdk;
}

export type SignInOptions = {
  redirect?: boolean;
  callbackUrl?: string;
  email?: string;
  password?: string;
  accessToken?: string;
};

export type SignInResponse = {
  ok: boolean;
  error: string | null;
  status: number;
  url: string | null;
};

/**
 * Drop-in for next-auth's `signIn`. `credentials`/`iam-token` post to console's
 * `/v1/iam/*` routes (which set the signed session cookie); any other provider
 * id starts the IAM OIDC/PKCE redirect (IAM brokers GitHub/Google/etc.).
 */
export async function signIn(
  provider?: string,
  options?: SignInOptions,
): Promise<SignInResponse | undefined> {
  const callbackUrl = options?.callbackUrl ?? `${BASE}/`;

  if (provider === "credentials" || provider === "iam-token") {
    const url =
      provider === "credentials"
        ? `${BASE}/v1/iam/signin`
        : `${BASE}/v1/iam/token-session`;
    const body =
      provider === "credentials"
        ? { email: options?.email, password: options?.password }
        : { accessToken: options?.accessToken };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    const result: SignInResponse = {
      ok: res.ok,
      error: res.ok ? null : (json.error ?? "Sign in failed"),
      status: res.status,
      url: res.ok ? callbackUrl : null,
    };
    if (res.ok && options?.redirect !== false) {
      window.location.href = callbackUrl;
    }
    return result;
  }

  // Social / OIDC provider: hand off to IAM's authorize endpoint via PKCE.
  const sdk = await browserIam();
  if (!sdk) {
    return {
      ok: false,
      error: "IAM is not configured.",
      status: 503,
      url: null,
    };
  }
  await sdk.signinRedirect(
    provider ? { additionalParams: { provider } } : undefined,
  );
  return undefined; // redirect in flight
}

export type SignOutOptions = { redirect?: boolean; callbackUrl?: string };

/** Drop-in for next-auth's `signOut`: clears the console session + IAM session. */
export async function signOut(
  options?: SignOutOptions,
): Promise<{ url: string }> {
  const callbackUrl = options?.callbackUrl ?? `${BASE}/auth/sign-in`;
  try {
    await fetch(`${BASE}/v1/iam/signout`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    /* best-effort */
  }
  try {
    (await browserIam())?.clearTokens();
  } catch {
    /* best-effort */
  }
  if (options?.redirect !== false && typeof window !== "undefined") {
    window.location.href = callbackUrl;
  }
  return { url: callbackUrl };
}
