import { CAPTION_PRESETS, type CaptionStyle } from "@/lib/captions/presets";

export type CaptionAnimation = CaptionStyle["animation"];
export type CaptionPosition = CaptionStyle["position"];

/**
 * Tracks which style source is authoritative.
 * - `preset`: grid preset wins; fine-tune overrides are ignored
 * - `finetune`: sparse overrides in caption_settings merge onto the preset base
 */
export type CaptionStyleMode = "preset" | "finetune";

/** Reserved key persisted inside caption_settings JSON (stripped before ASS burn). */
export const STYLE_MODE_KEY = "__mode" as const;

/** User overrides layered on top of a preset (only used when mode === "finetune"). */
export type CaptionSettings = Partial<{
  fontFamily: string;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  shadow: boolean;
  position: CaptionPosition;
  fontSize: number;
  fontWeight: number;
  maxWordsPerCaption: number;
  animation: CaptionAnimation;
}> & {
  [STYLE_MODE_KEY]?: CaptionStyleMode;
};

const STYLE_OVERRIDE_KEYS: (keyof CaptionSettings)[] = [
  "fontFamily",
  "textColor",
  "highlightColor",
  "outlineColor",
  "outlineWidth",
  "backgroundColor",
  "backgroundOpacity",
  "shadow",
  "position",
  "fontSize",
  "fontWeight",
  "maxWordsPerCaption",
  "animation",
];

export function getCaptionStyleMode(
  settings?: CaptionSettings | Record<string, unknown> | null,
): CaptionStyleMode {
  if (!settings || typeof settings !== "object") return "preset";
  const mode = settings[STYLE_MODE_KEY];
  if (mode === "finetune" || mode === "preset") return mode;
  // Legacy rows: any real override key ⇒ treat as finetune
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (key in settings && settings[key as string] !== undefined) return "finetune";
  }
  return "preset";
}

/** Settings payload when the user picks a grid preset (preset has highest priority). */
export function settingsForPresetMode(): CaptionSettings {
  return { [STYLE_MODE_KEY]: "preset" };
}

/** Attach finetune mode + override diffs. */
export function settingsForFinetuneMode(overrides: CaptionSettings): CaptionSettings {
  const { [STYLE_MODE_KEY]: _drop, ...rest } = overrides;
  return { ...rest, [STYLE_MODE_KEY]: "finetune" };
}

/** Strip control keys before comparing visual settings. */
export function visualCaptionSettings(
  settings?: CaptionSettings | Record<string, unknown> | null,
): CaptionSettings {
  if (!settings || typeof settings !== "object") return {};
  const out: CaptionSettings = {};
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (key in settings && settings[key as string] !== undefined) {
      Object.assign(out, { [key]: settings[key as string] });
    }
  }
  return out;
}

export const CAPTION_FONT_STACK: Record<string, string> = {
  Montserrat:
    'var(--font-caption-montserrat), "Montserrat", "Noto Sans", "Nirmala UI", ui-sans-serif, sans-serif',
  Anton: 'var(--font-caption-anton), "Anton", Impact, "Noto Sans", ui-sans-serif, sans-serif',
  Poppins:
    'var(--font-caption-poppins), "Poppins", "Noto Sans", "Nirmala UI", ui-sans-serif, sans-serif',
  Inter: 'var(--font-caption-inter), "Inter", "Noto Sans", "Nirmala UI", ui-sans-serif, sans-serif',
  Roboto: 'var(--font-caption-roboto), "Roboto", "Noto Sans", "Nirmala UI", ui-sans-serif, sans-serif',
  Impact: 'Impact, Haettenschweiler, "Arial Black", ui-sans-serif, sans-serif',
  "Noto Sans": '"Noto Sans", "Nirmala UI", "Segoe UI", ui-sans-serif, sans-serif',
};

export const CAPTION_FONT_OPTIONS = [
  "Montserrat",
  "Anton",
  "Poppins",
  "Inter",
  "Roboto",
  "Impact",
  "Noto Sans",
] as const;

export const CAPTION_LANGUAGE_OPTIONS: { id: string; label: string; sample: string; dir?: "rtl" }[] =
  [
    { id: "en", label: "English", sample: "This is the moment that changes everything" },
    {
      id: "hinglish",
      label: "Hinglish (Roman)",
      sample: "Yeh moment bilkul viral hone wala hai",
    },
    { id: "hi", label: "Hindi", sample: "यह पल सब कुछ बदल देगा" },
    { id: "ur", label: "Urdu", sample: "یہ لمحہ سب کچھ بدل دے گا", dir: "rtl" },
    { id: "ar", label: "Arabic", sample: "هذه هي اللحظة التي تغير كل شيء", dir: "rtl" },
    { id: "auto", label: "Auto / other", sample: "This is the moment that changes everything" },
  ];

export const ANIMATION_OPTIONS: { id: CaptionAnimation; label: string }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade" },
  { id: "pop", label: "Pop" },
  { id: "karaoke", label: "Karaoke" },
  { id: "word_pop", label: "Word pop" },
];

export const POSITION_OPTIONS: { id: CaptionPosition; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "center", label: "Center" },
  { id: "bottom", label: "Bottom" },
];

export const HIGHLIGHT_SWATCHES = [
  "#FFFFFF",
  "#FFE566",
  "#3DD6C6",
  "#7CFFB2",
  "#FF6B4A",
  "#FF4D6D",
  "#F0C14B",
  "#7C9CFF",
];

export function fontStackFor(family: string): string {
  return CAPTION_FONT_STACK[family] ?? `"${family}", ui-sans-serif, sans-serif`;
}

export function sampleCaptionText(language: string): string {
  const hit = CAPTION_LANGUAGE_OPTIONS.find((o) => o.id === language);
  return hit?.sample ?? CAPTION_LANGUAGE_OPTIONS[0].sample;
}

export function languageDir(language: string): "ltr" | "rtl" {
  return CAPTION_LANGUAGE_OPTIONS.find((o) => o.id === language)?.dir === "rtl" ? "rtl" : "ltr";
}

export function resolveCaptionStyle(
  presetId: string,
  settings?: CaptionSettings | Record<string, unknown> | null,
): CaptionStyle {
  const base = CAPTION_PRESETS.find((p) => p.id === presetId) ?? CAPTION_PRESETS[0];
  // Always clone so React state/memo never shares a mutable preset object.
  const mode = getCaptionStyleMode(settings);
  // Preset mode has highest priority — ignore any leftover fine-tune fields.
  if (mode === "preset" || !settings || typeof settings !== "object") {
    return { ...base };
  }

  const s = visualCaptionSettings(settings);
  return {
    ...base,
    ...(s.fontFamily !== undefined ? { fontFamily: String(s.fontFamily) } : {}),
    ...(s.textColor !== undefined ? { textColor: String(s.textColor) } : {}),
    ...(s.highlightColor !== undefined ? { highlightColor: String(s.highlightColor) } : {}),
    ...(s.outlineColor !== undefined ? { outlineColor: String(s.outlineColor) } : {}),
    ...(s.outlineWidth !== undefined ? { outlineWidth: Number(s.outlineWidth) } : {}),
    ...(s.backgroundColor !== undefined ? { backgroundColor: String(s.backgroundColor) } : {}),
    ...(s.backgroundOpacity !== undefined
      ? { backgroundOpacity: Number(s.backgroundOpacity) }
      : {}),
    ...(s.shadow !== undefined ? { shadow: Boolean(s.shadow) } : {}),
    ...(s.position !== undefined ? { position: s.position as CaptionPosition } : {}),
    ...(s.fontSize !== undefined ? { fontSize: Number(s.fontSize) } : {}),
    ...(s.fontWeight !== undefined ? { fontWeight: Number(s.fontWeight) } : {}),
    ...(s.maxWordsPerCaption !== undefined
      ? { maxWordsPerCaption: Number(s.maxWordsPerCaption) }
      : {}),
    ...(s.animation !== undefined ? { animation: s.animation as CaptionAnimation } : {}),
  };
}

/** Stable fingerprint so preview remounts whenever visual style changes. */
export function captionStyleKey(style: CaptionStyle): string {
  return [
    style.id,
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.textColor,
    style.highlightColor,
    style.outlineColor,
    style.outlineWidth,
    style.backgroundColor,
    style.backgroundOpacity,
    style.shadow ? 1 : 0,
    style.position,
    style.maxWordsPerCaption,
    style.animation,
  ].join("|");
}

/** Diff against preset so we only persist real overrides (always finetune mode). */
export function captionSettingsDiff(
  presetId: string,
  style: CaptionStyle,
): CaptionSettings {
  const base = CAPTION_PRESETS.find((p) => p.id === presetId) ?? CAPTION_PRESETS[0];
  const out: CaptionSettings = {};
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (style[key] !== base[key]) {
      Object.assign(out, { [key]: style[key] });
    }
  }
  return settingsForFinetuneMode(out);
}

export type PreviewCue = {
  start: number;
  end: number;
  text: string;
};

/** Collapse overlapping/rolling transcript rows (same idea as worker ASS collapse). */
export function collapseRollingCues(cues: PreviewCue[]): PreviewCue[] {
  const ordered = [...cues]
    .filter((c) => c.text.trim())
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ordered.length) return [];

  let cur: PreviewCue = {
    start: ordered[0].start,
    end: Math.max(ordered[0].end, ordered[0].start + 0.08),
    text: ordered[0].text.replace(/\s+/g, " ").trim(),
  };
  const groups: PreviewCue[] = [];

  for (let i = 1; i < ordered.length; i++) {
    const text = ordered[i].text.replace(/\s+/g, " ").trim();
    if (ordered[i].start < cur.end) {
      cur = {
        start: cur.start,
        end: Math.max(cur.end, ordered[i].end, cur.start + 0.08),
        text: text.length >= cur.text.length ? text : cur.text,
      };
    } else {
      groups.push(cur);
      cur = {
        start: ordered[i].start,
        end: Math.max(ordered[i].end, ordered[i].start + 0.08),
        text,
      };
    }
  }
  groups.push(cur);

  for (let i = 1; i < groups.length; i++) {
    if (groups[i].start < groups[i - 1].end) {
      groups[i] = { ...groups[i], start: groups[i - 1].end };
    }
  }
  return groups.filter((c) => c.end > c.start && c.text.trim().length > 1);
}

/** Chunk words the same way the worker ASS burner does (`_chunk_words`). */
export function chunkCaptionWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const size = Math.max(1, Math.floor(maxWords) || 8);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "));
  }
  return chunks;
}

/** Pick active cue + karaoke word index for a playback time (clip-relative). */
export function activeCaptionAt(
  cues: PreviewCue[],
  time: number,
  maxWords: number,
): { text: string; wordIndex: number; progress: number } | null {
  // No lead - captions sync exactly with speech (matches worker ASS timing).
  const t = time;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;

  const chunks = chunkCaptionWords(cue.text, maxWords);
  if (!chunks.length) return null;

  const dur = Math.max(0.05, cue.end - cue.start);
  const progress = Math.min(1, Math.max(0, (t - cue.start) / dur));
  const chunkIndex = Math.min(chunks.length - 1, Math.floor(progress * chunks.length));
  const chunk = chunks[chunkIndex];
  const chunkWords = chunk.split(/\s+/).filter(Boolean);
  const chunkStart = cue.start + (chunkIndex / chunks.length) * dur;
  const chunkDur = Math.max(0.05, dur / chunks.length);
  const chunkProgress = Math.min(1, Math.max(0, (t - chunkStart) / chunkDur));
  const wordIndex = Math.min(
    chunkWords.length - 1,
    Math.floor(chunkProgress * chunkWords.length),
  );
  return { text: chunk, wordIndex, progress: chunkProgress };
}
