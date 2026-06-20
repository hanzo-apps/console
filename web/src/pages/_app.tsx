import { type AppType } from "next/app";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { setUser } from "@sentry/nextjs";
import { useSession } from "next-auth/react";
import { TooltipProvider } from "@/src/components/ui/tooltip";
import { CommandMenuProvider } from "@/src/features/command-k-menu/CommandMenuProvider";

import { api } from "@/src/utils/api";

import NextAdapterPages from "next-query-params/pages";
import { QueryParamProvider } from "use-query-params";

import "@/src/styles/globals.css";
import { AppLayout } from "@/src/components/layouts/app-layout";
import { useEffect, useRef } from "react";
import { useRouter } from "next/router";

import insights from "@hanzo/insights";
import { InsightsProvider } from "@hanzo/insights-react";
import prexit from "prexit";

// Custom polyfills not yet available in `next-core`:
// https://github.com/vercel/next.js/issues/58242
// https://nextjs.org/docs/architecture/supported-browsers#custom-polyfills
import "core-js/features/array/to-reversed";
import "core-js/features/array/to-spliced";
import "core-js/features/array/to-sorted";

import "react18-json-view/src/style.css";
import "streamdown/styles.css";

// Polyfill to prevent React crashes when Google Translate modifies the DOM.
// Google Translate wraps text nodes in <font> elements, which breaks React's
// reconciliation when it tries to remove/insert nodes that no longer exist
// in the expected location. This catches NotFoundError and prevents crashes
// while still allowing translation to work.
// See: https://github.com/facebook/react/issues/11538
// See also: https://issues.chromium.org/issues/41407169
if (typeof window !== "undefined") {
  const originalRemoveChild = Element.prototype.removeChild;
  const originalInsertBefore = Element.prototype.insertBefore;

  Element.prototype.removeChild = function <T extends Node>(child: T): T {
    try {
      return originalRemoveChild.call(this, child) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        // Node was likely moved by Google Translate - silently ignore
        return child;
      }
      throw error;
    }
  };

  Element.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null,
  ): T {
    try {
      return originalInsertBefore.call(this, newNode, referenceNode) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        // Reference node was likely moved by Google Translate
        // Fallback: append to end (DOM is already inconsistent anyway)
        return this.appendChild(newNode) as T;
      }
      throw error;
    }
  };
}

import { DetailPageListsProvider } from "@/src/features/navigate-detail-pages/context";
import { env } from "@/src/env.mjs";
import { ThemeProvider } from "@/src/features/theming/ThemeProvider";
import { MarkdownContextProvider } from "@/src/features/theming/useMarkdownContext";
import { SupportDrawerProvider } from "@/src/features/support-chat/SupportDrawerProvider";
import { useConsoleCloudRegion } from "@/src/features/organizations/hooks";
import { ScoreCacheProvider } from "@/src/features/scores/contexts/ScoreCacheContext";
import { CorrectionCacheProvider } from "@/src/features/corrections/contexts/CorrectionCacheContext";
import { InAppAiAgentProvider } from "@/src/features/in-app-agent/components";
import { V4_BETA_ENABLED_INSIGHTS_PROPERTY } from "@/src/features/insights-analytics/useInsightsCapture";
import { IamSessionProvider } from "@/src/features/auth/components/IamSessionProvider";

// Check that Insights is client-side (used to handle Next.js SSR) and that env vars are set
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_INSIGHTS_KEY &&
  process.env.NEXT_PUBLIC_INSIGHTS_HOST
) {
  insights.init(process.env.NEXT_PUBLIC_INSIGHTS_KEY, {
    api_host:
      process.env.NEXT_PUBLIC_INSIGHTS_HOST || "https://insights.hanzo.ai",
    ui_host: "https://insights.hanzo.ai",
    // Enable debug mode in development
    loaded: (insights) => {
      if (process.env.NODE_ENV === "development") insights.debug();
    },
    session_recording: {
      maskCapturedNetworkRequestFn(request) {
        request.requestBody = request.requestBody ? "REDACTED" : undefined;
        request.responseBody = request.responseBody ? "REDACTED" : undefined;
        return request;
      },
    },
    autocapture: false,
    enable_heatmaps: false,
    persistence: "cookie",
  });
}

const MyApp: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  const router = useRouter();

  useEffect(() => {
    // Insights (cloud.hanzo.ai)
    if (env.NEXT_PUBLIC_INSIGHTS_KEY && env.NEXT_PUBLIC_INSIGHTS_HOST) {
      const handleRouteChange = () => {
        insights.capture("$pageview");
      };
      router.events.on("routeChangeComplete", handleRouteChange);

      return () => {
        router.events.off("routeChangeComplete", handleRouteChange);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QueryParamProvider adapter={NextAdapterPages}>
      <TooltipProvider>
        <CommandMenuProvider>
          <InsightsProvider client={insights}>
            <SessionProvider
              session={session}
              refetchOnWindowFocus={true}
              refetchInterval={5 * 60} // 5 minutes
              basePath={`${env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}
            >
              <IamSessionProvider>
                <DetailPageListsProvider>
                  <MarkdownContextProvider>
                    <ThemeProvider
                      attribute="class"
                      enableSystem
                      disableTransitionOnChange
                    >
                      <ScoreCacheProvider>
                        <CorrectionCacheProvider>
                          <SupportDrawerProvider defaultOpen={false}>
                            <InAppAiAgentProvider defaultOpen={false}>
                              <AppLayout>
                                <Component {...pageProps} />
                                <UserTracking />
                              </AppLayout>
                            </InAppAiAgentProvider>
                          </SupportDrawerProvider>
                        </CorrectionCacheProvider>
                      </ScoreCacheProvider>
                    </ThemeProvider>
                  </MarkdownContextProvider>
                </DetailPageListsProvider>
              </IamSessionProvider>
            </SessionProvider>
          </InsightsProvider>
        </CommandMenuProvider>
      </TooltipProvider>
    </QueryParamProvider>
  );
};

export default api.withTRPC(MyApp);

function UserTracking() {
  const session = useSession();
  const { region } = useConsoleCloudRegion();
  const sessionUser = session.data?.user;

  // Track user identity and properties
  const lastIdentifiedUser = useRef<string | null>(null);
  useEffect(() => {
    if (
      session.status === "authenticated" &&
      sessionUser &&
      lastIdentifiedUser.current !== JSON.stringify(sessionUser)
    ) {
      lastIdentifiedUser.current = JSON.stringify(sessionUser);
      // Insights
      if (env.NEXT_PUBLIC_INSIGHTS_KEY && env.NEXT_PUBLIC_INSIGHTS_HOST) {
        insights.identify(sessionUser.id ?? undefined, {
          environment: process.env.NODE_ENV,
          email: sessionUser.email ?? undefined,
          name: sessionUser.name ?? undefined,
          featureFlags: sessionUser.featureFlags ?? undefined,
          projects:
            sessionUser.organizations.flatMap((org) =>
              org.projects.map((project) => ({
                ...project,
                organization: org,
              })),
            ) ?? undefined,
          HANZO_CLOUD_REGION: region,
        });
        insights.register({
          [V4_BETA_ENABLED_INSIGHTS_PROPERTY]:
            sessionUser.v4BetaEnabled ?? false,
        });
      }

      // Sentry
      setUser({
        email: sessionUser.email ?? undefined,
        id: sessionUser.id ?? undefined,
      });
    } else if (session.status === "unauthenticated") {
      lastIdentifiedUser.current = null;
      insights.unregister(V4_BETA_ENABLED_INSIGHTS_PROPERTY);
      // Sentry
      setUser(null);
    }
  }, [sessionUser, session.status, region]);

  // add stripe link to chat
  // const orgStripeLink = organization?.cloudConfig?.stripe?.customerId
  //   ? `https://dashboard.stripe.com/customers/${organization.cloudConfig.stripe.customerId}`
  //   : undefined;
  // useEffect(() => {
  //   if (orgStripeLink) {
  //     chatSetUser({
  //       data: {
  //         stripe: orgStripeLink,
  //       },
  //     });
  //   }
  // }, [orgStripeLink]);

  return null;
}

if (
  process.env.NEXT_RUNTIME === "nodejs" &&
  process.env.NEXT_MANUAL_SIG_HANDLE
) {
  const { shutdown } = await import("@/src/utils/shutdown");
  prexit(async (signal) => {
    console.log("Signal: ", signal);
    return await shutdown(signal);
  });
}
