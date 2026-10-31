import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { DISCORD_INVITE_URL, PLAN_COPY } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing — Shortlio",
  description:
    "Basic is free. Pro is Rs 500 lifetime via Discord. The fastest clipping software for Shorts, TikTok, and Reels.",
};

export default async function PricingPage() {
  const user = await getSessionUser();
  const { free, pro } = PLAN_COPY;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader authed={Boolean(user)} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight">
          Pricing
        </h1>
        <p className="mt-3 max-w-xl text-[var(--text-muted)]">
          Basic is free. Pro is a one-time Rs 500 lifetime unlock — purchases are handled on Discord.
          Built to be the fastest clipping software from URL to export.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)]/70 p-7">
            <p className="text-sm text-[var(--text-muted)]">{free.name}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">
              {free.priceLabel}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{free.blurb}</p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-muted)]">
              {free.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link href={user ? "/dashboard" : "/signup"} className="mt-8 block">
              <Button variant="secondary" className="w-full">
                Start free
              </Button>
            </Link>
          </div>
          <div className="rounded-[14px] border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-7">
            <p className="text-sm text-[var(--accent)]">{pro.name}</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">
              {pro.priceLabel}
              <span className="text-lg font-medium text-[var(--text-muted)]">
                {" "}
                / {pro.priceDetail}
              </span>
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{pro.blurb}</p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-muted)]">
              {pro.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 block"
            >
              <Button className="w-full">Buy Pro on Discord</Button>
            </a>
          </div>
        </div>
        <p className="mt-8 max-w-2xl text-sm text-[var(--text-muted)]">
          After payment on Discord, Pro is activated on your Shortlio account. Questions? Join{" "}
          <a
            href={DISCORD_INVITE_URL}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            discord.gg/yaWrgpnya5
          </a>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
