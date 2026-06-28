import { createStripeClientReference } from "@/src/ee/features/billing/utils/stripeClientReference";
import { stripeClient } from "@/src/features/billing/utils/stripe";
import { stripeProducts } from "@/src/features/billing/utils/stripeProducts";
import { env } from "@/src/env.mjs";
import { throwIfNoEntitlement } from "@/src/features/entitlements/server/hasEntitlement";
import { parseDbOrg } from "@hanzo/console";
import {
  createTRPCRouter,
  protectedOrganizationProcedure,
} from "@/src/server/api/trpc";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { throwIfNoOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  getObservationCountOfProjectsSinceCreationDate,
  logger,
} from "@hanzo/console/src/server";
import {
  commerceGet,
  commercePost,
  commercePatch,
  commercePut,
  commerceDelete,
  type CommerceCaller,
} from "@/src/features/billing/server/commerceClient";
import type Stripe from "stripe";

/**
 * Shape returned by Hanzo Commerce GET /v1/billing/usage-rollup — the single
 * billing source of truth for plan + included-usage + overage + balance.
 * Commerce derives every figure from the same balance transactions the gateway
 * prepaid gate reads, so this view is consistent with enforcement.
 */
export type CommerceUsageRollup = {
  user: string;
  plan: string;
  currency: string;
  period: string;
  included: {
    monthlyCents: number; // catalog allotment for the plan
    grantedCents: number; // actually granted to the balance this period
    consumedCents: number; // included credit consumed so far
    remainingCents: number; // included credit left
  };
  consumedCents: number; // total usage this period
  overageCents: number; // usage beyond the included credit
  balance: {
    balanceCents: number;
    holdsCents: number;
    availableCents: number; // the value the gateway gate reads (available > 0)
  };
};

/** Shape returned by Commerce GET /v1/billing/credit-balance. */
export type CommerceCreditBalance = {
  userId: string;
  balances: Array<{ currency: string; available: number }>; // available in cents
};

/** Raw shape from Commerce GET /v1/billing/balance (cents). */
type CommerceBalance = {
  user: string;
  currency: string;
  balance: number;
  holds: number;
  available: number;
};

/** Raw shape from Commerce GET /v1/billing/tier. */
type CommerceTier = {
  user: string;
  tier: {
    name: string;
    displayName: string;
    dailyCreditsCents: number;
    maxAgents: number;
    unlimitedAgents: boolean;
    allowedModels: string[];
  };
  balance: {
    currency: string;
    prepaidAvailable: number; // cents
    dailyRemaining: number; // cents
    effectiveAvailable: number; // cents
  };
};

/** Raw shape from Commerce GET /v1/billing/usage. */
type CommerceUsage = {
  user: string;
  count: number;
  usage: Array<{
    transactionId: string;
    amount: number; // cents (usage is recorded as withdrawals)
    currency: string;
    notes?: string;
    metadata?: unknown;
    createdAt?: string;
  }>;
};

/** Raw shape from Commerce GET /v1/billing/invoices. */
type CommerceInvoiceList = {
  count: number;
  invoices: Array<{
    id: string;
    number?: string | null;
    status?: string | null;
    currency?: string;
    total?: number; // cents
    amountDue?: number; // cents
    createdAt?: string | number;
    hostedInvoiceUrl?: string | null;
    invoicePdfUrl?: string | null;
  }>;
};

/** Shape returned by Commerce GET/PUT /v1/billing/auto-recharge. */
export type CommerceAutoRecharge = {
  userId: string;
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
  currency: string;
  lastRechargedAt?: string;
};

/** Shape returned by Commerce GET /v1/billing/payment-config. */
export type CommercePaymentConfig = {
  provider: string;
  applicationId: string;
  locationId: string;
  environment: string; // "sandbox" | "production"
  live: boolean;
};

/** Shape returned by Commerce POST /v1/billing/credit-grants. */
export type CommerceCreditGrant = {
  id: string;
  userId: string;
  name: string;
  amountCents: number;
  remainingCents: number;
  currency: string;
  priority: number;
  tags?: string;
  createdAt?: string;
  expiresAt?: string;
};

/** Shape returned by Commerce GET/POST /v1/billing/payment-methods. */
export type CommercePaymentMethod = {
  id: string;
  customerId?: string;
  type: string; // "card" | "wire" | "crypto" | "bank_account"
  isDefault?: boolean;
  card?: {
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  } | null;
  providerRef?: string;
  providerType?: string;
  metadata?: Record<string, unknown>;
  created?: string;
};

/** Shape returned by Commerce POST /v1/billing/topup/token. */
export type CommerceTopupResult = {
  transactionId?: string;
  balanceCents?: number;
  status?: string;
};

/** Shape returned by Commerce GET /v1/billing/plans (prices in cents). */
export type CommercePlan = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  price: number; // cents, monthly
  priceAnnual?: number; // cents, annual
  currency?: string;
  interval?: string;
  intervalCount?: number;
  trialPeriodDays?: number;
  features?: string[];
  limits?: Record<string, number>;
};

/** Shape returned by Commerce subscription endpoints. */
export type CommerceSubscription = {
  id: string;
  userId: string;
  planId: string;
  status: string;
  quantity?: number;
  currentPeriodStart?: string | number;
  currentPeriodEnd?: string | number;
  cancelAtPeriodEnd?: boolean;
  providerType?: string;
  defaultPaymentMethod?: string;
  plan?: {
    id?: string;
    name?: string;
    price?: number;
    currency?: string;
    interval?: string;
  };
  canceledAt?: string | number;
};

const ACTIVE_SUB_STATUSES = ["active", "trialing", "past_due"];

// Commerce /plans and /subscriptions are intermittently slow (sub-second → 30s
// hangs). Bound every call with a timeout, and cache the plan catalog in-process
// so the plans dialog never blocks on a cold/slow upstream.
const COMMERCE_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out`)),
        COMMERCE_TIMEOUT_MS,
      ),
    ),
  ]);
}

// Honest zero rollup used when commerce is unavailable. Tenant spend is a
// display concern: an empty state is correct here, a 500 is not.
const EMPTY_USAGE_ROLLUP = (user: string): CommerceUsageRollup => ({
  user,
  plan: "free",
  currency: "usd",
  period: new Date().toISOString().slice(0, 7),
  included: {
    monthlyCents: 0,
    grantedCents: 0,
    consumedCents: 0,
    remainingCents: 0,
  },
  consumedCents: 0,
  overageCents: 0,
  balance: { balanceCents: 0, holdsCents: 0, availableCents: 0 },
});

let plansCache: { at: number; plans: CommercePlan[] } | null = null;
const PLANS_CACHE_TTL_MS = 10 * 60 * 1_000;

// Only the core personal plans belong in the org plan picker — commerce /plans
// also returns the World and DNS catalogs.
function isCorePlan(p: CommercePlan): boolean {
  return (p.category ?? "personal") === "personal" && p.slug !== "custom";
}

// Last-resort catalog if commerce is unreachable AND the cache is cold.
const FALLBACK_PLANS: CommercePlan[] = [
  {
    slug: "developer",
    name: "Developer",
    price: 0,
    currency: "usd",
    interval: "monthly",
    description: "Get started for free. Explore the API with included credits.",
    features: [
      "$5 free credit",
      "60 requests/min",
      "100K tokens/min",
      "Community support",
      "API access",
    ],
  },
  {
    slug: "pro",
    name: "Pro",
    price: 4900,
    priceAnnual: 3900,
    currency: "usd",
    interval: "monthly",
    description: "For developers shipping real products.",
    features: ["Higher rate limits", "Priority support", "Hanzo World Pro"],
  },
  {
    slug: "team",
    name: "Team",
    price: 19900,
    priceAnnual: 15900,
    currency: "usd",
    interval: "monthly",
    description: "For teams that need controls and scale.",
    features: ["Everything in Pro", "Org controls", "SSO"],
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price: 999900,
    priceAnnual: 799900,
    currency: "usd",
    interval: "monthly",
    description: "Enterprise-grade security and support.",
    features: ["Custom rate limits", "Uptime SLA", "Dedicated support"],
  },
];

export const cloudBillingRouter = createTRPCRouter({
  createStripeCheckoutSession: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        stripeProductId: z.string(),
        customerEmail: z.string().email().optional(),
        customerName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Access checks
        throwIfNoOrganizationAccess({
          organizationId: input.orgId,
          scope: "hanzoCloudBilling:CRUD",
          session: ctx.session,
        });
        throwIfNoEntitlement({
          entitlement: "cloud-billing",
          sessionUser: ctx.session.user,
          orgId: input.orgId,
        });

        // Find organization
        const org = await ctx.prisma.organization.findUnique({
          where: { id: input.orgId },
        });

        if (!org) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
          });
        }

        // Parse organization configuration
        const parsedOrg = parseDbOrg(org);

        // Stripe client check
        if (!stripeClient) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Stripe client not initialized",
          });
        }

        // Product validation
        const validProducts = stripeProducts.filter(
          (product) => product.checkout,
        );

        const isValidProduct = validProducts.some(
          (product) => product.stripeProductId === input.stripeProductId,
        );

        if (!isValidProduct) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid Stripe product ID",
          });
        }

        // Retrieve Stripe product
        const product = await stripeClient.products.retrieve(
          input.stripeProductId,
        );

        // Retrieve the default price and verify its type
        if (!product.default_price) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Product does not have a default price",
          });
        }

        const price = await stripeClient.prices.retrieve(
          product.default_price as string,
        );

        // Determine the checkout mode based on price type
        const checkoutMode =
          price.type === "recurring" ? "subscription" : "payment";

        // Use the custom email if provided, otherwise fall back to session email
        const customerEmail =
          input.customerEmail || ctx.session.user.email || "";

        // Create checkout session
        const returnUrl = `${env.NEXTAUTH_URL}/organization/${input.orgId}/settings/billing`;
        const sessionConfig: Stripe.Checkout.SessionCreateParams = {
          line_items: [
            {
              price: product.default_price as string,
              quantity: checkoutMode === "payment" ? 10 : 1,
              ...(checkoutMode === "payment"
                ? {
                    adjustable_quantity: {
                      enabled: true,
                      minimum: 10,
                      maximum: 1000,
                    },
                  }
                : {}),
            },
          ],
          client_reference_id:
            createStripeClientReference(input.orgId) ?? undefined,
          // Handle customer configuration for payment mode
          ...(checkoutMode === "payment"
            ? {
                // If we have an existing customer, use it
                ...(parsedOrg.cloudConfig?.stripe?.customerId
                  ? { customer: parsedOrg.cloudConfig.stripe.customerId }
                  : {
                      // Only create new customer if we don't have one
                      customer_creation: "if_required",
                      customer_email: customerEmail,
                    }),
              }
            : {
                customer_email: customerEmail,
              }),
          allow_promotion_codes: true,
          success_url: returnUrl,
          cancel_url: returnUrl,
          mode: checkoutMode,
          metadata: {
            orgId: input.orgId,
            cloudRegion: env.NEXT_PUBLIC_HANZO_CLOUD_REGION ?? null,
            productType: price.type,
          },
        };

        const session =
          await stripeClient.checkout.sessions.create(sessionConfig);

        // Audit logging
        auditLog({
          session: ctx.session,
          orgId: input.orgId,
          resourceType: "stripeCheckoutSession",
          resourceId: session.id,
          action: "create",
        });

        // Return the checkout URL along with a flag to indicate whether the session was created
        return {
          url: session.url,
          sessionId: session.id,
        };
      } catch (error) {
        // Log additional details about the error
        if (error instanceof Error) {
          console.error("Error Name:", error.name);
          console.error("Error Message:", error.message);
          console.error("Error Stack:", error.stack);
        }

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? `Unexpected error: ${error.message}`
              : "Unknown error occurred",
        });
      }
    }),
  changeStripeSubscriptionProduct: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        stripeProductId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });
      throwIfNoEntitlement({
        entitlement: "cloud-billing",
        sessionUser: ctx.session.user,
        orgId: input.orgId,
      });

      // check that product is valid
      if (
        !stripeProducts
          .filter((i) => Boolean(i.checkout))
          .map((i) => i.stripeProductId)
          .includes(input.stripeProductId)
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid stripe product id, product not available",
        });

      const org = await ctx.prisma.organization.findUnique({
        where: {
          id: input.orgId,
        },
      });
      if (!org) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);
      if (parsedOrg.cloudConfig?.plan)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cannot change plan for orgs that have a manual/legacy plan",
        });

      const stripeSubscriptionId =
        parsedOrg.cloudConfig?.stripe?.activeSubscriptionId;

      if (!stripeSubscriptionId)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Organization does not have an active subscription",
        });

      if (!stripeClient)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe client not initialized",
        });

      const subscription =
        await stripeClient.subscriptions.retrieve(stripeSubscriptionId);

      if (
        ["canceled", "paused", "incomplete", "incomplete_expired"].includes(
          subscription.status,
        )
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Subscription is not active, current status: " +
            subscription.status,
        });

      if (subscription.items.data.length !== 1)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Subscription has multiple items",
        });

      const item = subscription.items.data[0];

      if (
        !stripeProducts
          .map((i) => i.stripeProductId)
          .includes(item.price.product as string)
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Current subscription product is not a valid product",
        });

      const newProduct = await stripeClient.products.retrieve(
        input.stripeProductId,
      );
      if (!newProduct.default_price)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "New product does not have a default price in Stripe",
        });

      await stripeClient.subscriptions.update(stripeSubscriptionId, {
        items: [
          // remove current product from subscription
          {
            id: item.id,
            deleted: true,
          },
          // add new product to subscription
          {
            price: newProduct.default_price as string,
          },
        ],
        // reset billing cycle which causes immediate invoice for existing plan
        billing_cycle_anchor: "now",
        proration_behavior: "none",
      });
    }),
  getStripeCustomerPortalUrl: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoEntitlement({
        entitlement: "cloud-billing",
        sessionUser: ctx.session.user,
        orgId: input.orgId,
      });
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const org = await ctx.prisma.organization.findUnique({
        where: {
          id: input.orgId,
        },
      });
      if (!org) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Organization not found",
        });
      }

      // Commerce-native billing has no Stripe client. Return null so the UI
      // hides the "manage in Stripe" portal button instead of 500-ing the
      // whole billing page (PaymentManagement queries this on render).
      if (!stripeClient) return null;

      const parsedOrg = parseDbOrg(org);
      let stripeCustomerId = parsedOrg.cloudConfig?.stripe?.customerId;

      // Fetch subscriptions separately

      let stripeSubscriptionId =
        parsedOrg.cloudConfig?.stripe?.activeSubscriptionId;

      if (!stripeCustomerId || !stripeSubscriptionId) {
        // Do not create a new customer if the org is on a plan (assigned manually)
        return null;
      }

      const billingPortalSession =
        await stripeClient.billingPortal.sessions.create({
          customer: stripeCustomerId,
          return_url: `${env.NEXTAUTH_URL}/organization/${input.orgId}/settings/billing`,
        });

      return billingPortalSession.url;
    }),
  getUsage: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        throwIfNoEntitlement({
          entitlement: "cloud-billing",
          sessionUser: ctx.session.user,
          orgId: input.orgId,
        });

        throwIfNoOrganizationAccess({
          organizationId: input.orgId,
          scope: "hanzoCloudBilling:CRUD",
          session: ctx.session,
        });

        const organization = await ctx.prisma.organization.findUnique({
          where: {
            id: input.orgId,
          },
          include: {
            projects: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!organization) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Organization not found",
          });
        }

        const parsedOrg = parseDbOrg(organization);

        if (
          stripeClient &&
          parsedOrg.cloudConfig?.stripe?.customerId &&
          parsedOrg.cloudConfig?.stripe?.activeSubscriptionId
        ) {
          const subscription = await stripeClient.subscriptions.retrieve(
            parsedOrg.cloudConfig.stripe.activeSubscriptionId,
          );
          if (subscription) {
            const firstItem = subscription.items.data[0];
            const billingPeriod =
              firstItem?.current_period_start && firstItem?.current_period_end
                ? {
                    start: new Date(firstItem.current_period_start * 1000),
                    end: new Date(firstItem.current_period_end * 1000),
                  }
                : null;
            try {
              const stripeInvoice = await stripeClient.invoices.createPreview({
                subscription: parsedOrg.cloudConfig.stripe.activeSubscriptionId,
              });

              const upcomingInvoice = {
                usdAmount: stripeInvoice.amount_due / 100,
                date: new Date(stripeInvoice.period_end * 1000),
              };

              const usageInvoiceLines = stripeInvoice.lines.data.filter(
                (line: any) => Boolean(line.price?.recurring?.meter),
              );
              const usage = usageInvoiceLines.reduce(
                (acc: number, line: any) => {
                  if (line.quantity) {
                    return acc + line.quantity;
                  }
                  return acc;
                },
                0,
              );

              const meterId = (usageInvoiceLines[0] as any)?.price?.recurring
                ?.meter;
              const meter = meterId
                ? await stripeClient.billing.meters.retrieve(meterId)
                : undefined;
              // console.log("Meter details:", meter);

              return {
                usageCount: usage,
                usageType: meter?.display_name.toLowerCase() ?? "events",
                billingPeriod,
                upcomingInvoice,
              };
            } catch (e) {
              console.error(
                "Failed to get usage from Stripe, using usage from Datastore",
                {
                  error: e,
                },
              );
            }
          }
        }

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        const projectIds = organization.projects.map((p) => p.id);
        console.log("Project IDs for usage calculation:", projectIds);

        const countObservations =
          await getObservationCountOfProjectsSinceCreationDate({
            projectIds,
            start: thirtyDaysAgo,
          });
        console.log("Count of observations:", countObservations);

        return {
          usageCount: countObservations,
          usageType: "observations",
        };
      } catch (error) {
        console.error("Error in getUsage function:", error);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? `Unexpected error: ${error.message}`
              : "Unknown error occurred",
        });
      }
    }),

  getSubscription: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!stripeClient) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe client not initialized",
        });
      }

      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);
      const stripeCustomerId = parsedOrg.cloudConfig?.stripe?.customerId;

      // If no Stripe customer ID, return null
      if (!stripeCustomerId) {
        console.warn(
          `No Stripe customer ID found for organization ${input.orgId}`,
        );
        return null;
      }

      try {
        // Fetch subscriptions that are still relevant (active, past_due, or scheduled to cancel)
        const subscriptionsResponse = await stripeClient.subscriptions.list({
          limit: 1,
          expand: ["data"],
          customer: stripeCustomerId,
          status: "active",
        });

        // No subscriptions found
        if (!subscriptionsResponse.data.length) {
          console.info(
            `No subscriptions found for customer ${stripeCustomerId}`,
          );
          return null;
        }

        // Get the most recent subscription
        const latestSubscription = subscriptionsResponse.data[0];
        const firstItem = latestSubscription.items.data[0];
        const productId = firstItem?.price?.product as string;

        // Retrieve product details separately
        const productDetails = await stripeClient.products.retrieve(productId);

        return {
          id: latestSubscription.id,
          status: latestSubscription.status,
          current_period_start: firstItem?.current_period_start
            ? new Date(firstItem.current_period_start * 1000)
            : null,
          current_period_end: firstItem?.current_period_end
            ? new Date(firstItem.current_period_end * 1000)
            : null,
          cancel_at: latestSubscription.cancel_at
            ? new Date(latestSubscription.cancel_at * 1000)
            : null,
          canceled_at: latestSubscription.canceled_at
            ? new Date(latestSubscription.canceled_at * 1000)
            : null,
          plan: {
            name: productDetails.name || "Unknown Plan",
            description:
              productDetails.description || "No description available",
            id: productId,
          },
          price: {
            amount: firstItem?.price?.unit_amount
              ? firstItem.price.unit_amount / 100
              : null,
            currency: firstItem?.price?.currency,
          },
        };
      } catch (error) {
        console.error(
          `Error retrieving subscription for organization ${input.orgId}:`,
          error,
        );
        return null;
      }
    }),

  // New method to save subscription data
  saveSubscriptionData: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        stripeSubscriptionId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      if (!stripeClient) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe client not initialized",
        });
      }

      try {
        // Retrieve the full subscription details
        const subscription = await stripeClient.subscriptions.retrieve(
          input.stripeSubscriptionId,
        );

        // Ensure we have a single price/product
        if (subscription.items.data.length !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Subscription must have exactly one product",
          });
        }

        const subscriptionItem = subscription.items.data[0];
        const productId = subscriptionItem.price.product as string;
        const priceId = subscriptionItem.price.id;

        // Update organization's cloud config with subscription details
        const org = await ctx.prisma.organization.findUnique({
          where: { id: input.orgId },
        });

        if (!org) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
          });
        }

        // Prepare updated cloud config
        const updatedCloudConfig = org.cloudConfig
          ? {
              ...JSON.parse(JSON.stringify(org.cloudConfig)),
              stripe: {
                ...((org.cloudConfig as any)?.stripe || {}),
                activeSubscriptionId: input.stripeSubscriptionId,
                activeProductId: productId,
                activePriceId: priceId,
                subscriptionStatus: subscription.status,
                currentPeriodStart: subscriptionItem.current_period_start
                  ? new Date(subscriptionItem.current_period_start * 1000)
                  : null,
                currentPeriodEnd: subscriptionItem.current_period_end
                  ? new Date(subscriptionItem.current_period_end * 1000)
                  : null,
              },
            }
          : {
              stripe: {
                activeSubscriptionId: input.stripeSubscriptionId,
                activeProductId: productId,
                activePriceId: priceId,
                subscriptionStatus: subscription.status,
                currentPeriodStart: subscriptionItem.current_period_start
                  ? new Date(subscriptionItem.current_period_start * 1000)
                  : null,
                currentPeriodEnd: subscriptionItem.current_period_end
                  ? new Date(subscriptionItem.current_period_end * 1000)
                  : null,
              },
            };

        // Create or update StripeSubscription record

        // Update organization with new cloud config
        await ctx.prisma.organization.update({
          where: { id: input.orgId },
          data: {
            cloudConfig: updatedCloudConfig,
          },
        });

        // Audit log the subscription save
        auditLog({
          session: ctx.session,
          orgId: input.orgId,
          resourceType: "stripeCheckoutSession",
          resourceId: input.stripeSubscriptionId,
          action: "create",
        });

        return {
          success: true,
          subscriptionId: input.stripeSubscriptionId,
          // plan: subscription.items.data[0].price.product. ,
        };
      } catch (error) {
        console.error("Error saving subscription data:", error);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? `Failed to save subscription: ${error.message}`
              : "Unknown error occurred while saving subscription",
        });
      }
    }),

  // New method to get subscription history
  getSubscriptionHistory: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        limit: z.number().optional().default(10),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!stripeClient) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe client not initialized",
        });
      }

      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);
      const stripeCustomerId = parsedOrg.cloudConfig?.stripe?.customerId;

      if (!stripeCustomerId) {
        return {
          subscriptions: [],
          hasMore: false,
        };
      }

      try {
        // Retrieve subscription history from Stripe
        const subscriptionsResponse = await stripeClient.subscriptions.list({
          customer: stripeCustomerId,
          limit: input.limit,
          expand: ["data.latest_invoice", "data.items.data.price"],
        });

        // Fetch all unique product details first
        const productIds = new Set(
          subscriptionsResponse.data
            .map((subscription) => subscription.items.data[0]?.price?.product)
            .filter(Boolean) as string[],
        );

        const productDetailsMap = new Map<string, string>();
        for (const productId of productIds) {
          try {
            const product = await stripeClient.products.retrieve(productId);
            productDetailsMap.set(productId, product.name || "Unknown Plan");
          } catch (error) {
            console.error(`Failed to retrieve product ${productId}:`, error);
            productDetailsMap.set(productId, "Unknown Plan");
          }
        }
        // Then use the map when transforming subscriptions
        const subscriptionHistory = subscriptionsResponse.data.map(
          (subscription) => {
            const firstItem = subscription.items.data[0];
            const productId = firstItem?.price?.product as string;
            const billingPeriod =
              firstItem?.current_period_start && firstItem?.current_period_end
                ? {
                    start: new Date(firstItem.current_period_start * 1000),
                    end: new Date(firstItem.current_period_end * 1000),
                  }
                : null;
            return {
              id: subscription.id,
              status: subscription.status,
              plan: {
                name: productDetailsMap.get(productId) || "Unknown Plan",
                amount: firstItem?.price?.unit_amount
                  ? firstItem.price.unit_amount / 100
                  : 0,
                billingPeriod: billingPeriod,
              },
              latestInvoice: subscription.latest_invoice
                ? {
                    id: (subscription.latest_invoice as Stripe.Invoice).id,
                    amountDue:
                      (subscription.latest_invoice as Stripe.Invoice)
                        .amount_due / 100,
                    status: (subscription.latest_invoice as Stripe.Invoice)
                      .status,
                    number:
                      (subscription.latest_invoice as Stripe.Invoice).number ||
                      "N/A",
                    pdfUrl:
                      (subscription.latest_invoice as Stripe.Invoice)
                        .invoice_pdf || null,
                  }
                : null,
            };
          },
        );

        return {
          subscriptions: subscriptionHistory,
          hasMore: subscriptionsResponse.has_more,
        };
      } catch (error) {
        console.error("Error retrieving subscription history:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve subscription history",
        });
      }
    }),

  getInvoicePdfUrl: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        invoiceId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!stripeClient) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe client not initialized",
        });
      }

      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);
      const stripeCustomerId = parsedOrg.cloudConfig?.stripe?.customerId;

      if (!stripeCustomerId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No Stripe customer associated with this organization",
        });
      }

      try {
        // Retrieve the invoice
        const invoice = await stripeClient.invoices.retrieve(input.invoiceId);

        // Ensure the invoice belongs to the customer
        if (invoice.customer !== stripeCustomerId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Invoice does not belong to this organization",
          });
        }

        // Check if invoice has a PDF
        if (!invoice.invoice_pdf) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No PDF available for this invoice",
          });
        }

        return {
          pdfUrl: invoice.invoice_pdf,
          invoiceNumber: invoice.number || "Unknown",
          amountDue: invoice.amount_due / 100,
          invoiceDate: new Date(invoice.created * 1000),
        };
      } catch (error) {
        console.error(
          `Error retrieving invoice PDF for ${input.invoiceId}:`,
          error,
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve invoice PDF",
        });
      }
    }),

  cancelStripeSubscription: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        stripeProductId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });
      throwIfNoEntitlement({
        entitlement: "cloud-billing",
        sessionUser: ctx.session.user,
        orgId: input.orgId,
      });

      if (!stripeClient) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe client not initialized",
        });
      }

      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);

      // Try to get the active subscription ID from cloud config
      let stripeSubscriptionId =
        parsedOrg.cloudConfig?.stripe?.activeSubscriptionId;

      // If no active subscription ID, try to fetch the latest active subscription
      if (!stripeSubscriptionId) {
        const stripeCustomerId = parsedOrg.cloudConfig?.stripe?.customerId;

        if (!stripeCustomerId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No Stripe customer found for this organization",
          });
        }

        // Fetch active subscriptions for this customer
        const subscriptionsResponse = await stripeClient.subscriptions.list({
          customer: stripeCustomerId,
          status: "active",
          limit: 1,
        });

        if (subscriptionsResponse.data.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No active subscriptions found",
          });
        }

        stripeSubscriptionId = subscriptionsResponse.data[0].id;
      }

      try {
        // Retrieve the current subscription to validate
        const currentSubscription =
          await stripeClient.subscriptions.retrieve(stripeSubscriptionId);

        // Validate that the current subscription matches the product being canceled
        const currentProductId =
          currentSubscription.items.data[0]?.price?.product;

        if (currentProductId !== input.stripeProductId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Subscription product does not match the requested cancellation",
          });
        }

        // Cancel the subscription at the end of the current billing period
        const canceledSubscription = await stripeClient.subscriptions.update(
          stripeSubscriptionId,
          {
            cancel_at_period_end: true,
          },
        );

        // Audit log the subscription cancellation
        auditLog({
          session: ctx.session,
          orgId: input.orgId,
          resourceType: "organization",
          resourceId: stripeSubscriptionId,
          action: "cancel",
        });

        return {
          success: true,
          message:
            "Subscription will be canceled at the end of the current billing period",
          cancelAt: canceledSubscription.cancel_at
            ? new Date(canceledSubscription.cancel_at * 1000)
            : null,
        };
      } catch (error) {
        console.error("Full Error in cancelStripeSubscription:", error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? `Unexpected error: ${error.message}`
              : "Unknown error occurred",
        });
      }
    }),

  // Commerce-backed plan + included-usage rollup. Read-only: commerce is the
  // single billing source of truth; the console only displays. Keyed by the
  // commerce user identity (<org>/<userId>); when not supplied we fall back to
  // the org slug so the page shows the org's plan/usage aggregate.
  getCommerceUsageRollup: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        // Optional explicit commerce user key ("<org>/<userId>"). When omitted,
        // the org slug is used.
        user: z.string().optional(),
        // Optional plan slug override; commerce resolves from the subscription
        // when omitted.
        plan: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }): Promise<CommerceUsageRollup> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Commerce namespaces tenants by org slug (the X-Hanzo-Org header). The
      // rollup `user` key follows the gateway convention (<org>/<userId>) but
      // also accepts the org slug alone for an org-level view.
      const org = organization.name;
      const user = input.user ?? org;
      // Authenticate AS the signed-in user; commerce derives + locks the billed
      // org from the verified token owner (the `user`/`org` params below are
      // advisory — EdgeAuth pins the subject to that org for non-admins).
      const caller: CommerceCaller = { iamSub: ctx.session.user.iamSub, org };

      // Commerce has no single "usage-rollup" route; we compose the rollup from
      // the three sources that ARE the billing source of truth — tier (plan +
      // included credit), balance (prepaid balance/holds/available), and usage
      // (consumed) — exactly the data the gateway prepaid gate reads. All three
      // are org-scoped via X-Hanzo-Org.
      //
      // Tenant spend visibility is a read-only display concern that must never
      // hard-fail the billing page: if commerce is slow/unreachable or returns
      // an unexpected shape, degrade to an honest zero rollup (same pattern as
      // listPlans / getActiveSubscription) rather than surfacing a 500. When
      // commerce responds, the tenant sees their real spend.
      let tier: CommerceTier;
      let balance: CommerceBalance;
      let usage: CommerceUsage;
      try {
        [tier, balance, usage] = await Promise.all([
          withTimeout(
            commerceGet<CommerceTier>("/v1/billing/tier", caller, {
              user,
              tier: input.plan,
            }),
            "commerce /tier",
          ),
          withTimeout(
            commerceGet<CommerceBalance>("/v1/billing/balance", caller, {
              user,
            }),
            "commerce /balance",
          ),
          withTimeout(
            commerceGet<CommerceUsage>("/v1/billing/usage", caller, { user }),
            "commerce /usage",
          ),
        ]);
      } catch (e) {
        logger.warn(
          `getCommerceUsageRollup: commerce unavailable for org "${org}", returning empty rollup`,
          e,
        );
        return EMPTY_USAGE_ROLLUP(user);
      }

      // Included credit: tiers grant a per-day allotment that resets at midnight
      // UTC and does not accumulate. Present it as the period's included usage.
      // Guard every field access: a 200 with an unexpected shape must still
      // degrade to zeros, not throw.
      const dailyGranted = tier?.tier?.dailyCreditsCents ?? 0;
      const includedRemaining = Math.max(0, tier?.balance?.dailyRemaining ?? 0);
      const includedConsumed = Math.max(0, dailyGranted - includedRemaining);

      // Total usage this period = sum of recorded api-usage withdrawals (cents).
      const consumed = (usage?.usage ?? []).reduce(
        (acc, u) => acc + Math.abs(u.amount ?? 0),
        0,
      );
      // Overage = usage drawn beyond the included credit, paid from prepaid.
      const overage = Math.max(0, consumed - includedConsumed);

      return {
        user,
        plan: tier?.tier?.name ?? "free",
        currency: balance?.currency || tier?.balance?.currency || "usd",
        period: new Date().toISOString().slice(0, 7), // YYYY-MM
        included: {
          // Monthly view of the daily allotment for display purposes.
          monthlyCents: dailyGranted * 30,
          grantedCents: dailyGranted,
          consumedCents: includedConsumed,
          remainingCents: includedRemaining,
        },
        consumedCents: consumed,
        overageCents: overage,
        balance: {
          balanceCents: balance?.balance ?? 0,
          holdsCents: balance?.holds ?? 0,
          availableCents: balance?.available ?? 0,
        },
      };
    }),

  // Commerce credit balance for an organization (sum of active credit grants).
  // Commerce namespaces each org by slug (X-Hanzo-Org header) and keys the credit
  // ledger by the same slug, so the org gets its own balance — true multi-tenant.
  getOrgCreditBalance: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }): Promise<CommerceCreditBalance> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Credit balance is a read-only display value; degrade to an empty
      // balance rather than 500ing the billing page when commerce is slow or
      // unreachable.
      try {
        return await withTimeout(
          commerceGet<CommerceCreditBalance>(
            "/v1/billing/credit-balance",
            { iamSub: ctx.session.user.iamSub, org: organization.name },
            { userId: organization.name },
          ),
          "commerce /credit-balance",
        );
      } catch (e) {
        logger.warn(
          `getOrgCreditBalance: commerce unavailable for org "${organization.name}", returning empty balance`,
          e,
        );
        return { userId: organization.name, balances: [] };
      }
    }),

  // Grant N cloud credits to an organization via Commerce — a first-class admin
  // action. Amount arrives in whole dollars from the UI and is converted to the
  // cents Commerce expects. Gated by hanzoCloudBilling:CRUD (owner/admin/
  // admin-billing); the grant is namespaced to the org via X-Hanzo-Org + userId.
  grantCredits: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        // Whole-dollar amount to grant (UI-friendly). Converted to cents below.
        amountUsd: z.number().positive().max(1_000_000),
        name: z.string().trim().min(1).max(120).optional(),
        // Optional Go-duration expiry (e.g. "720h"); omitted = never expires.
        expiresIn: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<CommerceCreditGrant> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const amountCents = Math.round(input.amountUsd * 100);
      if (amountCents <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Credit amount must be greater than zero.",
        });
      }

      const grant = await commercePost<CommerceCreditGrant>(
        "/v1/billing/credit-grants",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        {
          userId: organization.name,
          name: input.name ?? "Console credit grant",
          amountCents,
          currency: "usd",
          ...(input.expiresIn ? { expiresIn: input.expiresIn } : {}),
          tags: "console",
        },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: grant.id,
        action: "grantCredits",
        after: {
          amountCents,
          currency: "usd",
          grantId: grant.id,
          name: input.name ?? "Console credit grant",
        },
      });

      return grant;
    }),

  // ── Subscription / invoice surface read by the billing page UI ───────────
  // The console is commerce-native: plan + balance + invoices come from
  // Hanzo Commerce, not Stripe. These procedures return the shapes the UI
  // expects from real commerce data. Stripe-only affordances (customer portal,
  // promo codes, scheduled plan switches) degrade gracefully to null/no-op when
  // the org has no Stripe customer, so the page renders without error toasts.

  // Subscription summary for useBillingInformation / BillingOverview. Commerce
  // plans are prepaid and do not carry Stripe-style scheduled changes or
  // period-end cancellations, so those are null; hasValidPaymentMethod reflects
  // the commerce billing status.
  getSubscriptionInfo: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      let hasValidPaymentMethod = false;
      try {
        const status = await commerceGet<{
          hasPaymentMethod?: boolean;
          creditBalance?: number;
        }>(
          "/v1/billing/status",
          { iamSub: ctx.session.user.iamSub, org: organization.name },
          { user: organization.name },
        );
        hasValidPaymentMethod = Boolean(status.hasPaymentMethod);
      } catch {
        // Status is best-effort; a commerce hiccup must not crash the page.
        hasValidPaymentMethod = false;
      }

      return {
        cancellation: null as { cancelAt: number | null } | null,
        scheduledChange: null as {
          switchAt: number | null;
          newProductId?: string;
          scheduleId?: string;
          message?: string | null;
        } | null,
        billingPeriod: null as { start: Date; end: Date } | null,
        hasValidPaymentMethod,
      };
    }),

  // Real invoice history from Commerce (GET /v1/billing/invoices). Mapped to the
  // shape the invoice tables render. Cursor pagination is not used by commerce;
  // we return the full list with hasMore=false.
  getInvoices: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        limit: z.number().int().min(1).max(100).optional().default(10),
        startingAfter: z.string().optional(),
        endingBefore: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const res = await commerceGet<CommerceInvoiceList>(
        "/v1/billing/invoices",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        { user: organization.name },
      );

      const invoices = res.invoices.map((i) => ({
        id: i.id,
        number: i.number ?? null,
        status: i.status ?? null,
        currency: i.currency ?? "usd",
        created: i.createdAt
          ? new Date(
              typeof i.createdAt === "number"
                ? i.createdAt * 1000
                : i.createdAt,
            )
          : new Date(),
        hostedInvoiceUrl: i.hostedInvoiceUrl ?? null,
        invoicePdfUrl: i.invoicePdfUrl ?? null,
        // Commerce returns a single total (cents); it doesn't split subscription
        // vs usage vs tax. Populate totalCents so the invoice tables render, and
        // zero the unsplit components rather than leaving breakdown undefined
        // (which crashed InvoiceHistory).
        breakdown: {
          subscriptionCents: 0,
          usageCents: 0,
          discountCents: 0,
          taxCents: 0,
          totalCents: i.total ?? i.amountDue ?? 0,
        },
      }));

      return { invoices, hasMore: false, cursors: {} };
    }),

  // Stripe-only customer portal. Commerce-native orgs have no Stripe customer,
  // so this returns null and the UI hides the "manage in Stripe" button rather
  // than erroring. When a Stripe customer DOES exist we proxy to the existing
  // getStripeCustomerPortalUrl implementation.
  getCustomerPortalUrl: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);
      const stripeCustomerId = parsedOrg.cloudConfig?.stripe?.customerId;
      if (!stripeClient || !stripeCustomerId) {
        return null;
      }

      const portal = await stripeClient.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${env.NEXTAUTH_URL}/organization/${input.orgId}/settings/billing`,
      });
      return portal.url;
    }),

  // Stripe-only: clearing a scheduled plan switch. Commerce plans have no
  // schedules, so this is a no-op success rather than a 404.
  clearPlanSwitchSchedule: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });
      return { ok: true } as const;
    }),

  // Stripe-only: reactivating a cancelled subscription. Commerce plans are not
  // cancelled at period end, so this is a no-op success.
  reactivateStripeSubscription: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });
      return { ok: true } as const;
    }),

  // Stripe-only: applying a promotion code to a subscription. Without a Stripe
  // subscription there is nothing to discount; surface a clear, non-crashing
  // message instead of a 404.
  applyPromotionCode: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string(), code: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const parsedOrg = parseDbOrg(org);
      if (
        !stripeClient ||
        !parsedOrg.cloudConfig?.stripe?.activeSubscriptionId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Promotion codes require an active subscription. This organization is on a prepaid plan.",
        });
      }

      const promotionCodes = await stripeClient.promotionCodes.list({
        code: input.code,
        active: true,
        limit: 1,
      });
      const promo = promotionCodes.data[0];
      if (!promo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or inactive promotion code.",
        });
      }

      await stripeClient.subscriptions.update(
        parsedOrg.cloudConfig.stripe.activeSubscriptionId,
        { discounts: [{ promotion_code: promo.id }] },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: input.orgId,
        action: "applyPromotionCode",
      });

      return { ok: true } as const;
    }),

  // ── Commerce payment methods (Square) ──────────────────────────────────────
  // Hanzo bills through commerce (Square underneath). The console collects the
  // card client-side with the Square Web Payments SDK, which returns a single-
  // use nonce ("cnon:..."); we hand that nonce to commerce, which runs a $1
  // pre-auth and stores the card. The org slug (organization.name) is the
  // commerce customer id.
  listPaymentMethods: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }): Promise<CommercePaymentMethod[]> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const methods = await commerceGet<CommercePaymentMethod[]>(
        "/v1/billing/payment-methods",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        { user: organization.name },
      );
      return Array.isArray(methods) ? methods : [];
    }),

  addPaymentMethod: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        sourceId: z.string().min(1), // Square Web Payments SDK nonce
        cardBrand: z.string().optional(),
        last4: z.string().optional(),
        postalCode: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<CommercePaymentMethod> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const pm = await commercePost<CommercePaymentMethod>(
        "/v1/billing/payment-methods",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        {
          customerId: organization.name,
          type: "card",
          providerType: "square",
          providerRef: input.sourceId,
          ...(input.cardBrand || input.last4
            ? { card: { brand: input.cardBrand, last4: input.last4 } }
            : {}),
          ...(input.postalCode
            ? { billingAddress: { postalCode: input.postalCode } }
            : {}),
        },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: pm.id,
        action: "addPaymentMethod",
        after: { paymentMethodId: pm.id, type: pm.type },
      });

      return pm;
    }),

  removePaymentMethod: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string(), paymentMethodId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      await commerceDelete(
        `/v1/billing/payment-methods/${encodeURIComponent(input.paymentMethodId)}`,
        { iamSub: ctx.session.user.iamSub, org: organization.name },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: input.paymentMethodId,
        action: "removePaymentMethod",
      });

      return { ok: true } as const;
    }),

  // Set which saved card is charged for top-ups, auto-recharge, and renewals.
  // Commerce keys the default on the customer id (= org slug); it unsets any
  // prior default and marks this one IsDefault.
  setDefaultPaymentMethod: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string(), paymentMethodId: z.string().min(1) }))
    .mutation(async ({ input, ctx }): Promise<CommercePaymentMethod> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const pm = await commercePost<CommercePaymentMethod>(
        `/v1/billing/customers/${encodeURIComponent(organization.name)}/default-payment-method`,
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        { paymentMethodId: input.paymentMethodId },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: input.paymentMethodId,
        action: "setDefaultPaymentMethod",
        after: { paymentMethodId: input.paymentMethodId },
      });

      return pm;
    }),

  // ── Auto-recharge (prepaid credits auto-reload) ────────────────────────────
  // When the org's balance drops below the threshold, commerce charges the
  // default saved card by the configured amount (off-session, via a cron).
  getAutoRecharge: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }): Promise<CommerceAutoRecharge> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return commerceGet<CommerceAutoRecharge>(
        "/v1/billing/auto-recharge",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
      );
    }),

  setAutoRecharge: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        enabled: z.boolean(),
        thresholdUsd: z.number().min(0),
        amountUsd: z.number().min(0),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<CommerceAutoRecharge> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const cfg = await commercePut<CommerceAutoRecharge>(
        "/v1/billing/auto-recharge",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        {
          enabled: input.enabled,
          thresholdCents: Math.round(input.thresholdUsd * 100),
          amountCents: Math.round(input.amountUsd * 100),
          currency: "usd",
        },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: input.orgId,
        action: "setAutoRecharge",
        after: { enabled: input.enabled, amountCents: cfg.amountCents },
      });

      return cfg;
    }),

  // Public Square config for the Web Payments SDK — sandbox for test orgs,
  // production for live orgs (resolved by commerce from org.Live). The card
  // dialog uses this at runtime so the browser tokenizes against the same
  // Square account commerce vaults/charges with.
  getPaymentConfig: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }): Promise<CommercePaymentConfig> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return commerceGet<CommercePaymentConfig>(
        "/v1/billing/payment-config",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
      );
    }),

  // ── Buy credits (one-time Square top-up) ───────────────────────────────────
  // Charges a Square nonce and credits the org's prepaid balance. No saved card
  // required — the Web Payments SDK tokenizes the card for this single charge.
  buyCredits: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        sourceId: z.string().min(1), // Square Web Payments SDK nonce
        amountUsd: z.number().positive().max(100_000),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<CommerceTopupResult> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const amountCents = Math.round(input.amountUsd * 100);
      if (amountCents <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Top-up amount must be greater than zero.",
        });
      }

      const result = await commercePost<CommerceTopupResult>(
        "/v1/billing/topup/token",
        { iamSub: ctx.session.user.iamSub, org: organization.name },
        {
          sourceId: input.sourceId,
          amountCents,
          userId: organization.name,
          currency: "usd",
        },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: result.transactionId ?? input.orgId,
        action: "buyCredits",
        after: { amountCents, currency: "usd" },
      });

      return result;
    }),

  // ── Commerce plans + subscriptions ─────────────────────────────────────────
  // The real Hanzo plan catalog lives in commerce (GET /v1/billing/plans:
  // developer / pro / team …), priced in cents. Subscribing maps the org slug
  // to a commerce subscription via POST/PATCH /v1/billing/subscriptions.
  listPlans: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }): Promise<CommercePlan[]> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      if (plansCache && Date.now() - plansCache.at < PLANS_CACHE_TTL_MS) {
        return plansCache.plans;
      }
      try {
        const raw = await withTimeout(
          commerceGet<CommercePlan[]>("/v1/billing/plans", {
            iamSub: ctx.session.user.iamSub,
            org: organization.name,
          }),
          "commerce /plans",
        );
        const plans = (Array.isArray(raw) ? raw : []).filter(isCorePlan);
        if (plans.length) {
          plansCache = { at: Date.now(), plans };
          return plans;
        }
        return plansCache?.plans ?? FALLBACK_PLANS;
      } catch {
        // Slow/unreachable commerce → serve stale cache or a static catalog
        // rather than hanging the dialog.
        return plansCache?.plans ?? FALLBACK_PLANS;
      }
    }),

  getActiveSubscription: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }): Promise<CommerceSubscription | null> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      try {
        const res = await withTimeout(
          commerceGet<{
            subscriptions: CommerceSubscription[];
            count: number;
          }>(
            "/v1/billing/subscriptions",
            { iamSub: ctx.session.user.iamSub, org: organization.name },
            { userId: organization.name },
          ),
          "commerce /subscriptions",
        );
        const subs = res.subscriptions ?? [];
        return (
          subs.find((s) => ACTIVE_SUB_STATUSES.includes(s.status)) ??
          subs[0] ??
          null
        );
      } catch {
        // Slow/unreachable → no current-plan marking; the dialog still works.
        return null;
      }
    }),

  subscribeToPlan: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string(), planSlug: z.string().min(1) }))
    .mutation(async ({ input, ctx }): Promise<CommerceSubscription> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const caller: CommerceCaller = {
        iamSub: ctx.session.user.iamSub,
        org: organization.name,
      };

      let existing: CommerceSubscription | undefined;
      try {
        const list = await withTimeout(
          commerceGet<{ subscriptions: CommerceSubscription[] }>(
            "/v1/billing/subscriptions",
            caller,
            { userId: organization.name },
          ),
          "commerce /subscriptions",
        );
        existing = (list.subscriptions ?? []).find((s) =>
          ACTIVE_SUB_STATUSES.includes(s.status),
        );
      } catch {
        existing = undefined; // couldn't determine → create a new subscription
      }

      const sub = existing
        ? await commercePatch<CommerceSubscription>(
            `/v1/billing/subscriptions/${encodeURIComponent(existing.id)}`,
            caller,
            { planId: input.planSlug, prorate: true },
          )
        : await commercePost<CommerceSubscription>(
            "/v1/billing/subscriptions",
            caller,
            { userId: organization.name, planId: input.planSlug },
          );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: sub.id,
        action: existing ? "changePlan" : "subscribe",
        after: { planId: input.planSlug, subscriptionId: sub.id },
      });

      return sub;
    }),

  cancelSubscription: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        atPeriodEnd: z.boolean().optional().default(true),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<CommerceSubscription | null> => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "hanzoCloudBilling:CRUD",
        session: ctx.session,
      });

      const organization = await ctx.prisma.organization.findUnique({
        where: { id: input.orgId },
      });
      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const caller: CommerceCaller = {
        iamSub: ctx.session.user.iamSub,
        org: organization.name,
      };

      let active: CommerceSubscription | undefined;
      try {
        const list = await withTimeout(
          commerceGet<{ subscriptions: CommerceSubscription[] }>(
            "/v1/billing/subscriptions",
            caller,
            { userId: organization.name },
          ),
          "commerce /subscriptions",
        );
        active = (list.subscriptions ?? []).find((s) =>
          ACTIVE_SUB_STATUSES.includes(s.status),
        );
      } catch {
        active = undefined;
      }
      if (!active) return null;

      const sub = await commercePost<CommerceSubscription>(
        `/v1/billing/subscriptions/${encodeURIComponent(active.id)}/cancel`,
        caller,
        { atPeriodEnd: input.atPeriodEnd },
      );

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: active.id,
        action: "cancelSubscription",
        after: { atPeriodEnd: input.atPeriodEnd },
      });

      return sub;
    }),
});
