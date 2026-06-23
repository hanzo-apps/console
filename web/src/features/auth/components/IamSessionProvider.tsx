import { type ReactNode, useMemo } from "react";
import { IamProvider as HanzoIamReactProvider } from "@hanzo/iam/react";
import { type BrowserIamConfig } from "@hanzo/iam/browser";
import { env } from "@/src/env.mjs";

/**
 * App-shell provider that mounts the canonical `@hanzo/iam/react` IamProvider so
 * console code can use `useIam()` for IAM-native session/login/logout. IAM is
 * the native identity; the BrowserIamSdk drives OIDC discovery + PKCE against
 * `NEXT_PUBLIC_IAM_SERVER_URL` and proxies token/userinfo through console's own
 * `/v1/iam/*` routes to avoid cross-origin issues.
 *
 * When the client IAM env is not configured this is a transparent pass-through,
 * so the app shell is unaffected on instances that have not enabled IAM-native
 * client auth yet.
 *
 * SSR-safety: the IAM SDK reads its storage at construction. We pass an
 * in-memory Storage during prerender (no `window`) so the provider can render
 * server-side too — letting `useIam()` consumers (e.g. the callback page) be
 * statically prerendered without a "must be used within <IamProvider>" throw.
 * On the client the real `sessionStorage` is used.
 */
function createMemoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  } as Storage;
}

export function IamSessionProvider({ children }: { children: ReactNode }) {
  const config = useMemo<BrowserIamConfig | null>(() => {
    const serverUrl = env.NEXT_PUBLIC_IAM_SERVER_URL;
    const clientId = env.NEXT_PUBLIC_IAM_CLIENT_ID;
    if (!serverUrl || !clientId) return null;

    const basePath = env.NEXT_PUBLIC_BASE_PATH ?? "";
    const isClient = typeof window !== "undefined";
    const origin = isClient ? window.location.origin : "";

    return {
      serverUrl,
      clientId,
      orgName: env.NEXT_PUBLIC_IAM_ORG_NAME,
      appName: env.NEXT_PUBLIC_IAM_APP_NAME,
      redirectUri: `${origin}${basePath}/auth/iam/callback`,
      scope: "openid profile email",
      // Route token/userinfo through console so the browser never hits IAM
      // cross-origin (and so console can bridge the IAM token into a session).
      proxyBaseUrl: `${origin}${basePath}/v1/iam`,
      // Real sessionStorage on the client; in-memory during SSR/prerender.
      storage: isClient ? window.sessionStorage : createMemoryStorage(),
    };
  }, []);

  if (!config) return <>{children}</>;

  return (
    <HanzoIamReactProvider config={config} autoInit>
      {children}
    </HanzoIamReactProvider>
  );
}
