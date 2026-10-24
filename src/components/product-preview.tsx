/** Marketing hero preview — polished workspace + vertical export mock. */

const CLIPS = [
  {
    title: "Opening hook",
    time: "0:12 – 0:41",
    score: "94",
    thumb: "/marketing/preview-thumb-1.jpg",
  },
  {
    title: "Key insight",
    time: "4:02 – 4:38",
    score: "91",
    thumb: "/marketing/preview-thumb-2.jpg",
  },
  {
    title: "Call to action",
    time: "11:20 – 11:52",
    score: "88",
    thumb: "/marketing/preview-thumb-3.jpg",
  },
] as const;

export function ProductPreview({ className = "" }: { className?: string }) {
  return (
    <div className={`relative mx-auto w-full max-w-[440px] ${className}`}>
      {/* Back: editor chrome */}
      <div className="relative rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]/80" />
          <span className="h-2 w-2 rounded-full bg-[#febc2e]/80" />
          <span className="h-2 w-2 rounded-full bg-[#28c840]/80" />
          <span className="ml-2 truncate text-[11px] text-[var(--text-muted)]">
            shortlio.app / create
          </span>
        </div>

        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Source</p>
          <p className="mt-1 truncate text-xs text-[var(--text)]">
            youtube.com/watch?v=IShowSpeed…
          </p>
        </div>

        <div className="mt-3 space-y-2">
          {CLIPS.map((clip, i) => (
            <div
              key={clip.title}
              className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
              style={{ opacity: 1 - i * 0.08 }}
            >
              <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded-md bg-[var(--bg)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={clip.thumb}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[var(--text)]">{clip.title}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{clip.time}</p>
              </div>
              <span className="text-[10px] font-semibold tabular-nums text-[var(--accent)]">
                {clip.score}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Front: vertical export phone */}
      <div className="absolute -bottom-6 -right-1 w-[46%] max-w-[190px] sm:-right-3 sm:bottom-[-18px]">
        <div className="overflow-hidden rounded-[18px] border border-[var(--border-strong)] bg-[#0c0c0e] shadow-[0_28px_60px_rgba(0,0,0,0.55)]">
          <div className="flex h-[280px] flex-col sm:h-[320px]">
            {/* Reaction stack: creator top / content bottom */}
            <div className="relative flex-[1.05] overflow-hidden border-b border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/marketing/preview-reactor.jpg"
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-[50%_20%]"
                draggable={false}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/20" />
              <p className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85">
                Reactor
              </p>
            </div>
            <div className="relative flex-1 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/marketing/preview-source.jpg"
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-center"
                draggable={false}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
              <p className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85">
                Source
              </p>
              <p className="absolute inset-x-2 bottom-3 text-center text-[11px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                <span className="text-[var(--accent)]">Hook</span> locked in
              </p>
            </div>
          </div>
          <div className="border-t border-white/10 px-2.5 py-2">
            <div className="flex items-center justify-between text-[8px] text-white/50">
              <span>9:16 export</span>
              <span>Ready</span>
            </div>
            <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-3/4 rounded-full bg-[var(--accent)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
