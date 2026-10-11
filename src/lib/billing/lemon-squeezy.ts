import { createHmac, timingSafeEqual } from "crypto";
import type {
  BillingProvider,
  CheckoutParams,
  CheckoutResult,
  NormalizedBillingEvent,
} from "@/lib/billing/provider";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export function createLemonSqueezyProvider(): BillingProvider {
  return {
    name: "lemon_squeezy",

    async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
      const apiKey = requireEnv("LEMON_SQUEEZY_API_KEY");
      const storeId = requireEnv("LEMON_SQUEEZY_STORE_ID");
      const variantId = requireEnv("LEMON_SQUEEZY_VARIANT_ID");

      const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
        method: "POST",
        headers: {
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              checkout_data: {
                email: params.email,
                custom: { user_id: params.userId },
              },
              product_options: {
                redirect_url: params.successUrl,
              },
            },
            relationships: {
              store: { data: { type: "stores", id: storeId } },
              variant: { data: { type: "variants", id: variantId } },
            },
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Lemon Squeezy checkout failed: ${text}`);
      }

      const json = (await res.json()) as {
        data?: { attributes?: { url?: string } };
      };
      const url = json.data?.attributes?.url;
      if (!url) throw new Error("Lemon Squeezy checkout URL missing");
      return { url };
    },

    async verifyWebhook(rawBody: string, signature: string | null): Promise<unknown> {
      const secret = requireEnv("LEMON_SQUEEZY_WEBHOOK_SECRET");
      if (!signature) throw new Error("Missing webhook signature");
      const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(digest);
      const b = Buffer.from(signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error("Invalid webhook signature");
      }
      return JSON.parse(rawBody) as unknown;
    },

    normalizeEvent(payload: unknown): NormalizedBillingEvent | null {
      const body = payload as {
        meta?: {
          event_name?: string;
          custom_data?: { user_id?: string };
        };
        data?: {
          id?: string;
          attributes?: {
            status?: string;
            customer_id?: number | string;
            renews_at?: string | null;
            ends_at?: string | null;
            cancelled?: boolean;
            first_subscription_item?: { variant_id?: number };
          };
        };
      };

      const eventName = body.meta?.event_name;
      if (!eventName) return null;

      const map: Record<string, NormalizedBillingEvent["type"] | undefined> = {
        subscription_created: "subscription_created",
        subscription_updated: "subscription_updated",
        subscription_cancelled: "subscription_cancelled",
        subscription_expired: "subscription_expired",
        subscription_payment_failed: "payment_failed",
      };
      const type = map[eventName];
      if (!type) return null;

      const statusRaw = body.data?.attributes?.status ?? "inactive";
      const active =
        statusRaw === "active" || statusRaw === "on_trial" || statusRaw === "paused";
      const plan = active && type !== "subscription_expired" ? "pro" : "free";

      return {
        type,
        eventId: `${eventName}:${body.data?.id ?? "unknown"}:${body.data?.attributes?.renews_at ?? ""}`,
        userId: body.meta?.custom_data?.user_id ?? null,
        customerId: body.data?.attributes?.customer_id
          ? String(body.data.attributes.customer_id)
          : null,
        subscriptionId: body.data?.id ? String(body.data.id) : null,
        status: statusRaw,
        plan: type === "payment_failed" ? "pro" : plan,
        currentPeriodEnd: body.data?.attributes?.renews_at ?? body.data?.attributes?.ends_at ?? null,
        cancelAtPeriodEnd: Boolean(body.data?.attributes?.cancelled),
        raw: payload,
      };
    },
  };
}
