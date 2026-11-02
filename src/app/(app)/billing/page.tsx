"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { DISCORD_INVITE_URL, PLAN_COPY } from "@/lib/pricing";
import type { UsageInfo } from "@/lib/types";

export default function BillingPage() {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/billing/status");
    if (!res.ok) {
      setReady(true);
      return;
    }
    const data = await res.json();
    setUsage(data.usage);
    setReady(true);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  const free = PLAN_COPY.free;
  const pro = PLAN_COPY.pro;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
        Billing
      </h1>
      <Card>
        <p className="text-sm text-[var(--text-muted)]">Current plan</p>
        <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold">
          {!ready ? "…" : usage?.plan === "pro" ? "Pro" : "Basic (Free)"}
        </p>
        {usage?.plan === "free" && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {usage.remaining}/{usage.limit} clips remaining today (UTC reset{" "}
            {usage.resetAt ? new Date(usage.resetAt).toUTCString() : "—"}).
          </p>
        )}
        {usage?.plan === "pro" && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Lifetime Pro — unlimited clip generation subject to fair-use and capacity.
          </p>
        )}

        {usage?.plan !== "pro" && (
          <div className="mt-6 space-y-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg)]/50 p-4">
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
              Upgrade to {pro.name} — {pro.priceLabel} {pro.priceDetail}
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              Purchases are handled on Discord. Join the server, request Pro, and we activate your
              account after payment.
            </p>
            <ul className="space-y-1.5 text-sm text-[var(--text-muted)]">
              {pro.features.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
              <Button className="mt-2">Buy Pro on Discord</Button>
            </a>
          </div>
        )}

        <p className="mt-6 text-xs text-[var(--text-muted)]">
          {free.name} stays free forever with a daily clip limit. Pro is a one-time Rs 500 lifetime
          purchase via{" "}
          <a
            href={DISCORD_INVITE_URL}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Discord
          </a>
          — no card stored in Shortlio.
        </p>
      </Card>
    </div>
  );
}
