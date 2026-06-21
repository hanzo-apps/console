import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useIam } from "@hanzo/iam/react";
import { env } from "@/src/env.mjs";
import { HanzoCloudIcon } from "@/src/components/HanzoLogo";
import { getSafeRedirectPath } from "@/src/utils/redirect";

/**
 * OAuth callback for the IAM-native PKCE flow (social login + any redirect-based
 * IAM sign-in). `handleCallback()` exchanges the code through console's
 * same-origin `/v1/iam/oauth/token` proxy, which validates the access token
 * against IAM's JWKS and sets the signed `hi_session` cookie. So once the
 * exchange returns, the console session is live — we just redirect.
 *
 * IAM is the identity authority; console holds only the signed session cookie.
 */
export default function IamCallback() {
  const router = useRouter();
  const { handleCallback } = useIam();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !router.isReady) return;
    ran.current = true;

    const basePath = env.NEXT_PUBLIC_BASE_PATH ?? "";
    const targetPath = getSafeRedirectPath(
      (router.query.targetPath as string | undefined) ?? "/",
    );

    void (async () => {
      try {
        // Exchanges the code via /v1/iam/oauth/token (sets the hi_session cookie).
        await handleCallback();
        await router.replace(targetPath ?? `${basePath}/`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
      }
    })();
  }, [router, handleCallback]);

  return (
    <>
      <Head>
        <title>Signing in | Hanzo Cloud</title>
      </Head>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
        <HanzoCloudIcon className="mx-auto" />
        {error ? (
          <>
            <p className="text-destructive text-center text-sm font-medium">
              {error}
            </p>
            <a
              href={`${env.NEXT_PUBLIC_BASE_PATH ?? ""}/auth/sign-in`}
              className="text-primary-accent text-sm font-semibold"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Completing sign-in…</p>
        )}
      </div>
    </>
  );
}
