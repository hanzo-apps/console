import { Card } from "@/src/components/ui/card";
import { Progress } from "@/src/components/ui/progress";
import { useQueryOrganization } from "@/src/features/organizations/hooks";
import { api } from "@/src/utils/api";
import { planLabels, type Plan } from "@hanzo/console";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * PlanUsageRollup renders the commerce-backed plan + included-usage rollup:
 * current plan, included monthly allotment vs consumed (with a progress bar),
 * overage, and the prepaid balance the gateway gate reads. Read-only —
 * commerce is the single billing source of truth.
 */
export const PlanUsageRollup = () => {
  const organization = useQueryOrganization();

  const { data, isLoading, error } =
    api.cloudBilling.getCommerceUsageRollup.useQuery(
      { orgId: organization?.id ?? "" },
      { enabled: organization !== undefined, retry: false },
    );

  // Surface nothing if commerce is not configured/reachable — the Stripe-based
  // cards above still render. (Commerce auth missing -> PRECONDITION_FAILED.)
  if (error) return null;

  const planSlug = data?.plan ?? "";
  const planLabel =
    (planLabels as Record<string, string>)[planSlug as Plan] ||
    (planSlug ? planSlug.charAt(0).toUpperCase() + planSlug.slice(1) : "Free");

  const includedMonthly = data?.included.monthlyCents ?? 0;
  const includedGranted = data?.included.grantedCents ?? 0;
  const includedConsumed = data?.included.consumedCents ?? 0;
  const includedRemaining = data?.included.remainingCents ?? 0;
  const consumed = data?.consumedCents ?? 0;
  const overage = data?.overageCents ?? 0;
  const available = data?.balance.availableCents ?? 0;

  // Progress against the granted allotment (fall back to the catalog amount
  // before the period's grant has run).
  const denom = includedGranted > 0 ? includedGranted : includedMonthly;
  const pct =
    denom > 0 ? Math.min(100, Math.round((includedConsumed / denom) * 100)) : 0;

  return (
    <Card className="col-span-1 p-6 md:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-muted-foreground text-sm font-medium">
            Plan &amp; Usage
          </h3>
          <p className="mt-1 text-2xl font-bold">
            {isLoading ? "…" : planLabel}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {includedMonthly > 0
              ? `${usd(includedMonthly)} included usage / month`
              : "No included monthly usage"}
            {data?.period ? ` · ${data.period}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground text-sm">Balance available</p>
          <p className="mt-1 text-2xl font-bold">{usd(available)}</p>
        </div>
      </div>

      {includedMonthly > 0 && (
        <div className="mt-6">
          <div className="mb-1 flex justify-between text-sm">
            <span>Included usage consumed</span>
            <span className="font-medium">
              {usd(includedConsumed)} / {usd(denom)}
            </span>
          </div>
          <Progress value={pct} />
          <div className="text-muted-foreground mt-1 flex justify-between text-xs">
            <span>{usd(includedRemaining)} remaining</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground text-sm">Consumed this period</p>
          <p className="mt-1 text-lg font-semibold">{usd(consumed)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Overage</p>
          <p className="mt-1 text-lg font-semibold">{usd(overage)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Included granted</p>
          <p className="mt-1 text-lg font-semibold">{usd(includedGranted)}</p>
        </div>
      </div>

      {overage > 0 && (
        <p className="text-muted-foreground mt-4 text-sm">
          You have exceeded your included usage. Overage of {usd(overage)} is
          drawn from your prepaid balance and billed via your payment method.
        </p>
      )}
    </Card>
  );
};
