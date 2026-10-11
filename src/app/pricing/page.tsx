import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Button, Card } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export default async function PricingPage() {
  const user = await getSessionUser();

  return (
    <div>
      <SiteHeader authed={Boolean(user)} />
      <main className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold">Pricing</h1>
        <p className="mt-3 max-w-xl text-[var(--text-muted)]">
          Start free with a daily clip allowance. Upgrade to Pro when you need unlimited generation
          under fair-use capacity.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Card>
            <p className="text-sm text-[var(--text-muted)]">Free</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">$0</p>
            <ul className="mt-6 space-y-2 text-sm text-[var(--text-muted)]">
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
          </Card>
          <Card className="border-[var(--accent)]/40 bg-[var(--accent-dim)]">
            <p className="text-sm text-[var(--accent)]">Pro</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">
              $10<span className="text-lg font-medium text-[var(--text-muted)]">/mo</span>
            </p>
            <ul className="mt-6 space-y-2 text-sm text-[var(--text-muted)]">
              <li>Unlimited clips (fair use / capacity)</li>
              <li>No daily clip counter</li>
              <li>Priority worker capacity when available</li>
              <li>Full export & caption controls</li>
            </ul>
            <Link href={user ? "/billing" : "/signup"} className="mt-8 block">
              <Button className="w-full">Go Pro</Button>
            </Link>
          </Card>
        </div>
      </main>
    </div>
  );
}
