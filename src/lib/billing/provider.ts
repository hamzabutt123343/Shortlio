/**
 * Provider-independent billing interface.
 * Default implementation: Lemon Squeezy (widely available internationally).
 * Swap BILLING_PROVIDER env to change adapters without rewriting app logic.
 */

export type BillingProviderName = "lemon_squeezy" | "stripe";

export interface CheckoutParams {
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
}

export interface PortalParams {
  userId: string;
  returnUrl: string;
}

export interface BillingProvider {
  name: BillingProviderName;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  createPortal?(params: PortalParams): Promise<{ url: string }>;
  verifyWebhook(rawBody: string, signature: string | null): Promise<unknown>;
  normalizeEvent(payload: unknown): NormalizedBillingEvent | null;
}

export type NormalizedBillingEvent =
  | {
      type: "subscription_created" | "subscription_updated" | "subscription_cancelled" | "subscription_expired" | "payment_failed";
      eventId: string;
      userId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      status: string;
      plan: "free" | "pro";
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
      raw: unknown;
    };

export function getBillingProviderName(): BillingProviderName {
  const name = (process.env.BILLING_PROVIDER || "lemon_squeezy").toLowerCase();
  if (name === "stripe") return "stripe";
  return "lemon_squeezy";
}
