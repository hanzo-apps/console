import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Check } from "lucide-react";
import { api } from "@/src/utils/api";
import { toast } from "sonner";

function formatPrice(cents: number | undefined): string {
  if (!cents || cents <= 0) return "Free";
  const dollars = cents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

export function BillingPlansDialog({
  open,
  onOpenChange,
  orgId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSuccess?: () => void;
}) {
  const plansQuery = api.cloudBilling.listPlans.useQuery(
    { orgId },
    { enabled: open && !!orgId },
  );
  const subQuery = api.cloudBilling.getActiveSubscription.useQuery(
    { orgId },
    { enabled: open && !!orgId },
  );

  const subscribe = api.cloudBilling.subscribeToPlan.useMutation({
    onSuccess: () => {
      toast.success("Plan updated");
      void plansQuery.refetch();
      void subQuery.refetch();
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message || "Failed to update plan"),
  });

  const plans = plansQuery.data ?? [];
  const activeSub = subQuery.data;

  const currentSlug = useMemo(() => {
    if (activeSub?.planId) return activeSub.planId;
    // No active subscription → the free plan is effectively current.
    return plans.find((p) => !p.price || p.price <= 0)?.slug ?? null;
  }, [activeSub, plans]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Choose a plan</DialogTitle>
          <DialogDescription>
            Plans and pricing from Hanzo billing. Changes take effect
            immediately.
          </DialogDescription>
        </DialogHeader>

        {plansQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading plans…</p>
        ) : plans.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No plans available right now.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = plan.slug === currentSlug;
              return (
                <Card key={plan.slug} className="flex flex-col p-5">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <div className="mt-1">
                    <span className="text-2xl font-bold">
                      {formatPrice(plan.price)}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-muted-foreground text-sm">
                        {" "}
                        /mo
                      </span>
                    )}
                  </div>
                  {plan.description && (
                    <p className="text-muted-foreground mt-2 text-sm">
                      {plan.description}
                    </p>
                  )}
                  {plan.features && plan.features.length > 0 && (
                    <ul className="mt-4 flex-1 space-y-2">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    className="mt-4 w-full"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || subscribe.isLoading}
                    onClick={() =>
                      subscribe.mutate({ orgId, planSlug: plan.slug })
                    }
                  >
                    {isCurrent
                      ? "Current plan"
                      : !plan.price || plan.price <= 0
                        ? "Switch to Free"
                        : `Choose ${plan.name}`}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
