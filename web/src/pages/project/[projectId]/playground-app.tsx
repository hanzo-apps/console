import { useRouter } from "next/router";
import { EmbeddedDashboard } from "@/src/components/embed/EmbeddedDashboard";

/**
 * Org-scoped embedded Hanzo Playground dashboard.
 *
 * Renders the hanzo-playground app inside console via the same-origin
 * /api/playground-app SSO proxy. Authenticated by the existing IAM session —
 * no link-out, no separate login.
 *
 * Distinct from the built-in prompt "Playground" (/project/[projectId]/playground);
 * this embeds the standalone hanzo-playground service.
 */
export default function PlaygroundAppPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <EmbeddedDashboard
      title="Playground"
      // Slash-less to avoid Next.js (trailingSlash:false) 308-stripping the
      // trailing slash; the playground SPA serves its root at the bare path.
      proxyPath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/playground-app`}
    />
  );
}
