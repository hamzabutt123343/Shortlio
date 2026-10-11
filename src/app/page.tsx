import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export default async function HomePage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader authed={Boolean(user)} />
      <section className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 pb-16 pt-10 md:pt-16">
        <div className="animate-fade-up grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-4 font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight md:text-7xl">
              Shortlio
            </p>
            <h1 className="max-w-xl text-2xl font-semibold leading-snug text-[var(--text)] md:text-3xl">
              Long videos become scroll-stopping shorts.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--text-muted)]">
              Paste a public URL. We fetch the transcript first, find viral-worthy moments,
              reframe to the speaker, burn animated captions, and export for Shorts, TikTok, and Reels.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={user ? "/dashboard" : "/signup"}>
                <Button className="min-w-[140px]">Start clipping</Button>
              </Link>
              <Link href="/pricing">
                <Button variant="secondary">View pricing</Button>
              </Link>
            </div>
          </div>
          <div className="relative aspect-[9/14] max-h-[520px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="absolute inset-0 bg-[linear-gradient(160deg,#1a1f2a_0%,#0e1015_55%,#152019_100%)]" />
            <div className="absolute inset-x-6 top-8 bottom-8 rounded-[14px] border border-white/10 bg-black/40 p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>Preview · 9:16</span>
                <span className="text-[var(--accent)]">Speaker tracked</span>
              </div>
              <div className="relative h-[70%] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_45%_35%,#3a4658,transparent_55%),linear-gradient(#12151c,#0a0c10)]">
                <div className="absolute left-[28%] top-[18%] h-28 w-20 rounded-full bg-[radial-gradient(circle_at_40%_30%,#d7c4b0,#6b5548)] opacity-90 blur-[0.5px]" />
                <div className="absolute bottom-6 left-4 right-4 text-center">
                  <p className="text-lg font-bold leading-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                    <span className="text-[var(--accent)]">This</span> is the moment
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="h-1.5 rounded-full bg-white/10">
                  <div className="h-full w-2/3 rounded-full bg-[var(--accent)]" />
                </div>
                <p className="text-xs text-[var(--text-muted)]">Rendering captions · Karaoke Highlight</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-[var(--border)] bg-[var(--bg-elevated)]/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-3">
          {[
            {
              title: "Transcript first",
              body: "Pull captions or audio-only streams before downloading full video. Faster and cheaper.",
            },
            {
              title: "Smart reframing",
              body: "OpenCV tracking keeps the speaker in frame for vertical, square, or landscape exports.",
            },
            {
              title: "Free-first AI",
              body: "Local faster-whisper and heuristic scoring by default. Optional free-tier cloud models.",
            },
          ].map((item, i) => (
            <div key={item.title} className="animate-fade-up" style={{ animationDelay: `${i * 80}ms` }}>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-[var(--border)] py-8 text-center text-xs text-[var(--text-muted)]">
        © {new Date().getFullYear()} Shortlio. Process only content you have rights to use.
      </footer>
    </div>
  );
}
