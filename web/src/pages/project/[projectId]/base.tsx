import { useRouter } from "next/router";
import { EmbeddedDashboard } from "@/src/components/embed/EmbeddedDashboard";

/**
 * Org-scoped embedded Hanzo Base dashboard.
 *
 * Renders the Base superuser admin UI inside console via the same-origin
 * /api/base SSO proxy. Authenticated by the existing IAM session — no link-out,
 * no separate login. Replaces the previous newTab link to base.hanzo.ai/_/.
 */
export default function BaseDashboardPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <EmbeddedDashboard
      title="Base"
      // Slash-less on purpose: Next.js (trailingSlash:false) would 308-strip a
      // trailing slash, and Base 307-redirects `/_` → `/_/`, so a `/api/base/_/`
      // src would redirect-loop. The proxy re-adds the slash on the upstream
      // request (forceTrailingSlashFor: ["_"]) so Base answers 200.
      proxyPath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/base/_`}
    />
  );
}
