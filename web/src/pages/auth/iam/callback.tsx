import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { signIn } from "next-auth/react";
import { useIam } from "@hanzo/iam/react";
import { env } from "@/src/env.mjs";
import { HanzoCloudIcon } from "@/src/components/HanzoLogo";
import { getSafeRedirectPath } from "@/src/utils/redirect";

/**
 * OAuth callback for the embedded `@hanzo/iam` flow (social login and any
 * redirect-based IAM sign-in). Completes the PKCE code exchange via the IAM
 * BrowserIamSdk, then bridges the resulting IAM access token into a console
 * NextAuth session through the `iam-token` credentials provider.
 *
 * IAM is the identity here; NextAuth is only the session transport that carries
 * the IAM-derived identity (orgs/projects/roles hydrate from console Postgres).
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
        const tokens = await handleCallback();
        const result = await signIn("iam-token", {
          accessToken: tokens.access_token,
          redirect: false,
          callbackUrl: targetPath ?? `${basePath}/`,
        });
        if (!result || !result.ok) {
          setError(result?.error ?? "Failed to establish a session.");
          return;
        }
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
