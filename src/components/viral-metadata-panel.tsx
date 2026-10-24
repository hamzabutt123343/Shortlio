"use client";

import { useState } from "react";
import { Button, Input, Label, cn } from "@/components/ui";
import {
  normalizeViralMetadata,
  type TitleOption,
  type ViralMetadata,
  type ViralPlatform,
} from "@/lib/viral-metadata/types";

const TABS: { id: ViralPlatform; label: string }[] = [
  { id: "youtube", label: "YouTube Shorts" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram Reels" },
];

const ANGLE_LABEL: Record<TitleOption["angle"], string> = {
  curiosity: "Curiosity",
  emotion: "Emotion",
  event: "Event",
};

function listToText(items: string[]): string {
  return items.join(", ");
}

function textToList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ViralMetadataPanel({
  clipId,
  initial,
  language,
  onSaved,
}: {
  clipId: string;
  initial: unknown;
  language: string;
  onSaved?: (meta: ViralMetadata) => void;
}) {
  const [tab, setTab] = useState<ViralPlatform>("youtube");
  const [meta, setMeta] = useState<ViralMetadata>(() =>
    normalizeViralMetadata(initial, language),
  );
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateMeta(next: ViralMetadata) {
    setMeta(next);
  }

  function selectTitleOption(option: TitleOption) {
    if (!meta.youtube) return;
    updateMeta({
      ...meta,
      youtube: { ...meta.youtube, title: option.title },
    });
  }

  async function regenerate(platforms?: ViralPlatform[]) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/clips/${clipId}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, platforms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate metadata");
      const next = normalizeViralMetadata(data.viralMetadata ?? data.clip?.viral_metadata, language);
      setMeta(next);
      onSaved?.(next);
      setMessage(
        platforms?.length === 1
          ? `Regenerated ${platforms[0]} metadata.`
          : "Viral metadata generated from this clip’s moment + context.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viralMetadata: meta, reRender: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const next = normalizeViralMetadata(data.clip?.viral_metadata ?? meta, language);
      setMeta(next);
      onSaved?.(next);
      setMessage("Metadata saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const yt = meta.youtube!;
  const tt = meta.tiktok!;
  const ig = meta.instagram!;
  const titleOptions = meta.title_options ?? [];
  const hasContent =
    Boolean(yt.title || yt.description || tt.caption || ig.caption) ||
    Boolean(meta.generated_at);

  return (
    <div className="space-y-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Viral metadata
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            High-CTR titles from this clip’s moment, emotion, and source context
            {meta.provider ? ` · ${meta.provider}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => void regenerate()}
          >
            {busy ? "Generating…" : hasContent ? "Regenerate" : "Generate"}
          </Button>
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            disabled={saving || busy}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save metadata"}
          </Button>
        </div>
      </div>

      {meta.moment_summary ? (
        <p className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)]/70 px-2.5 py-2 text-xs text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text)]">Moment: </span>
          {meta.moment_summary}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              "rounded-[8px] px-3 py-1.5 text-xs font-medium transition",
              tab === t.id
                ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]",
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "youtube" && (
        <div className="space-y-3">
          {titleOptions.length > 0 && (
            <div className="space-y-2">
              <Label>Title options</Label>
              <div className="space-y-1.5">
                {titleOptions.map((opt) => {
                  const selected = yt.title === opt.title;
                  return (
                    <button
                      key={`${opt.angle}-${opt.title}`}
                      type="button"
                      onClick={() => selectTitleOption(opt)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-[8px] border px-2.5 py-2 text-left transition",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                          : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <span className="mt-0.5 shrink-0 rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
                        {ANGLE_LABEL[opt.angle]}
                      </span>
                      <span className="text-sm text-[var(--text)]">{opt.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="yt-title">Selected title</Label>
            <Input
              id="yt-title"
              value={yt.title}
              onChange={(e) =>
                updateMeta({ ...meta, youtube: { ...yt, title: e.target.value } })
              }
            />
          </div>
          <div>
            <Label htmlFor="yt-desc">Description</Label>
            <textarea
              id="yt-desc"
              className="min-h-[110px] w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={yt.description}
              onChange={(e) =>
                updateMeta({ ...meta, youtube: { ...yt, description: e.target.value } })
              }
            />
          </div>
          <div>
            <Label htmlFor="yt-hash">Hashtags</Label>
            <Input
              id="yt-hash"
              value={listToText(yt.hashtags)}
              onChange={(e) =>
                updateMeta({
                  ...meta,
                  youtube: { ...yt, hashtags: textToList(e.target.value) },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="yt-tags">Tags</Label>
            <Input
              id="yt-tags"
              value={listToText(yt.tags)}
              onChange={(e) =>
                updateMeta({
                  ...meta,
                  youtube: { ...yt, tags: textToList(e.target.value) },
                })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={() =>
                void copyText(
                  `${yt.title}\n\n${yt.description}\n\n${yt.hashtags.join(" ")}`,
                ).then(() => setMessage("YouTube metadata copied."))
              }
            >
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-xs"
              disabled={busy}
              onClick={() => void regenerate(["youtube"])}
            >
              Regenerate YouTube
            </Button>
          </div>
        </div>
      )}

      {tab === "tiktok" && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="tt-caption">Caption</Label>
            <textarea
              id="tt-caption"
              className="min-h-[100px] w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={tt.caption}
              onChange={(e) =>
                updateMeta({ ...meta, tiktok: { ...tt, caption: e.target.value } })
              }
            />
          </div>
          <div>
            <Label htmlFor="tt-hash">Hashtags</Label>
            <Input
              id="tt-hash"
              value={listToText(tt.hashtags)}
              onChange={(e) =>
                updateMeta({
                  ...meta,
                  tiktok: { ...tt, hashtags: textToList(e.target.value) },
                })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={() =>
                void copyText(`${tt.caption} ${tt.hashtags.join(" ")}`.trim()).then(() =>
                  setMessage("TikTok caption copied."),
                )
              }
            >
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-xs"
              disabled={busy}
              onClick={() => void regenerate(["tiktok"])}
            >
              Regenerate TikTok
            </Button>
          </div>
        </div>
      )}

      {tab === "instagram" && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="ig-caption">Caption</Label>
            <textarea
              id="ig-caption"
              className="min-h-[100px] w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={ig.caption}
              onChange={(e) =>
                updateMeta({ ...meta, instagram: { ...ig, caption: e.target.value } })
              }
            />
          </div>
          <div>
            <Label htmlFor="ig-kw">Keywords</Label>
            <Input
              id="ig-kw"
              value={listToText(ig.keywords)}
              onChange={(e) =>
                updateMeta({
                  ...meta,
                  instagram: { ...ig, keywords: textToList(e.target.value) },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="ig-hash">Hashtags</Label>
            <Input
              id="ig-hash"
              value={listToText(ig.hashtags)}
              onChange={(e) =>
                updateMeta({
                  ...meta,
                  instagram: { ...ig, hashtags: textToList(e.target.value) },
                })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={() =>
                void copyText(
                  `${ig.caption}\n\n${ig.hashtags.join(" ")}\n\nKeywords: ${ig.keywords.join(", ")}`,
                ).then(() => setMessage("Instagram metadata copied."))
              }
            >
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-xs"
              disabled={busy}
              onClick={() => void regenerate(["instagram"])}
            >
              Regenerate Reels
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {message && <p className="text-sm text-[var(--success)]">{message}</p>}
    </div>
  );
}
