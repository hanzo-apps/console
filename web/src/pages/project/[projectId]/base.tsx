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
      proxyPath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/base`}
    />
  );
}
