import Link from "next/link";
import type { Metadata } from "next";
import {
  Captions,
  Languages,
  ScanFace,
  Scissors,
  Share2,
  SplitSquareVertical,
} from "lucide-react";
import { ProductPreview } from "@/components/product-preview";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { DISCORD_INVITE_URL, PLAN_COPY } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Shortlio — Fastest AI clipping for viral shorts",
  description:
    "The fastest clipping software: AI clip detection, face-aware reframing, animated captions. Basic free · Pro Rs 500 lifetime via Discord.",
  openGraph: {
    title: "Shortlio — Fastest long-form to short-form clips",
    description:
      "Paste a public URL. Shortlio finds the moments, reframes the speaker, burns captions, and exports vertical clips — fast.",
    type: "website",
  },
};

const FEATURES = [
  {
    icon: Scissors,
    title: "AI clip detection",
    body: "Transcript-first analysis finds hooks, punchlines, and shareable moments before downloading full video.",
  },
  {
    icon: ScanFace,
    title: "Face-aware reframing",
    body: "Keep speakers framed for 9:16, 1:1, or 16:9 with smart cuts and single-subject tracking.",
  },
  {
    icon: SplitSquareVertical,
    title: "Reaction layouts",
    body: "Split Stack and Reaction Stack put creator and content in separate panels with independent framing.",
  },
  {
    icon: Captions,
    title: "Caption presets",
    body: "Animated styles from clean minimal to Hormozi and karaoke — preview live, burn into the export.",
  },
  {
    icon: Languages,
    title: "Multilingual captions",
    body: "English, Hindi, Urdu, Arabic, and Hinglish romanization so your captions match the audience.",
  },
  {
    icon: Share2,
    title: "Platform exports",
    body: "Presets for YouTube Shorts, TikTok, and Instagram Reels with the aspect ratio each platform expects.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Paste a public URL",
    body: "Drop in a YouTube (or supported) link. We pull the transcript first to stay fast and efficient.",
  },
  {
    step: "02",
    title: "Pick moments & style",
    body: "Review AI candidates, choose caption presets, framing mode, language, and aspect ratio.",
  },
  {
    step: "03",
    title: "Export & publish",
    body: "Render vertical clips with burned captions, download, and post to Shorts, TikTok, or Reels.",
  },
];

const FAQS = [
  {
    q: "What can I import?",
    a: "Public YouTube, Twitch, and Kick VODs/clips (and Live snapshot for active streams), plus other yt-dlp sources on the allowlist. Only process content you have rights to use.",
  },
  {
    q: "How does Basic (free) work?",
    a: "Basic is free: 3 successful clips per UTC day with caption presets and smart reframing. Quotas are enforced on the server.",
  },
  {
    q: "How do I get Pro?",
    a: "Pro is Rs 500 lifetime. Join Discord to purchase — we activate unlimited clips (fair use) on your account after payment.",
  },
  {
    q: "Do captions support Hinglish?",
    a: "Yes. Choose Hinglish (and other languages) in caption settings so spoken mixed language can be romanized for on-screen text.",
  },
];

export default async function HomePage() {
  const user = await getSessionUser();
  const ctaHref = user ? "/dashboard" : "/signup";

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader authed={Boolean(user)} />

      {/* Hero — brand + one headline + one sentence + CTAs + product preview */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_15%,rgba(255,92,57,0.1),transparent_52%)]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-12 px-4 py-14 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:py-12">
          <div className="animate-fade-up">
            <p className="font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-[var(--text)] md:text-7xl">
              Shortlio
            </p>
            <h1 className="mt-5 max-w-xl text-2xl font-semibold leading-snug tracking-tight text-[var(--text)] md:text-4xl">
              The fastest clipping software for viral-ready shorts.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--text-muted)] md:text-lg">
              Paste a URL. Shortlio finds the moments, reframes the speaker, burns animated captions,
              and exports for Shorts, TikTok, and Reels — built for speed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={ctaHref}>
                <Button className="min-w-[150px] px-6 py-3">{user ? "Open dashboard" : "Get Started"}</Button>
              </Link>
              <Link href="/download">
                <Button variant="secondary" className="px-6 py-3">
                  Download for Windows
                </Button>
              </Link>
            </div>
          </div>
          <div
            className="animate-fade-up flex justify-center pb-10 lg:justify-end lg:pb-6"
            style={{ animationDelay: "80ms" }}
          >
            <ProductPreview className="w-full" />
          </div>
        </div>
      </section>

      <section id="features" className="marketing-section">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight md:text-4xl">
            Built for creators who ship clips daily
          </h2>
          <p className="mt-3 max-w-2xl text-[var(--text-muted)]">
            Everything you need between a long recording and a publish-ready short — without
            inventing features we don’t ship.
          </p>
          <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title}>
                  <div className="mb-3 inline-flex rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[var(--accent)]">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="how" className="marketing-section bg-[var(--bg-elevated)]/35">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight md:text-4xl">
            How it works
          </h2>
          <p className="mt-3 max-w-xl text-[var(--text-muted)]">
            Three steps from public URL to downloadable short.
          </p>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.step}>
                <p className="font-[family-name:var(--font-display)] text-sm font-bold text-[var(--accent)]">
                  {s.step}
                </p>
                <h3 className="mt-2 font-[family-name:var(--font-display)] text-xl font-semibold">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="marketing-section">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight md:text-4xl">
            Simple pricing
          </h2>
          <p className="mt-3 max-w-xl text-[var(--text-muted)]">
            Basic is free. Pro is Rs 500 lifetime — buy on Discord. Same stack either way: built to
            be the fastest clipping software.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)]/60 p-7">
              <p className="text-sm text-[var(--text-muted)]">{PLAN_COPY.free.name}</p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">
                {PLAN_COPY.free.priceLabel}
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-muted)]">
                {PLAN_COPY.free.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link href={user ? "/dashboard" : "/signup"} className="mt-8 block">
                <Button variant="secondary" className="w-full">
                  Start free
                </Button>
              </Link>
            </div>
            <div className="rounded-[14px] border border-[var(--accent)]/35 bg-[var(--accent-dim)] p-7">
              <p className="text-sm text-[var(--accent)]">{PLAN_COPY.pro.name}</p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">
                {PLAN_COPY.pro.priceLabel}
                <span className="text-lg font-medium text-[var(--text-muted)]">
                  {" "}
                  / {PLAN_COPY.pro.priceDetail}
                </span>
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[var(--text-muted)]">
                {PLAN_COPY.pro.features.map((f) => (
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
          <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
            <Link href="/pricing" className="text-[var(--accent)] hover:underline">
              Full pricing details
            </Link>
            {" · "}
            <a
              href={DISCORD_INVITE_URL}
              className="text-[var(--accent)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord
            </a>
          </p>
        </div>
      </section>

      <section id="faq" className="marketing-section bg-[var(--bg-elevated)]/35">
        <div className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            FAQ
          </h2>
          <dl className="mt-10 space-y-8">
            {FAQS.map((item) => (
              <div key={item.q}>
                <dt className="font-semibold text-[var(--text)]">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="marketing-section">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight md:text-4xl">
            Ready to clip smarter?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-[var(--text-muted)]">
            Create your account and turn the next long video into shorts built for the feed.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={ctaHref}>
              <Button className="min-w-[160px] px-6 py-3">
                {user ? "Go to dashboard" : "Get Started free"}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
