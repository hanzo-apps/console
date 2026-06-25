// This is a placeholder to read the file contents.

// Hanzo Cloud only
import { Button } from "@/src/components/ui/button";
import { api } from "@/src/utils/api";
// import { Flex, MarkerBar, Metric, Text } from "@tremor/react";
import Header from "@/src/components/layouts/header";
// import { useQueryOrganization } from "@/src/features/organizations/hooks";
// import { Card } from "@/src/components/ui/card";
// import { numberFormatter, compactNumberFormatter } from "@/src/utils/numbers";
import { useHasEntitlement } from "@/src/features/entitlements/hooks";
// import { type Plan, planLabels } from "@hanzo/console";
import { useRouter } from "next/router";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { BillingOverview } from "./overview/BillingOverview";
import { InvoiceHistory } from "./overview/InvoiceHistory";
import { PaymentManagement } from "./overview/PaymentManagement";
import { CreditsManagement } from "./CreditsManagement";
import { useHasOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { useState } from "react";
import { Receipt, CreditCard, Coins } from "lucide-react";

export const BillingSettings = () => {
  const router = useRouter();
  const orgId = router.query.organizationId as string | undefined;
  const [activeView, setActiveView] = useState<
    "history" | "payment" | "credits"
  >("history");

  const hasAccess = useHasOrganizationAccess({
    organizationId: orgId,
    scope: "hanzoCloudBilling:CRUD",
  });

  const entitled = useHasEntitlement("cloud-billing");

  // Warm the commerce plan catalog on page load so the plan dialog opens
  // instantly. Commerce /plans is intermittently slow; this prefetch (shared
  // query key with the dialog) + the server-side cache hide that latency.
  api.cloudBilling.listPlans.useQuery(
    { orgId: orgId ?? "" },
    {
      enabled: !!orgId && hasAccess && entitled,
      staleTime: 10 * 60 * 1000,
    },
  );

  if (!entitled) return null;

  if (!hasAccess)
    return (
      <Alert>
        <AlertTitle>Access Denied</AlertTitle>
        <AlertDescription>
          You do not have permission to view the billing settings of this
          organization.
        </AlertDescription>
      </Alert>
    );

  return (
    <div>
      <Header title="Usage & Billing" />
      <div className="mb-6">
        <div className="inline-flex rounded-lg border p-1">
          <Button
            variant={activeView === "history" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveView("history")}
            className="gap-2"
          >
            <Receipt className="h-4 w-4" />
            View Billing History
          </Button>
          <Button
            variant={activeView === "payment" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveView("payment")}
            className="gap-2"
          >
            <CreditCard className="h-4 w-4" />
            Manage Payment Methods
          </Button>
          <Button
            variant={activeView === "credits" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveView("credits")}
            className="gap-2"
          >
            <Coins className="h-4 w-4" />
            Cloud Credits
          </Button>
        </div>
      </div>

      {activeView === "history" ? (
        <div className="space-y-6">
          <BillingOverview />
          <InvoiceHistory />
        </div>
      ) : activeView === "payment" ? (
        <PaymentManagement />
      ) : (
        <CreditsManagement />
      )}
    </div>
  );
};
