/**
 * Cloud API Keys (hk-) — self-serve UI for a tenant's Hanzo Cloud API key.
 *
 * This is the keystone of the pay-as-you-go loop: a tenant mints a working
 * `hk-…` key here and uses it as a Bearer token against api.hanzo.ai (chat /
 * completions / RAG), metered + billed against THIS org. Distinct from the
 * observability keys (pk-hz/sk-hz) shown below it.
 *
 * The full key is shown ONCE at mint time (the secret is never re-read from the
 * server); afterwards only the masked prefix is shown, with Regenerate / Revoke.
 */
import { useState } from "react";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import Header from "@/src/components/layouts/header";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { CodeView } from "@/src/components/ui/CodeJsonViewer";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { useHasOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { api } from "@/src/utils/api";

export function CloudApiKeys({ orgId }: { orgId: string }) {
  const utils = api.useUtils();
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const hasAccess = useHasOrganizationAccess({
    organizationId: orgId,
    scope: "organization:CRUD_apiKeys",
  });

  const keyQuery = api.cloudApiKey.get.useQuery(
    { orgId },
    { enabled: Boolean(orgId) },
  );

  const mint = api.cloudApiKey.mint.useMutation({
    onSuccess: async (data) => {
      setFreshKey(data.accessKey);
      await utils.cloudApiKey.get.invalidate({ orgId });
    },
  });

  const revoke = api.cloudApiKey.revoke.useMutation({
    onSuccess: async () => {
      setFreshKey(null);
      await utils.cloudApiKey.get.invalidate({ orgId });
    },
  });

  const hasKey = keyQuery.data?.hasKey ?? false;
  const busy = mint.isPending || revoke.isPending;

  const sampleCurl = (key: string) =>
    [
      "curl https://api.hanzo.ai/v1/chat/completions \\",
      `  -H "Authorization: Bearer ${key}" \\`,
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`,
    ].join("\n");

  return (
    <div>
      <Header title="Cloud API Key" />
      <p className="text-muted-foreground mb-4 text-sm">
        Your Hanzo Cloud API key (<code>hk-…</code>) authenticates requests to{" "}
        <code>api.hanzo.ai</code> — chat, completions, embeddings and RAG across
        85+ models. Usage is metered and billed to this organization. This is
        separate from the observability keys below.
      </p>

      {!hasAccess ? (
        <Alert>
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            You need the organization Owner or Admin role to manage the Cloud
            API key.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          {/* One-time reveal of a freshly minted key */}
          {freshKey ? (
            <div className="flex flex-col gap-2">
              <Alert>
                <KeyRound className="h-4 w-4" />
                <AlertTitle>Copy your key now</AlertTitle>
                <AlertDescription>
                  This is the only time the full key is shown. Store it securely
                  — you can regenerate it any time, which invalidates the old
                  one.
                </AlertDescription>
              </Alert>
              <CodeView content={freshKey} title="Cloud API Key" />
              <div>
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  Try it
                </span>
                <CodeView
                  content={sampleCurl(freshKey)}
                  title="Example request"
                />
              </div>
            </div>
          ) : hasKey ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <KeyRound className="text-muted-foreground h-4 w-4" />
                <span className="font-mono text-sm">
                  {keyQuery.data?.maskedKey}
                </span>
                <span className="text-muted-foreground text-xs">
                  (active — full key shown only at creation)
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No Cloud API key yet. Generate one to start making requests.
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant={hasKey ? "secondary" : "default"}
              loading={mint.isPending}
              disabled={busy}
              onClick={() => mint.mutate({ orgId })}
            >
              {hasKey ? (
                <>
                  <RefreshCw className="mr-1 h-4 w-4" /> Regenerate
                </>
              ) : (
                <>
                  <KeyRound className="mr-1 h-4 w-4" /> Generate Cloud API Key
                </>
              )}
            </Button>
            {hasKey ? (
              <Button
                variant="destructive"
                loading={revoke.isPending}
                disabled={busy}
                onClick={() => revoke.mutate({ orgId })}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Revoke
              </Button>
            ) : null}
          </div>

          {mint.error ? (
            <p className="text-destructive text-sm">{mint.error.message}</p>
          ) : null}
          {revoke.error ? (
            <p className="text-destructive text-sm">{revoke.error.message}</p>
          ) : null}
        </Card>
      )}
    </div>
  );
}
