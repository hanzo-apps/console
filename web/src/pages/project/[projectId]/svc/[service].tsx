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
