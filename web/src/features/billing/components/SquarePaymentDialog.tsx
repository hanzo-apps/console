import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { env } from "@/src/env.mjs";
import { api } from "@/src/utils/api";
import { toast } from "sonner";

// Minimal typings for the Square Web Payments SDK global (loaded from CDN).
type SquareTokenResult = {
  status: string;
  token?: string;
  errors?: { message: string }[];
  details?: { card?: { brand?: string; last4?: string } };
};
type SquareCard = {
  attach: (el: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<SquareTokenResult>;
  destroy?: () => Promise<void> | void;
};
type SquarePayments = { card: (options?: unknown) => Promise<SquareCard> };
type SquareGlobal = {
  payments: (appId: string, locationId: string) => SquarePayments;
};

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

function squareSdkSrc(environment: string): string {
  return environment === "sandbox"
    ? "https://sandbox.web.squarecdn.com/v1/square.js"
    : "https://web.squarecdn.com/v1/square.js";
}

// Load the Square Web Payments SDK for the given environment. The script id is
// environment-scoped so a sandbox (test org) and production SDK never collide.
function loadSquareSdk(environment: string): Promise<SquareGlobal> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Square SDK can only load in the browser"));
      return;
    }
    if (window.Square) {
      resolve(window.Square);
      return;
    }
    const done = () =>
      window.Square
        ? resolve(window.Square)
        : reject(new Error("Square SDK failed to load"));
    const scriptId = `square-web-payments-sdk-${environment}`;
    const existing = document.getElementById(
      scriptId,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () =>
        reject(new Error("Square SDK failed to load")),
      );
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = squareSdkSrc(environment);
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error("Square SDK failed to load"));
    document.body.appendChild(script);
  });
}

// The Square Web Payments SDK only accepts 6-digit hex colors (no hsl(), and
// no backgroundColor property — the field is transparent). Convert a CSS
// custom-property HSL triplet (e.g. "222 47% 5%") to #rrggbb.
function hslTripletToHex(raw: string, fallback: string): string {
  const m = raw.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return fallback;
  const h = parseFloat(m[1]);
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mBase = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + mBase) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

type Mode = "add-card" | "buy-credits";

export function SquarePaymentDialog({
  open,
  onOpenChange,
  orgId,
  mode,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  mode: Mode;
  onSuccess?: () => void;
}) {
  const cardRef = useRef<SquareCard | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("25");

  // Resolve the Square config for THIS org at runtime: a test org gets the
  // sandbox app id/location, a live org gets production. Falls back to the
  // build-time NEXT_PUBLIC_* values if the endpoint is unavailable. We gate the
  // card-field mount on the config being fetched so the SDK loads exactly one
  // environment (no prod-then-sandbox double load).
  const paymentConfigQuery = api.cloudBilling.getPaymentConfig.useQuery(
    { orgId },
    { enabled: open && !!orgId },
  );
  const cfg = paymentConfigQuery.data;
  const appId = cfg?.applicationId || env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
  const locationId = cfg?.locationId || env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  const environment =
    cfg?.environment || env.NEXT_PUBLIC_SQUARE_ENVIRONMENT || "production";
  const configured = Boolean(appId && locationId);
  const configResolved = !orgId || paymentConfigQuery.isFetched;

  const addPaymentMethod = api.cloudBilling.addPaymentMethod.useMutation();
  const buyCredits = api.cloudBilling.buyCredits.useMutation();

  // Mount the Square-hosted card field (a cross-origin iframe) when opened.
  useEffect(() => {
    if (!open || !configured || !configResolved) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        const sq = await loadSquareSdk(environment);
        if (cancelled) return;
        const payments = sq.payments(appId as string, locationId as string);
        // Match the Square card field to the app theme: resolve the same CSS
        // variables the <Input> uses and convert to hex (Square rejects hsl()).
        // The field is transparent (no backgroundColor support), so the dark
        // bg-background container behind it provides the surface.
        const cs = getComputedStyle(document.documentElement);
        const hex = (name: string, fallback: string) =>
          hslTripletToHex(cs.getPropertyValue(name), fallback);
        const fg = hex("--foreground", "#fafafa");
        const muted = hex("--muted-foreground", "#a1a1aa");
        const inputBorder = hex("--input", "#3f3f46");
        const ring = hex("--ring", "#71717a");
        const destructive = hex("--destructive", "#ef4444");
        const card = await payments.card({
          style: {
            input: { fontSize: "16px", color: fg },
            "input::placeholder": { color: muted },
            ".input-container": {
              borderColor: inputBorder,
              borderRadius: "6px",
            },
            ".input-container.is-focus": { borderColor: ring },
            ".input-container.is-error": { borderColor: destructive },
            ".message-text": { color: destructive },
            ".message-icon": { color: destructive },
          },
        });
        if (cancelled) {
          await card.destroy?.();
          return;
        }
        await card.attach("#sq-card-container");
        cardRef.current = card;
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Failed to load the card form",
          );
      }
    })();
    return () => {
      cancelled = true;
      void cardRef.current?.destroy?.();
      cardRef.current = null;
    };
  }, [open, configured, configResolved, environment, appId, locationId]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const card = cardRef.current;
    if (!card) return;

    const usd = Number(amount);
    if (mode === "buy-credits" && (!Number.isFinite(usd) || usd <= 0)) {
      setError("Enter a valid amount.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await card.tokenize();
      if (result.status !== "OK" || !result.token) {
        setError(result.errors?.[0]?.message ?? "Card could not be verified.");
        return;
      }
      const sourceId = result.token;
      if (mode === "add-card") {
        await addPaymentMethod.mutateAsync({
          orgId,
          sourceId,
          cardBrand: result.details?.card?.brand,
          last4: result.details?.card?.last4,
        });
        toast.success("Payment method added");
      } else {
        await buyCredits.mutateAsync({ orgId, sourceId, amountUsd: usd });
        toast.success(`Added $${usd.toFixed(2)} in credits`);
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payment failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    mode,
    amount,
    orgId,
    addPaymentMethod,
    buyCredits,
    onOpenChange,
    onSuccess,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "add-card" ? "Add payment method" : "Add credits"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add-card"
              ? "Your card is tokenized securely by Square. We run a $1 authorization to verify it, then store it for future charges."
              : "Charge a card to top up your prepaid credit balance."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {!configured ? (
            <p className="text-destructive text-sm">
              Card payments are not configured for this deployment.
            </p>
          ) : (
            <div className="space-y-4">
              {mode === "buy-credits" && (
                <div className="space-y-2">
                  <Label htmlFor="sq-amount">Amount (USD)</Label>
                  <Input
                    id="sq-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Card details</Label>
                <div className="border-input bg-background rounded-md border p-3">
                  <div id="sq-card-container" className="min-h-[44px]" />
                </div>
                {!ready && !error && (
                  <p className="text-muted-foreground text-xs">
                    Loading secure card form…
                  </p>
                )}
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!ready || submitting || !configured}
          >
            {submitting
              ? "Processing…"
              : mode === "add-card"
                ? "Add card"
                : `Pay $${(Number(amount) || 0).toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
