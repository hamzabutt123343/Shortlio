import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Pricing — Shortlio",
  description:
    "Free plan with 3 clips per day. Pro at $10/mo for unlimited clip generation under fair-use capacity.",
};

export default async function PricingPage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader authed={Boolean(user)} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight">
          Pricing
        </h1>
        <p className="mt-3 max-w-xl text-[var(--text-muted)]">
          Start free with a daily clip allowance. Upgrade to Pro when you need unlimited generation
          under fair-use capacity.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)]/70 p-7">
            <p className="text-sm text-[var(--text-muted)]">Free</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">$0</p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-muted)]">
              <li>3 successful clips per UTC day</li>
              <li>Public URL imports</li>
              <li>Caption presets & smart reframing</li>
              <li>Server-enforced daily quota</li>
            </ul>
            <Link href={user ? "/dashboard" : "/signup"} className="mt-8 block">
              <Button variant="secondary" className="w-full">
                Use Free
              </Button>
            </Link>
          </div>
          <div className="rounded-[14px] border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-7">
            <p className="text-sm text-[var(--accent)]">Pro</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">
              $10<span className="text-lg font-medium text-[var(--text-muted)]">/mo</span>
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-muted)]">
              <li>Unlimited clips (fair use / capacity)</li>
              <li>No daily clip counter</li>
              <li>Priority worker capacity when available</li>
              <li>Full export & caption controls</li>
            </ul>
            <Link href={user ? "/billing" : "/signup"} className="mt-8 block">
              <Button className="w-full">Go Pro</Button>
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
