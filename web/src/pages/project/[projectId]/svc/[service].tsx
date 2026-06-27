import { type GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { EmbeddedDashboard } from "@/src/components/embed/EmbeddedDashboard";
import {
  getEmbeddedService,
  serviceMountPath,
} from "@/src/features/embedded-services/registry";

/**
 * Org-scoped embedded service dashboard — the ONE page that renders ANY service
 * from the registry inside console via the same-origin SSO proxy
 * (`/api/svc/<slug>`), authenticated by the existing IAM session. Replaces the
 * per-service page files (base.tsx, playground-app.tsx) with a single
 * registry-driven page so a new service needs no new page.
 *
 * The iframe loads `/api/svc/<slug><rootPath>` scoped to the URL's project (and
 * thus org) — see the proxy route + `tenant-headers` for how the session-derived
 * x-org-id / x-project-id are injected from the verified session.
 */
export default function EmbeddedServicePage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const service = router.query.service as string;

  const def = getEmbeddedService(service);
  if (!projectId || !def) return null;

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  // Carry the projectId so the proxy resolves the org from the iframe's own
  // project (the API route URL has no [projectId]); validated against the
  // session server-side. `rootPath` is the bare suffix the SPA serves at.
  const proxyPath =
    `${basePath}${serviceMountPath(def.slug)}${def.rootPath ?? ""}` +
    `?projectId=${encodeURIComponent(projectId)}`;

  return <EmbeddedDashboard title={def.title} proxyPath={proxyPath} />;
}

/**
 * A service that declares an `externalUrl` runs its own cross-origin OIDC on its
 * own origin and cannot be embedded behind console's origin (the OIDC redirect +
 * host-scoped session cookie break, so the user lands on the app's sign-in page
 * instead of signed in). Redirect straight to it — for an OIDC app this is the
 * login-initiation deep-link, so an already hanzo.id-authenticated user lands in
 * the app already signed in. Embeddable services fall through and render the
 * same-origin proxy iframe above. This page is the single choke point, so every
 * link to `/svc/<slug>` (nav, command menu, cards) is handled in one place.
 */
export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const slug = typeof params?.service === "string" ? params.service : undefined;
  const def = getEmbeddedService(slug);
  if (def?.externalUrl) {
    return { redirect: { destination: def.externalUrl, permanent: false } };
  }
  return { props: {} };
};
