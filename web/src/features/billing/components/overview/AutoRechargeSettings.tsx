import { useEffect, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import { api } from "@/src/utils/api";
import { useQueryOrganization } from "@/src/features/organizations/hooks";

/**
 * Auto-recharge (prepaid credits auto-reload), like the Claude/OpenAI API
 * "automatic top-up" setting. When the org balance falls below the threshold,
 * commerce charges the default saved card by the recharge amount (off-session,
 * via a scheduled sweep). Requires a default card on file.
 */
export const AutoRechargeSettings = () => {
  const organization = useQueryOrganization();
  const orgId = organization?.id ?? "";

  const configQuery = api.cloudBilling.getAutoRecharge.useQuery(
    { orgId },
    { enabled: !!organization },
  );
  const paymentMethodsQuery = api.cloudBilling.listPaymentMethods.useQuery(
    { orgId },
    { enabled: !!organization },
  );
  const hasDefaultCard = (paymentMethodsQuery.data ?? []).some(
    (pm) => pm.isDefault,
  );

  const [enabled, setEnabled] = useState(false);
  const [thresholdUsd, setThresholdUsd] = useState("10");
  const [amountUsd, setAmountUsd] = useState("25");

  // Hydrate the form from the saved config once it loads.
  useEffect(() => {
    const cfg = configQuery.data;
    if (!cfg) return;
    setEnabled(cfg.enabled);
    if (cfg.thresholdCents)
      setThresholdUsd((cfg.thresholdCents / 100).toString());
    if (cfg.amountCents) setAmountUsd((cfg.amountCents / 100).toString());
  }, [configQuery.data]);

  const save = api.cloudBilling.setAutoRecharge.useMutation({
    onSuccess: () => {
      void configQuery.refetch();
    },
  });

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Auto-recharge</h3>
          <p className="text-muted-foreground text-sm">
            Automatically top up your balance when it runs low, charged to your
            default card.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!hasDefaultCard && !enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {!hasDefaultCard && (
        <p className="mt-2 text-sm text-yellow-600">
          Add a card and mark it default to enable auto-recharge.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ar-threshold">When balance falls below (USD)</Label>
          <Input
            id="ar-threshold"
            type="number"
            min="0"
            step="1"
            value={thresholdUsd}
            onChange={(e) => setThresholdUsd(e.target.value)}
            disabled={!enabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ar-amount">Recharge amount (USD)</Label>
          <Input
            id="ar-amount"
            type="number"
            min="1"
            step="1"
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            disabled={!enabled}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        {configQuery.data?.lastRechargedAt ? (
          <p className="text-muted-foreground text-xs">
            Last recharged{" "}
            {new Date(configQuery.data.lastRechargedAt).toLocaleString()}
          </p>
        ) : (
          <span />
        )}
        <Button
          disabled={save.isLoading || (enabled && !hasDefaultCard)}
          onClick={() =>
            save.mutate({
              orgId,
              enabled,
              thresholdUsd: Number(thresholdUsd) || 0,
              amountUsd: Number(amountUsd) || 0,
            })
          }
        >
          {save.isLoading ? "Saving…" : "Save"}
        </Button>
      </div>

      {save.error && (
        <p className="text-destructive mt-2 text-sm">{save.error.message}</p>
      )}
    </Card>
  );
};
