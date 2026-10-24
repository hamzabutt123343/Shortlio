"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button, Card } from "@/components/ui";
import type { UsageInfo } from "@/lib/types";

export default function BillingPage() {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [subscription, setSubscription] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/billing/status");
    if (!res.ok) {
      setReady(true);
      return;
    }
    const data = await res.json();
    setUsage(data.usage);
    setSubscription(data.subscription);
    setReady(true);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setLoading(false);
    }
  }

  async function portal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Portal unavailable");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal failed");
      setLoading(false);
    }
  }

  return (
    <AppShell planLabel={usage?.plan === "pro" ? "Pro" : "Free"} title="Billing">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
          Billing
        </h1>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Current plan</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold capitalize">
            {!ready ? "…" : (usage?.plan ?? "free")}
          </p>
          {usage?.plan === "free" && (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {usage.remaining}/{usage.limit} clips remaining today (UTC reset{" "}
              {usage.resetAt ? new Date(usage.resetAt).toUTCString() : "—"}).
            </p>
          )}
          {usage?.plan === "pro" && (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Unlimited clip generation subject to fair-use and infrastructure capacity.
              {subscription?.current_period_end
                ? ` Renews/ends ${new Date(String(subscription.current_period_end)).toUTCString()}.`
                : ""}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            {usage?.plan !== "pro" ? (
              <Button onClick={checkout} disabled={loading || !ready}>
                {loading ? "Redirecting…" : "Upgrade to Pro — $10/mo"}
              </Button>
            ) : (
              <Button variant="secondary" onClick={portal} disabled={loading}>
                Manage subscription
              </Button>
            )}
          </div>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Billing uses the provider configured in BILLING_PROVIDER (Lemon Squeezy by default, Stripe
            optional). Card details are never stored by Shortlio. Use test mode keys during development.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
