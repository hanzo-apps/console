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

const SQUARE_SDK_SRC =
  env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "sandbox"
    ? "https://sandbox.web.squarecdn.com/v1/square.js"
    : "https://web.squarecdn.com/v1/square.js";

function loadSquareSdk(): Promise<SquareGlobal> {
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
    const existing = document.getElementById(
      "square-web-payments-sdk",
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () =>
        reject(new Error("Square SDK failed to load")),
      );
      return;
    }
    const script = document.createElement("script");
    script.id = "square-web-payments-sdk";
    script.src = SQUARE_SDK_SRC;
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error("Square SDK failed to load"));
    document.body.appendChild(script);
  });
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

  const appId = env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
  const locationId = env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  const configured = Boolean(appId && locationId);

  const addPaymentMethod = api.cloudBilling.addPaymentMethod.useMutation();
  const buyCredits = api.cloudBilling.buyCredits.useMutation();

  // Mount the Square-hosted card field (a cross-origin iframe) when opened.
  useEffect(() => {
    if (!open || !configured) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        const sq = await loadSquareSdk();
        if (cancelled) return;
        const payments = sq.payments(appId as string, locationId as string);
        // Match the Square card field to the app theme by resolving the same
        // CSS variables the <Input> component uses (HSL triplets → hsl()).
        const cs = getComputedStyle(document.documentElement);
        const themeColor = (name: string, fallback: string) => {
          const v = cs.getPropertyValue(name).trim();
          return v ? `hsl(${v.replace(/\s+/g, ", ")})` : fallback;
        };
        const bg = themeColor("--background", "#0a0a0a");
        const fg = themeColor("--foreground", "#fafafa");
        const muted = themeColor("--muted-foreground", "#a1a1aa");
        const inputBorder = themeColor("--input", "#3f3f46");
        const ring = themeColor("--ring", "#71717a");
        const destructive = themeColor("--destructive", "#ef4444");
        const card = await payments.card({
          style: {
            input: { fontSize: "16px", color: fg, backgroundColor: bg },
            "input::placeholder": { color: muted },
            ".input-container": {
              borderColor: inputBorder,
              borderRadius: "6px",
              backgroundColor: bg,
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
  }, [open, configured, appId, locationId]);

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
