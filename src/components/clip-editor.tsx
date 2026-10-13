"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaptionOverlayPreview,
  CaptionStylePicker,
} from "@/components/caption-style-picker";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import {
  activeCaptionAt,
  collapseRollingCues,
  getCaptionStyleMode,
  resolveCaptionStyle,
  settingsForPresetMode,
  type CaptionSettings,
  type PreviewCue,
} from "@/lib/captions/style";
import { transformCaptionTextDetailed } from "@/lib/captions/transform";
import type { Clip } from "@/lib/types";

type TranscriptRow = {
  start_time: number;
  end_time: number;
  text: string;
  language?: string | null;
};

type CropSettingsState = {
  focal_x: number;
  mode: "auto" | "manual_override";
  speaker_focus: boolean;
  tracking_mode: "hard_cut" | "subject";
};

function settingsEqual(a: CaptionSettings, b: CaptionSettings) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function readCropSettings(raw: unknown): CropSettingsState {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const focal = typeof obj.focal_x === "number" ? obj.focal_x : Number(obj.focal_x ?? 0.5);
  const mode = obj.mode === "manual_override" || obj.mode === "manual" ? "manual_override" : "auto";
  const speakerFocus =
    obj.speaker_focus === undefined && obj.smart_speaker_switch === undefined
      ? true
      : Boolean(obj.speaker_focus ?? obj.smart_speaker_switch);
  const tracking =
    obj.tracking_mode === "subject" || obj.tracking_mode === "smooth"
      ? "subject"
      : "hard_cut";
  return {
    focal_x: Number.isFinite(focal) ? focal : 0.5,
    mode,
    speaker_focus: speakerFocus,
    tracking_mode: tracking,
  };
}

export function ClipEditor({
  initialClip,
  initialSignedUrl,
  initialTranscript = [],
}: {
  initialClip: Clip;
  initialSignedUrl: string | null;
  initialTranscript?: TranscriptRow[];
}) {
  const initialCrop = readCropSettings(initialClip.crop_settings);
  const [clip, setClip] = useState(initialClip);
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [title, setTitle] = useState(initialClip.title);
  const [startTime, setStartTime] = useState(String(initialClip.start_time));
  const [endTime, setEndTime] = useState(String(initialClip.end_time));
  const [captionPreset, setCaptionPreset] = useState(initialClip.caption_preset);
  const [captionLanguage, setCaptionLanguage] = useState(initialClip.caption_language);
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(() => {
    const raw = (initialClip.caption_settings as CaptionSettings) ?? {};
    // Normalize legacy rows so mode is always explicit.
    if (!raw.__mode) {
      return getCaptionStyleMode(raw) === "finetune"
        ? { ...raw, __mode: "finetune" }
        : settingsForPresetMode();
    }
    return raw;
  });
  const [burnCaptions, setBurnCaptions] = useState(initialClip.burn_captions);
  const [outputFormat, setOutputFormat] = useState(initialClip.output_format);
  const [quality, setQuality] = useState(initialClip.quality);
  const [focalX, setFocalX] = useState(String(initialCrop.focal_x));
  const [framingMode, setFramingMode] = useState<"smart_auto" | "speaker_cuts" | "single_subject" | "static">(
    initialCrop.mode === "manual_override"
      ? "static"
      : initialCrop.speaker_focus
        ? "speaker_cuts"
        : initialCrop.tracking_mode === "subject"
          ? "single_subject"
          : "smart_auto",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const style = useMemo(
    () => resolveCaptionStyle(captionPreset, captionSettings),
    [captionPreset, captionSettings],
  );

  const styleDirty = useMemo(() => {
    const saved = (clip.caption_settings as CaptionSettings) ?? {};
    return (
      captionPreset !== clip.caption_preset ||
      captionLanguage !== clip.caption_language ||
      burnCaptions !== clip.burn_captions ||
      !settingsEqual(captionSettings, saved)
    );
  }, [
    captionPreset,
    captionLanguage,
    captionSettings,
    burnCaptions,
    clip.caption_preset,
    clip.caption_language,
    clip.caption_settings,
    clip.burn_captions,
  ]);

  const languagePreview = useMemo(() => {
    const sourceLang = transcript[0]?.language || "en";
    const sample = transcript.find((s) => s.text?.trim())?.text ?? "";
    if (!sample) return { unsupported: false as const, message: undefined as string | undefined };
    return transformCaptionTextDetailed(sample, sourceLang, captionLanguage);
  }, [transcript, captionLanguage]);

  const cues: PreviewCue[] = useMemo(() => {
    const start = Number(startTime) || clip.start_time;
    const pad = 1.5;
    const sourceLang = transcript[0]?.language || "en";
    const raw = transcript
      .filter(
        (s) =>
          s.end_time >= start - pad &&
          s.start_time <= (Number(endTime) || clip.end_time) + pad,
      )
      .map((s) => {
        const transformed = transformCaptionTextDetailed(
          s.text,
          s.language || sourceLang,
          captionLanguage,
        );
        return {
          start: Math.max(0, s.start_time - (start - pad)),
          end: Math.max(0.05, s.end_time - (start - pad)),
          text: transformed.text,
        };
      });
    return collapseRollingCues(raw);
  }, [transcript, startTime, endTime, clip.start_time, clip.end_time, captionLanguage]);

  const liveCaption = useMemo(
    () => activeCaptionAt(cues, currentTime, style.maxWordsPerCaption),
    [cues, currentTime, style.maxWordsPerCaption],
  );

  // While paused between cues, keep the most recent line so style tweaks stay visible.
  const overlayCaption = useMemo(() => {
    if (liveCaption) return liveCaption;
    if (playing || !cues.length) return null;
    const t = currentTime; // No lead - exact sync
    let last: PreviewCue | null = null;
    for (const cue of cues) {
      if (cue.start <= t) last = cue;
      else break;
    }
    if (!last) return null;
    // Same chunking as export: show the last chunk of the cue while paused.
    const hit = activeCaptionAt(
      [{ start: last.start, end: last.end, text: last.text }],
      Math.max(last.start, last.end - 0.001),
      style.maxWordsPerCaption,
    );
    return hit;
  }, [liveCaption, playing, cues, currentTime, style.maxWordsPerCaption]);

  const overlayText = overlayCaption?.text ?? null;

  // ONE caption renderer only:
  // - Export matches current settings → show burned MP4 captions only
  // - Otherwise → show live HTML overlay only (mask any burned pixels)
  const exportMatchesPreview =
    !styleDirty && burnCaptions && clip.render_status === "ready" && Boolean(signedUrl);
  const showLiveOverlay =
    !exportMatchesPreview &&
    (Boolean(overlayText?.trim()) || (!transcript.length && styleDirty));
  // Hide burned pixels whenever the live overlay is the active renderer
  // (includes mid-re-render, when the signed URL still has the old burn).
  const videoMayHaveBurns =
    Boolean(signedUrl) && Boolean(clip.burn_captions) && clip.render_status !== "failed";
  const maskBurnedCaptions = showLiveOverlay && videoMayHaveBurns;
  const renderedStyle = useMemo(
    () =>
      resolveCaptionStyle(
        clip.caption_preset,
        (clip.caption_settings as CaptionSettings) ?? {},
      ),
    [clip.caption_preset, clip.caption_settings],
  );

  useEffect(() => {
    if (clip.render_status !== "rendering" && clip.render_status !== "pending") return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setClip(data.clip);
      setSignedUrl(data.signedUrl);
      if (Array.isArray(data.transcript)) setTranscript(data.transcript);
    }, 3000);
    return () => clearInterval(id);
  }, [clip.id, clip.render_status]);

  useEffect(() => {
    if (transcript.length) return;
    void (async () => {
      const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.transcript)) setTranscript(data.transcript);
    })();
  }, [clip.id, transcript.length]);

  // Smooth playback clock (onTimeUpdate alone feels a little behind)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused) setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [signedUrl]);

  function buildCropSettings(): CropSettingsState {
    const fx = Number(focalX);
    const validFocal = Number.isFinite(fx) && fx >= 0 && fx <= 1;
    
    if (framingMode === "static" && validFocal) {
      return {
        focal_x: fx,
        mode: "manual_override",
        speaker_focus: false,
        tracking_mode: "hard_cut",
      };
    }
    
    if (framingMode === "speaker_cuts") {
      return {
        focal_x: validFocal ? fx : 0.5,
        mode: "auto",
        speaker_focus: true,
        tracking_mode: "hard_cut",
      };
    }
    
    if (framingMode === "single_subject") {
      return {
        focal_x: validFocal ? fx : 0.5,
        mode: "auto",
        speaker_focus: false,
        tracking_mode: "subject",
      };
    }
    
    // smart_auto or fallback
    return {
      focal_x: validFocal ? fx : 0.5,
      mode: "auto",
      speaker_focus: true,
      tracking_mode: "hard_cut",
    };
  }

  async function save(
    reRender: boolean,
    overrides?: { captionPreset?: string; captionSettings?: CaptionSettings },
  ) {
    const nextPreset = overrides?.captionPreset ?? captionPreset;
    const nextSettings = overrides?.captionSettings ?? captionSettings;
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
          captionPreset: nextPreset,
          captionLanguage,
          captionSettings: nextSettings,
          burnCaptions,
          outputFormat,
          quality,
          cropSettings: buildCropSettings(),
          reRender,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setClip(data.clip);
      if (data.clip?.caption_preset) setCaptionPreset(data.clip.caption_preset);
      if (data.clip?.caption_settings && typeof data.clip.caption_settings === "object") {
        setCaptionSettings(data.clip.caption_settings as CaptionSettings);
      }
      const mode = getCaptionStyleMode(nextSettings);
      setMessage(
        reRender
          ? mode === "preset"
            ? `Preset applied & re-render queued (${nextPreset}).`
            : "Fine-tune saved & re-render queued — export will match this style."
          : "Settings saved. Re-render to update the burned MP4 captions.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /** Grid preset click: apply immediately (mode=preset) and burn into the next export. */
  function handlePresetApplied(id: string, settings: CaptionSettings) {
    setCaptionPreset(id);
    setCaptionSettings(settings);
    void save(true, { captionPreset: id, captionSettings: settings });
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
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">
            Clip editor
          </h1>
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
        <div className="relative aspect-[9/16] max-h-[640px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-black">
          {signedUrl ? (
            <video
              ref={videoRef}
              key={signedUrl}
              src={signedUrl}
              controls
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                // Disable any soft subtitle tracks so the browser never paints a 2nd layer.
                const tracks = e.currentTarget.textTracks;
                for (let i = 0; i < tracks.length; i++) {
                  tracks[i].mode = "disabled";
                }
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
              Preview unavailable until render completes
            </div>
          )}
          {maskBurnedCaptions && (
            <div
              className={
                renderedStyle.position === "top"
                  ? "pointer-events-none absolute inset-x-0 top-0 h-[32%] bg-black"
                  : renderedStyle.position === "center"
                    ? "pointer-events-none absolute inset-x-0 top-[28%] h-[36%] bg-black"
                    : "pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-black"
              }
              aria-hidden
            />
          )}
          {showLiveOverlay && (
            <CaptionOverlayPreview
              style={style}
              language={captionLanguage}
              text={overlayText}
              wordIndex={
                overlayCaption && "wordIndex" in overlayCaption
                  ? overlayCaption.wordIndex
                  : undefined
              }
              playing={playing}
              sampleFallback={!transcript.length && styleDirty}
            />
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {exportMatchesPreview
            ? "Showing exported captions (preview matches download)."
            : overlayText
              ? "Live captions update instantly. Save & re-render to burn this style into the MP4."
              : transcript.length
                ? "Waiting for speech in this part of the clip…"
                : "Loading transcript for captions…"}
          {styleDirty ? " Style changes are unsaved for export." : ""}
        </p>
        {clip.reframe_warning && (
          <p className="mt-3 text-sm text-[var(--warning)]">
            Automatic subject tracking used a fallback. Adjust Focal X and re-render.
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

          <CaptionStylePicker
            presetId={captionPreset}
            language={captionLanguage}
            settings={captionSettings}
            onPresetChange={setCaptionPreset}
            onLanguageChange={setCaptionLanguage}
            onSettingsChange={setCaptionSettings}
            onPresetApplied={handlePresetApplied}
            density="full"
          />

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

          <div className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Smart Framing
            </p>
            
            <div>
              <Label htmlFor="framing-mode">Framing mode</Label>
              <select
                id="framing-mode"
                className="mt-1 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={framingMode}
                onChange={(e) =>
                  setFramingMode(
                    e.target.value as "smart_auto" | "speaker_cuts" | "single_subject" | "static",
                  )
                }
              >
                <option value="smart_auto">Smart Auto (recommended)</option>
                <option value="speaker_cuts">Active Speaker Cuts</option>
                <option value="single_subject">Single Subject Tracking</option>
                <option value="static">Static Position</option>
              </select>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {framingMode === "smart_auto" &&
                  "Automatically detects speakers and cuts instantly between them. Best for podcasts and interviews."}
                {framingMode === "speaker_cuts" &&
                  "Hard cuts between speakers with no panning. OpusClip-style instant transitions."}
                {framingMode === "single_subject" &&
                  "Smooth tracking of a single person or subject. Good for solo videos, gaming, IRL streams."}
                {framingMode === "static" &&
                  "Fixed crop position (set Focal X below). No automatic movement."}
              </p>
            </div>

            {framingMode === "static" && (
              <div>
                <Label htmlFor="focal">Focal X position (0 = left, 1 = right)</Label>
                <Input
                  id="focal"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={focalX}
                  onChange={(e) => setFocalX(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  0.5 = center. Adjust left/right to frame your subject.
                </p>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={burnCaptions}
              onChange={(e) => setBurnCaptions(e.target.checked)}
            />
            Burn captions into export
          </label>
          {languagePreview.unsupported && languagePreview.message && (
            <p className="text-sm text-[var(--warning)]">{languagePreview.message}</p>
          )}
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {message && <p className="text-sm text-[var(--success)]">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
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
