"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { CAPTION_PRESETS, type CaptionStyle } from "@/lib/captions/presets";
import type { Clip } from "@/lib/types";

export function ClipEditor({
  initialClip,
  initialSignedUrl,
}: {
  initialClip: Clip;
  initialSignedUrl: string | null;
}) {
  const [clip, setClip] = useState(initialClip);
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl);
  const [title, setTitle] = useState(initialClip.title);
  const [startTime, setStartTime] = useState(String(initialClip.start_time));
  const [endTime, setEndTime] = useState(String(initialClip.end_time));
  const [captionPreset, setCaptionPreset] = useState(initialClip.caption_preset);
  const [captionLanguage, setCaptionLanguage] = useState(initialClip.caption_language);
  const [burnCaptions, setBurnCaptions] = useState(initialClip.burn_captions);
  const [outputFormat, setOutputFormat] = useState(initialClip.output_format);
  const [quality, setQuality] = useState(initialClip.quality);
  const [focalX, setFocalX] = useState(
    String((initialClip.crop_settings as { focal_x?: number })?.focal_x ?? 0.5),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preset = useMemo(
    () => CAPTION_PRESETS.find((p) => p.id === captionPreset) ?? CAPTION_PRESETS[0],
    [captionPreset],
  );

  useEffect(() => {
    if (clip.render_status !== "rendering" && clip.render_status !== "pending") return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setClip(data.clip);
      setSignedUrl(data.signedUrl);
    }, 3000);
    return () => clearInterval(id);
  }, [clip.id, clip.render_status]);

  async function save(reRender: boolean) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startTime: Number(startTime),
          endTime: Number(endTime),
          captionPreset,
          captionLanguage,
          burnCaptions,
          outputFormat,
          quality,
          cropSettings: { focal_x: Number(focalX), mode: "manual_override" },
          reRender,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setClip(data.clip);
      setMessage(reRender ? "Re-render queued." : "Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    setError(null);
    const res = await fetch(`/api/clips/${clip.id}/download`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Download failed");
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">Clip editor</h1>
          <Badge
            tone={
              clip.render_status === "ready"
                ? "success"
                : clip.render_status === "failed"
                  ? "danger"
                  : "accent"
            }
          >
            {clip.render_status}
          </Badge>
        </div>
        <div className="aspect-[9/16] max-h-[640px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-black">
          {signedUrl ? (
            <video key={signedUrl} src={signedUrl} controls className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
              Preview unavailable until render completes
            </div>
          )}
        </div>
        <CaptionPreview preset={preset} language={captionLanguage} />
        {clip.reframe_warning && (
          <p className="mt-3 text-sm text-[var(--warning)]">
            Automatic subject tracking used a fallback. Adjust focal position and re-render.
          </p>
        )}
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start">Start (s)</Label>
              <Input id="start" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="end">End (s)</Label>
              <Input id="end" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="preset">Caption preset</Label>
            <select
              id="preset"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={captionPreset}
              onChange={(e) => setCaptionPreset(e.target.value)}
            >
              {CAPTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="lang">Caption language</Label>
            <select
              id="lang"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={captionLanguage}
              onChange={(e) => setCaptionLanguage(e.target.value)}
            >
              <option value="en">English</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </div>
          <div>
            <Label htmlFor="aspect">Aspect ratio</Label>
            <select
              id="aspect"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
            >
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
          <div>
            <Label htmlFor="quality">Quality</Label>
            <select
              id="quality"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <Label htmlFor="focal">Focal X (0–1)</Label>
            <Input
              id="focal"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={focalX}
              onChange={(e) => setFocalX(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={burnCaptions}
              onChange={(e) => setBurnCaptions(e.target.checked)}
            />
            Burn captions into export
          </label>
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {message && <p className="text-sm text-[var(--success)]">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save(true)} disabled={saving}>
              {saving ? "Saving…" : "Save & re-render"}
            </Button>
            <Button variant="secondary" onClick={download} disabled={clip.render_status !== "ready"}>
              Download
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CaptionPreview({ preset, language }: { preset: CaptionStyle; language: string }) {
  const sample =
    language === "hinglish"
      ? "Yeh moment bilkul viral hone wala hai"
      : "This is the moment that changes everything";

  return (
    <div className="mt-4 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
        Caption preview · {preset.name}
      </p>
      <p
        className="text-center leading-tight"
        style={{
          color: preset.textColor,
          fontSize: Math.min(preset.fontSize / 2.4, 28),
          fontWeight: preset.fontWeight,
          textShadow: preset.shadow ? `0 2px ${preset.outlineWidth}px ${preset.outlineColor}` : undefined,
          background:
            preset.backgroundOpacity > 0
              ? `rgba(0,0,0,${preset.backgroundOpacity})`
              : "transparent",
          padding: "8px 10px",
          borderRadius: 8,
        }}
      >
        <span style={{ color: preset.highlightColor }}>{sample.split(" ")[0]}</span>{" "}
        {sample.split(" ").slice(1).join(" ")}
      </p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Animation: {preset.animation} · max {preset.maxWordsPerCaption} words/line
      </p>
    </div>
  );
}
