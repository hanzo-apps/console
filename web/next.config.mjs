/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { withSentryConfig } from "@sentry/nextjs";
import { env } from "./src/env.mjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import { scheduleCronJob } from "./src/server/serverCron.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The shared product-core workspace package is `@hanzo/console` (it lives in
// `packages/shared`). The webpack production build (`next build --webpack`) needs
// explicit subpath aliases that point every `@hanzo/console` subpath at the
// package's TS SOURCE — identical to the turbopack alias below — so
// `transpilePackages` recompiles it ESM-aware (the prebuilt CJS dist re-require()s
// ESM-only deps like uuid, which webpack rejects).
const sharedSrc = path.resolve(__dirname, "../packages/shared/src");
const aliasForPrefix = (prefix) => ({
  [`${prefix}/src/server/auth/apiKeys`]: path.join(sharedSrc, "server/auth/apiKeys.ts"),
  // `server/llm/types.ts` is a leaf module (zod + prisma types only) that owns
  // client-safe values like `ZodModelConfig` and `ConsoleInternalTraceEnvironment`.
  // Exposing it as its own focused subpath lets module-scope consumers import
  // these without pulling the full `@hanzo/console` barrel, which otherwise
  // forms a webpack circular-chunk graph where the schema binding is still in
  // its temporal dead zone at module-evaluation time (TDZ ReferenceError during
  // Next page-data collection). Listed before `/src/server` so it wins.
  [`${prefix}/src/server/llm/types`]: path.join(sharedSrc, "server/llm/types.ts"),
  [`${prefix}/src/server`]: path.join(sharedSrc, "server/index.ts"),
  [`${prefix}/src/db`]: path.join(sharedSrc, "db.ts"),
  [`${prefix}/src/env`]: path.join(sharedSrc, "env.ts"),
  [`${prefix}/src/utils/chatml`]: path.join(sharedSrc, "utils/chatml/index.ts"),
  [`${prefix}/src/index`]: path.join(sharedSrc, "index.ts"),
  // The query subsystem lives at `packages/shared/src/features/query`. It is
  // published under the `@hanzo/console/query` and `@hanzo/console/query/server`
  // subpaths (mirrors the package `exports` field). The `/server` exact-match
  // alias is listed first so it wins over the broader `/query` exact-match.
  [`${prefix}/query/server`]: path.join(sharedSrc, "features/query/server/index.ts"),
  [`${prefix}/query`]: path.join(sharedSrc, "features/query/index.ts"),
  [`${prefix}/encryption`]: path.join(sharedSrc, "encryption/index.ts"),
  [`${prefix}$`]: path.join(sharedSrc, "index.ts"),
});
const sharedAlias = {
  ...aliasForPrefix("@hanzo/console"),
  // @hanzo/mq is a serverExternalPackage (resolved at runtime from its built dist,
  // not bundled/aliased) so the Temporal driver's lazy eval-require stays opaque.
  // The query subsystem (dataModel, queryBuilder, queryExecutor, types, validateQuery)
  // moved out of web into the shared package, but a number of web modules still import
  // it under its old web-local `@/src/features/query` path. Redirect to the shared
  // source so both names resolve to one implementation.
  "@/src/features/query": path.join(sharedSrc, "features/query"),
};

// Canonical URL surface (single source of truth). Every console HTTP path is
// published at /v1/*; the Pages Router keeps handler files under pages/api/, so
// /v1/* is rewritten onto them and every legacy /api/* is 307-forwarded back to
// /v1/*. Both directions are derived from this one list (DRY) — segment name is
// preserved (/v1/<seg>/* ↔ /api/<seg>/*). The public SDK API is handled
// separately by collapsing /api/public/* ↔ /v1/* (the redundant `public` drops).
const V1_PASS_THROUGH = [
  "auth", // NextAuth (basePath is /v1/auth)
  "trpc", // tRPC web RPC
  "admin",
  "agents",
  "billing",
  "compute",
  "dashboard",
  "feedback",
  "kms",
  "observe",
  "start-cron",
  "support",
  "zap",
  "chatCompletion",
  "in-app-agent",
];

// Resources whose current version is Langfuse-internal "v2". There is NO /v1/v2
// in the published surface — these are served at /v1/<resource> and routed onto
// the v2 handler file. (House rule: one version segment, /v1, never a nested v2.)
const V1_FROM_V2 = ["prompts", "scores"];

/**
 * CSP headers
 * img-src https to allow loading images from SSO providers
 */
const cspHeader = `
  default-src 'self' https://*.hanzo.com https://*.hanzo.ai https://*.hanzo.dev https://*.insights.com https://*.sentry.io;
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.hanzo.com https://*.hanzo.ai https://*.hanzo.dev https://challenges.cloudflare.com https://*.sentry.io  https://static.cloudflareinsights.com https://login.microsoftonline.com https://login.microsoft.com https://*.microsoftonline.com https://app.cal.com https://cal.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://login.microsoftonline.com https://login.microsoft.com https://*.microsoftonline.com;
  img-src 'self' https: blob: data: http://localhost:* https://prod-uk-services-workspac-workspacefilespublicbuck-vs4gjqpqjkh6.s3.amazonaws.com https://prod-uk-services-attachm-attachmentsbucket28b3ccf-uwfssb4vt2us.s3.eu-west-2.amazonaws.com https://i0.wp.com;
  font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com;
  frame-src 'self' https://*.hanzo.ai https://challenges.cloudflare.com https://login.microsoftonline.com https://login.microsoft.com https://*.microsoftonline.com https://app.cal.com https://cal.com;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self' https://login.microsoftonline.com https://login.microsoft.com https://*.microsoftonline.com;
  frame-ancestors 'none';
  connect-src 'self' https://*.hanzo.com https://*.hanzo.ai https://*.hanzo.dev https://*.ingest.us.sentry.io https://*.sentry.io https://chat.uk.plain.com https://*.s3.amazonaws.com https://prod-uk-services-attachm-attachmentsuploadbucket2-1l2e4906o2asm.s3.eu-west-2.amazonaws.com https://login.microsoftonline.com https://login.microsoft.com https://*.microsoftonline.com https://graph.microsoft.com https://app.cal.com https://cal.com;
  media-src 'self' https: http://localhost:*;
  ${env.HANZO_CSP_ENFORCE_HTTPS === "true" ? "upgrade-insecure-requests; block-all-mixed-content;" : ""}
  ${env.SENTRY_CSP_REPORT_URI ? `report-uri ${env.SENTRY_CSP_REPORT_URI}; report-to csp-endpoint;` : ""}
`;

// Match rules for Hugging Face
const huggingFaceHosts = ["huggingface.co", ".*\\.hf\\.space$"];
const initCronJob = async () => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("🚀 Initializing Cron Job from next.config.js...");
    scheduleCronJob();
  }
};
const reportToHeader = {
  key: "Report-To",
  value: JSON.stringify({
    group: "csp-endpoint",
    max_age: 10886400,
    endpoints: [
      {
        url: env.SENTRY_CSP_REPORT_URI,
      },
    ],
    include_subdomains: true,
  }),
};

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Allow building to alternate directory for parallel build checks while dev server runs
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    // CI test jobs run `pnpm run typecheck` separately and skip duplicate
    // Next.js type checks to keep test builds fast. Production/Docker builds
    // do not set this flag and still fail on TypeScript errors.
    ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === "true",
  },
  // Agent/browser tooling often targets 127.0.0.1 instead of localhost in dev.
  allowedDevOrigins: ["127.0.0.1"],
  staticPageGenerationTimeout: 500, // default is 60. Required for build process for amd
  transpilePackages: ["@hanzo/console", "@hanzo/iam", "@hanzo/ui", "vis-network/standalone"],
  reactStrictMode: true,
  serverExternalPackages: [
    "dd-trace",
    "@opentelemetry/api",
    "@appsignal/opentelemetry-instrumentation-bullmq",
    "@hanzo/mq",
    "@hanzo/insights-node",
    "@opentelemetry/sdk-node",
    "@opentelemetry/instrumentation-winston",
  ],
  poweredByHeader: false,
  basePath: env.NEXT_PUBLIC_BASE_PATH,
  compiler: {
    define: {
      "import.meta.vitest": "undefined",
    },
  },
  turbopack: {
    resolveAlias: {
      "@hanzo/console": "./packages/shared/src",
      // this is an ugly hack to get turbopack to work with react-resizable, used in the
      // web/src/features/widgets/components/DashboardGrid.tsx file. This **only** affects
      // the dev server. The CSS is included in the non-turbopack based prod build anyways.
      // Also not needed for the non-turbopack based dev server.
      "react-resizable/css/styles.css":
        "../node_modules/.pnpm/react-resizable@3.0.5_react-dom@19.2.3_react@19.2.3__react@19.2.3/node_modules/react-resizable/css/styles.css",
    },
  },
  logging: {
    browserToTerminal: true,
  },
  experimental: {
    turbopackFileSystemCacheForBuild: true,
  },

  /**
   * If you have `experimental: { appDir: true }` set, then you must comment the below `i18n` config
   * out.
   *
   * @see https://github.com/vercel/next.js/issues/41980
   */
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  output: "standalone",

  // Canonical URL surface — exactly one way: /v1/*. The Pages Router forces
  // handler files under pages/api/, so /v1/* is rewritten onto them. rewrites()
  // and redirects() are BOTH derived from V1_PASS_THROUGH (above) so the two
  // directions can never drift. A specific rule (internal trace export) is
  // listed before the public-API catch-all so it wins by order.
  async rewrites() {
    // Frontend-only mode: proxy BOTH surfaces to a live console, no local API.
    if (process.env.SKIP_ENV_VALIDATION === "1") {
      const target = process.env.CONSOLE_API_URL || "https://console.hanzo.ai";
      return [
        { source: "/v1/:path*", destination: `${target}/v1/:path*` },
        { source: "/api/:path*", destination: `${target}/api/:path*` },
      ];
    }
    const passThrough = V1_PASS_THROUGH.flatMap((seg) => [
      { source: `/v1/${seg}/:path*`, destination: `/api/${seg}/:path*` },
      { source: `/v1/${seg}`, destination: `/api/${seg}` },
    ]);
    const v2Rewrites = V1_FROM_V2.flatMap((seg) => [
      { source: `/v1/${seg}/:path*`, destination: `/api/public/v2/${seg}/:path*` },
      { source: `/v1/${seg}`, destination: `/api/public/v2/${seg}` },
    ]);
    return [
      // internal trace export must win over the public-API catch-all below
      {
        source: "/v1/traces/:traceId/download",
        destination: "/api/traces/:traceId/download",
      },
      ...passThrough,
      // v2-current resources at /v1/<resource> (no /v1/v2) — precede catch-all
      ...v2Rewrites,
      // public SDK API — the redundant /api/public segment is dropped
      { source: "/v1/:path*", destination: "/api/public/:path*" },
    ];
  },

  // Inverse of rewrites(): every legacy /api/* 307s to canonical /v1/*. 307
  // (not 308) keeps a rollback from sticking in browser caches.
  async redirects() {
    if (process.env.SKIP_ENV_VALIDATION === "1") return [];
    const passThrough = V1_PASS_THROUGH.flatMap((seg) => [
      {
        source: `/api/${seg}/:path*`,
        destination: `/v1/${seg}/:path*`,
        permanent: false,
      },
      { source: `/api/${seg}`, destination: `/v1/${seg}`, permanent: false },
    ]);
    const v2Redirects = V1_FROM_V2.flatMap((seg) => [
      {
        source: `/api/public/v2/${seg}/:path*`,
        destination: `/v1/${seg}/:path*`,
        permanent: false,
      },
      {
        source: `/api/public/v2/${seg}`,
        destination: `/v1/${seg}`,
        permanent: false,
      },
    ]);
    return [
      {
        source: "/api/traces/:traceId/download",
        destination: "/v1/traces/:traceId/download",
        permanent: false,
      },
      ...passThrough,
      // /api/public/v2/<resource> → /v1/<resource> (precede the general rule)
      ...v2Redirects,
      {
        source: "/api/public/:path*",
        destination: "/v1/:path*",
        permanent: false,
      },
    ];
  },

  async headers() {
    return [
      {
        // Add noindex for all pages except root and /auth*
        source: "/:path((?!auth|^$).*)*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Document-Policy",
            value: "js-profiling",
          },
          {
            key: "Permissions-Policy",
            value: "autoplay=*, fullscreen=*, microphone=*",
          },
          ...(env.SENTRY_CSP_REPORT_URI ? [reportToHeader] : []),
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "x-frame-options",
            value: "SAMEORIGIN",
          },
        ],
        // Disable x-frame-options on Hugging Face to allow for embedded use of HanzoCloud
        missing: huggingFaceHosts.map((host) => ({
          type: "host",
          value: host,
        })),
      },
      // CSP header (skip the API surface — both /api/* and the canonical /v1/*)
      {
        source: "/:path((?!api|v1).*)*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\n/g, ""),
          },
        ],
        // Disable CSP on Hugging Face to allow for embedded use of HanzoCloud
        missing: huggingFaceHosts.map((host) => ({
          type: "host",
          value: host,
        })),
      },
      // Required to check authentication status from hanzo.ai
      ...(env.NEXT_PUBLIC_HANZO_CLOUD_REGION !== undefined
        ? [
            {
              source: "/v1/auth/session",
              headers: [
                {
                  key: "Access-Control-Allow-Origin",
                  value: "https://hanzo.com",
                },
                { key: "Access-Control-Allow-Credentials", value: "true" },
                { key: "Access-Control-Allow-Methods", value: "GET,POST" },
                {
                  key: "Access-Control-Allow-Headers",
                  value: "Content-Type, Authorization",
                },
              ],
            },
          ]
        : []),
      // all files in /public/generated are public and can be accessed from any origin, e.g. to render an API reference based on our openapi schema
      {
        source: "/generated/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET",
          },
        ],
      },
    ];
  },

  webpack(config, { isServer, webpack }) {
    // Resolve every `@hanzo/console` subpath to the shared package TS source for
    // the webpack production build (mirrors the turbopack resolveAlias above).
    config.resolve = config.resolve || {};
    config.resolve.alias = { ...(config.resolve.alias || {}), ...sharedAlias };

    // Exclude Datadog packages from webpack bundling to avoid issues
    // see: https://docs.datadoghq.com/tracing/trace_collection/automatic_instrumentation/dd_libraries/nodejs/#bundling-with-nextjs
    config.externals.push("@datadog/pprof", "dd-trace");

    // Setup in-source testing: https://vitest.dev/guide/in-source.html#other-bundlers
    config.plugins.push(
      new webpack.DefinePlugin({
        "import.meta.vitest": "undefined",
      }),
    );

    return config;
  },
};

// Skip Sentry webpack overhead during Docker builds and frontend-only mode
const sentryConfig =
  process.env.DOCKER_BUILD === "1" || process.env.SKIP_ENV_VALIDATION === "1"
    ? nextConfig
    : withSentryConfig(nextConfig, {
        // For all available options, see:
        // https://github.com/getsentry/sentry-webpack-plugin#options

        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,

        authToken: env.SENTRY_AUTH_TOKEN,

        // Only print logs for uploading source maps in CI
        silent: !process.env.CI,

        // For all available options, see:
        // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

        // Upload a larger set of source maps for prettier stack traces (increases build time)
        widenClientFileUpload: true,

        // Automatically annotate React components to show their full name in breadcrumbs and session replay
        reactComponentAnnotation: {
          enabled: true,
        },

        // Hides source maps from generated client bundles
        sourcemaps: {
          disable: true,
        },

        // Automatically tree-shake Sentry logger statements to reduce bundle size
        disableLogger: true,

        // Enables automatic instrumentation of Vercel Cron Monitors.
        automaticVercelMonitors: false,
      });

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzer(sentryConfig);
