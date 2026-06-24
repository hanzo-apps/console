import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { CreditCard, Plus, Trash2 } from "lucide-react";
import { api } from "@/src/utils/api";
import { useQueryOrganization } from "@/src/features/organizations/hooks";
import { useRouter } from "next/router";
import { planLabels, type Plan } from "@hanzo/console";
import { SquarePaymentDialog } from "@/src/features/billing/components/SquarePaymentDialog";

export const PaymentManagement = () => {
  const router = useRouter();
  const organization = useQueryOrganization();
  const orgId = organization?.id ?? "";

  const [payDialog, setPayDialog] = useState<null | "add-card" | "buy-credits">(
    null,
  );

  // Subscription summary (commerce-backed).
  const subscriptionQuery = api.cloudBilling.getSubscriptionInfo.useQuery(
    { orgId },
    { enabled: organization !== undefined },
  );
  const subscription = subscriptionQuery.data;

  // Org details for the available credit figure.
  const orgDetailsQuery = api.organizations.getDetails.useQuery(
    { orgId },
    { enabled: !!organization },
  );

  // Real payment methods from commerce (Square cards, wires, etc.).
  const paymentMethodsQuery = api.cloudBilling.listPaymentMethods.useQuery(
    { orgId },
    { enabled: !!organization },
  );
  const paymentMethods = paymentMethodsQuery.data ?? [];

  const removePaymentMethod = api.cloudBilling.removePaymentMethod.useMutation({
    onSuccess: () => {
      void paymentMethodsQuery.refetch();
      void subscriptionQuery.refetch();
    },
  });

  // Recent invoices (commerce-backed).
  const { data: invoiceData } = api.cloudBilling.getInvoices.useQuery(
    { orgId, limit: 2 },
    { enabled: organization !== undefined },
  );

  const handlePaymentSuccess = () => {
    void paymentMethodsQuery.refetch();
    void subscriptionQuery.refetch();
    void orgDetailsQuery.refetch();
  };

  const currentPlanKey = organization?.plan as Plan | undefined;
  const currentPlan = currentPlanKey ? planLabels[currentPlanKey] : "Free Plan";
  const availableCredits = orgDetailsQuery.data?.credits || 0;

  const hasActiveSubscription = Boolean(
    organization?.cloudConfig?.stripe?.activeSubscriptionId,
  );

  const billingPeriodEnd = subscription?.billingPeriod?.end;
  const nextBillingDate = billingPeriodEnd
    ? new Date(billingPeriodEnd).toLocaleDateString()
    : "N/A";

  const invoices = invoiceData?.invoices ?? [];

  return (
    <div className="space-y-6">
      {/* Current Plan Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Current Plan</h3>
            <h2 className="mt-2 text-2xl font-bold">{currentPlan}</h2>
            <p className="text-muted-foreground text-sm">
              {hasActiveSubscription
                ? "Active subscription"
                : "No active subscription"}
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push("/pricing")}>
            Upgrade Plan
          </Button>
        </div>
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <p className="text-muted-foreground text-sm">
            Next billing date: {nextBillingDate}
          </p>
        </div>
      </Card>

      {/* Credit Balance Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Credit Balance</h3>
          <Button onClick={() => setPayDialog("buy-credits")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Credits
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="bg-primary flex h-12 w-12 items-center justify-center rounded-full">
            <span className="text-primary-foreground text-xl font-bold">$</span>
          </div>
          <div>
            <p className="text-2xl font-bold">${availableCredits.toFixed(2)}</p>
            <p className="text-muted-foreground text-sm">Available credits</p>
          </div>
        </div>
      </Card>

      {/* Payment Method Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Payment Methods</h3>
          <Button variant="outline" onClick={() => setPayDialog("add-card")}>
            <Plus className="mr-2 h-4 w-4" />
            Add card
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {paymentMethods.length === 0 ? (
            <div className="flex items-center gap-3">
              <CreditCard className="h-6 w-6" />
              <div>
                <p className="font-medium">No payment method</p>
                <p className="text-muted-foreground text-sm">
                  Add a card to enable paid usage and top-ups.
                </p>
              </div>
            </div>
          ) : (
            paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between border-b pb-3 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="h-6 w-6" />
                  <div>
                    <p className="font-medium capitalize">
                      {pm.card?.brand
                        ? `${pm.card.brand} ending in ${pm.card.last4 ?? "••••"}`
                        : pm.type}
                      {pm.isDefault ? " · Default" : ""}
                    </p>
                    <p className="text-muted-foreground text-xs capitalize">
                      {pm.type}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removePaymentMethod.isLoading}
                  onClick={() =>
                    removePaymentMethod.mutate({
                      orgId,
                      paymentMethodId: pm.id,
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Recent Invoices Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Recent Invoices</h3>
        </div>
        <div className="mt-4 space-y-4">
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices yet</p>
          ) : (
            invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between border-b pb-4 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="text-sm">
                    <p className="font-medium">
                      {invoice.number || invoice.id}
                    </p>
                    <p className="text-muted-foreground">
                      {invoice.created
                        ? new Date(invoice.created).toLocaleDateString()
                        : "N/A"}
                    </p>
                    <p className="text-muted-foreground text-xs capitalize">
                      {invoice.status || "Unknown"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  {invoice.breakdown ? (
                    <p className="font-medium">
                      {invoice.currency?.toUpperCase()}{" "}
                      {(invoice.breakdown.totalCents / 100).toFixed(2)}
                    </p>
                  ) : null}
                  {invoice.invoicePdfUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        window.open(invoice.invoicePdfUrl as string, "_blank")
                      }
                    >
                      Download
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {organization && payDialog && (
        <SquarePaymentDialog
          open={payDialog !== null}
          onOpenChange={(o) => !o && setPayDialog(null)}
          orgId={orgId}
          mode={payDialog}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
};
