// Hanzo Cloud only — admin action to grant cloud credits to an org via Commerce.
import { useState } from "react";
import { useRouter } from "next/router";
import { api } from "@/src/utils/api";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Card } from "@/src/components/ui/card";
import { Label } from "@/src/components/ui/label";
import { useHasOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { Coins } from "lucide-react";

const centsToUsd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

export const CreditsManagement = () => {
  const router = useRouter();
  const orgId = router.query.organizationId as string | undefined;
  const utils = api.useUtils();

  const hasAccess = useHasOrganizationAccess({
    organizationId: orgId,
    scope: "hanzoCloudBilling:CRUD",
  });

  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const balance = api.cloudBilling.getOrgCreditBalance.useQuery(
    { orgId: orgId as string },
    { enabled: Boolean(orgId) && hasAccess },
  );

  const grant = api.cloudBilling.grantCredits.useMutation({
    onSuccess: () => {
      setAmount("");
      setNote("");
      void utils.cloudBilling.getOrgCreditBalance.invalidate();
    },
  });

  if (!orgId || !hasAccess) return null;

  // Commerce returns one entry per currency; we surface USD (the only currency
  // console grants). Sum defensively in case of mixed-currency ledgers.
  const usdAvailableCents =
    balance.data?.balances
      .filter((b) => b.currency.toLowerCase() === "usd")
      .reduce((sum, b) => sum + b.available, 0) ?? 0;

  const parsedAmount = Number(amount);
  const amountValid =
    amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Coins className="text-muted-foreground h-4 w-4" />
          <h3 className="text-sm font-medium">Cloud credit balance</h3>
        </div>
        <p className="mt-3 text-3xl font-semibold tabular-nums">
          {balance.isLoading
            ? "…"
            : balance.isError
              ? "Unavailable"
              : centsToUsd(usdAvailableCents)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Available credits for this organization, served by Hanzo Commerce.
        </p>
        {balance.isError ? (
          <p className="text-destructive mt-2 text-xs">
            {balance.error.message}
          </p>
        ) : null}
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-medium">Grant cloud credits</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Add promotional cloud credits to this organization. Credits are spent
          before any paid usage.
        </p>
        <form
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountValid) return;
            grant.mutate({
              orgId,
              amountUsd: parsedAmount,
              name: note.trim() || undefined,
            });
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="credit-amount">Amount (USD)</Label>
            <Input
              id="credit-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="10.00"
              className="w-40"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="credit-note">Note (optional)</Label>
            <Input
              id="credit-note"
              type="text"
              placeholder="e.g. onboarding credit"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            loading={grant.isLoading}
            disabled={!amountValid || grant.isLoading}
          >
            Grant credits
          </Button>
        </form>
        {grant.isError ? (
          <p className="text-destructive mt-2 text-xs">{grant.error.message}</p>
        ) : null}
        {grant.isSuccess ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Granted {centsToUsd(grant.data.amountCents)} to this organization.
          </p>
        ) : null}
      </Card>
    </div>
  );
};
