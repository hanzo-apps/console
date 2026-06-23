import { ExternalLink } from "lucide-react";
import { Button } from "@/src/components/ui/button";

/**
 * EmbeddedDashboard
 *
 * The ONE way to embed an external Hanzo app/service dashboard inside console,
 * org-scoped and authenticated by the existing IAM session (SSO, no link-out,
 * no separate login).
 *
 * The iframe is pointed at a SAME-ORIGIN proxy path (e.g. `/api/base`,
 * `/api/playground-app`) served by a Next.js Pages-Router catch-all that
 * forwards to the upstream service and injects the session-derived tenant
 * headers (x-org-id / x-project-id / x-actor-id / x-env) — see
 * `@/src/server/tenant-headers`. Loading through console's own origin means the
 * console session cookie applies, so the embedded app trusts the request
 * without prompting for credentials.
 *
 * This generalizes the per-service embed pattern (KMS proxy + observe iframe)
 * into a single composable component. Mirror it for any new app dashboard.
 */
export function EmbeddedDashboard({
  /** Same-origin proxy path the iframe loads (e.g. `/api/base`). */
  proxyPath,
  /** Human title shown in the embed toolbar and used as the iframe title. */
  title,
  /**
   * Public URL for the "Open in new tab" affordance. Optional — when omitted,
   * no external link is shown (pure embed). This is a convenience escape hatch,
   * not the primary access path.
   */
  externalUrl,
}: {
  proxyPath: string;
  title: string;
  externalUrl?: string;
}) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-medium">{title}</h1>
        {externalUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(externalUrl, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open in new tab
          </Button>
        )}
      </div>
      <iframe
        src={proxyPath}
        className="flex-1 border-0"
        title={title}
        allow="clipboard-read; clipboard-write"
        // Same-origin so the console session cookie + injected tenant headers
        // authenticate the embedded app (SSO). Scripts/forms/popups/modals are
        // required for a full admin UI.
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"
      />
    </div>
  );
}
