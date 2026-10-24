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
  const row = settings as Record<string, unknown>;
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (key in row && row[key] !== undefined) return "finetune";
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
  const row = settings as Record<string, unknown>;
  const out: CaptionSettings = {};
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (key in row && row[key] !== undefined) {
      Object.assign(out, { [key]: row[key] });
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
  { id: "highlight", label: "Highlight" },
  { id: "bounce", label: "Bounce" },
  { id: "glow", label: "Glow" },
  { id: "scale", label: "Scale" },
  { id: "box", label: "Box" },
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
  const styleRow = style as unknown as Record<string, unknown>;
  const baseRow = base as unknown as Record<string, unknown>;
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (styleRow[key] !== baseRow[key]) {
      Object.assign(out, { [key]: styleRow[key] });
    }
  }
  return settingsForFinetuneMode(out);
}

export type PreviewWord = { word: string; start: number; end: number };

export type PreviewCue = {
  start: number;
  end: number;
  text: string;
  /** Optional word onsets (from roll synthesis or ASR) — clip-relative. */
  words?: PreviewWord[];
};

const MAX_ROLL_DURATION = 2.8;
/** Match worker CapCut/OpusClip pacing so preview tracks the burn. */
const SPEECH_WORD_SEC = 0.28;
const MAX_WORD_SEC = 0.4;
const LAST_WORD_HOLD = 0.18;
/** Must match worker `_CAPTION_LEAD` — counters late YouTube/ASR timestamps. */
const CAPTION_LEAD = 0.15;
/** Must match worker `SEGMENT_PADDING_SECONDS` default (1.5). */
export const DEFAULT_SEGMENT_PAD_SECONDS = 1.5;

function tokenWords(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().toLowerCase().split(" ").filter(Boolean);
}

/** Mirror worker `_is_rolling_extension` — grow or slide, not unrelated overlap. */
function isRollingExtension(prev: string, nxt: string): boolean {
  const p = tokenWords(prev);
  const n = tokenWords(nxt);
  if (!p.length || !n.length) return false;
  if (n.length >= p.length && n.slice(0, p.length).join(" ") === p.join(" ")) return true;
  const maxK = Math.min(p.length, n.length, 8);
  for (let k = maxK; k >= 2; k--) {
    if (p.slice(-k).join(" ") === n.slice(0, k).join(" ")) return true;
  }
  return false;
}

function speechEnd(start: number, body: string, rawEnd: number): number {
  const n = Math.max(1, tokenWords(body).length);
  const paced = start + n * SPEECH_WORD_SEC + LAST_WORD_HOLD;
  const softCap = paced + 0.22;
  return Math.max(start + 0.22, Math.min(rawEnd, softCap, start + MAX_ROLL_DURATION));
}

/** Mirror worker `_synthesize_roll_words` for preview/burn parity. */
function synthesizeRollWords(
  steps: Array<{ start: number; end: number; text: string }>,
): PreviewWord[] | undefined {
  if (steps.length < 2) return undefined;
  const stamped: PreviewWord[] = [];
  let prevTokens: string[] = [];
  for (const step of steps) {
    const tokens = step.text.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (!prevTokens.length) {
      let t = step.start;
      for (const tok of tokens) {
        stamped.push({ word: tok, start: t, end: t + SPEECH_WORD_SEC });
        t += SPEECH_WORD_SEC;
      }
      prevTokens = tokens;
      continue;
    }
    const prevLower = prevTokens.map((x) => x.toLowerCase());
    const tokLower = tokens.map((x) => x.toLowerCase());
    if (
      tokens.length >= prevTokens.length &&
      tokLower.slice(0, prevTokens.length).join(" ") === prevLower.join(" ")
    ) {
      for (const tok of tokens.slice(prevTokens.length)) {
        stamped.push({
          word: tok,
          start: step.start,
          end: step.start + SPEECH_WORD_SEC,
        });
      }
      prevTokens = tokens;
      continue;
    }
    const maxK = Math.min(prevTokens.length, tokens.length, 8);
    let overlap = 0;
    for (let k = maxK; k >= 1; k--) {
      if (
        prevLower.slice(-k).join(" ") === tokLower.slice(0, k).join(" ")
      ) {
        overlap = k;
        break;
      }
    }
    const drop = Math.max(0, prevTokens.length - overlap);
    if (drop) stamped.splice(0, drop);
    for (const tok of tokens.slice(overlap)) {
      stamped.push({
        word: tok,
        start: step.start,
        end: step.start + SPEECH_WORD_SEC,
      });
    }
    prevTokens = tokens;
  }
  for (let i = 0; i < stamped.length - 1; i++) {
    const nxt = stamped[i + 1].start;
    stamped[i] = {
      ...stamped[i],
      end: Math.max(stamped[i].start + 0.05, Math.min(stamped[i].end, nxt)),
    };
  }
  return stamped.length ? stamped : undefined;
}

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
  let rollSteps = [{ start: ordered[0].start, end: ordered[0].end, text: cur.text }];
  const groups: PreviewCue[] = [];

  const finalize = (cue: PreviewCue, steps: typeof rollSteps): PreviewCue => {
    const words = synthesizeRollWords(steps) ?? cue.words;
    let start = cue.start;
    let end = cue.end;
    if (words?.length) {
      start = Math.max(start, Math.min(...words.map((w) => w.start)));
      end = Math.max(end, Math.max(...words.map((w) => w.end)));
    }
    end = speechEnd(start, cue.text, end);
    return { start, end, text: cue.text, words };
  };

  for (let i = 1; i < ordered.length; i++) {
    const text = ordered[i].text.replace(/\s+/g, " ").trim();
    const overlaps = ordered[i].start < cur.end;
    const roll = overlaps && isRollingExtension(cur.text, text);
    // Spoken length — raw ASR ends are long and falsely capped rolls.
    const candidateText = roll ? text : cur.text;
    const wouldBeLong =
      tokenWords(candidateText).length * SPEECH_WORD_SEC + LAST_WORD_HOLD >
      MAX_ROLL_DURATION;

    if (overlaps && roll && !wouldBeLong) {
      const useText =
        isRollingExtension(cur.text, text) && text.length >= cur.text.length - 8
          ? text
          : text.length >= cur.text.length
            ? text
            : cur.text;
      // Keep source end while rolling so later updates still overlap (pace on finalize).
      const rawEnd = Math.max(cur.end, ordered[i].end, cur.start + 0.08);
      rollSteps.push({ start: ordered[i].start, end: ordered[i].end, text: useText });
      cur = {
        start: cur.start,
        end: rawEnd,
        text: useText,
      };
    } else {
      groups.push(finalize(cur, rollSteps));
      const priorEnd = groups[groups.length - 1].end;
      let start = ordered[i].start;
      if (start < priorEnd) start = priorEnd;
      cur = {
        start,
        end: speechEnd(start, text, Math.max(ordered[i].end, start + 0.08)),
        text,
      };
      rollSteps = [{ start, end: ordered[i].end, text }];
    }
  }
  groups.push(finalize(cur, rollSteps));

  for (let i = 1; i < groups.length; i++) {
    if (groups[i].start < groups[i - 1].end) {
      const shift = groups[i - 1].end - groups[i].start;
      const words = groups[i].words?.map((w) => ({
        ...w,
        start: w.start + shift,
        end: w.end + shift,
      }));
      groups[i] = {
        ...groups[i],
        start: groups[i - 1].end,
        end: Math.max(groups[i - 1].end + 0.06, groups[i].end + shift),
        words,
      };
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
  // Match worker burn lead (~150ms ASR lag compensation → realtime feel).
  const t = time + CAPTION_LEAD;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;

  const chunks = chunkCaptionWords(cue.text, maxWords);
  if (!chunks.length) return null;

  const allWords = cue.text.split(/\s+/).filter(Boolean);
  const stamped = cue.words;

  // Prefer synthesized/ASR word onsets so later words are not shown early.
  if (stamped && stamped.length === allWords.length) {
    let globalIdx = 0;
    for (let i = 0; i < stamped.length; i++) {
      if (t >= stamped[i].start) globalIdx = i;
    }
    // If playback is before the first word onset, hold index 0 only once speech starts.
    if (t < stamped[0].start) {
      return null;
    }
    const size = Math.max(1, Math.floor(maxWords) || 8);
    const chunkIndex = Math.min(chunks.length - 1, Math.floor(globalIdx / size));
    const chunk = chunks[chunkIndex];
    const chunkWords = chunk.split(/\s+/).filter(Boolean);
    const wordIndex = Math.min(chunkWords.length - 1, globalIdx - chunkIndex * size);
    const active = stamped[globalIdx];
    const span = Math.max(0.05, active.end - active.start);
    const progress = Math.min(1, Math.max(0, (t - active.start) / span));
    return { text: chunk, wordIndex, progress };
  }

  const wordsInCue = allWords.length || 1;
  const natural = wordsInCue * SPEECH_WORD_SEC + LAST_WORD_HOLD;
  const rawDur = Math.max(0.05, cue.end - cue.start);
  // CapCut/Opus: pace to speech — don't crawl through silence.
  const dur = Math.min(rawDur, Math.max(natural * 1.1, wordsInCue * 0.14));
  const progress = Math.min(1, Math.max(0, (t - cue.start) / dur));
  const chunkIndex = Math.min(chunks.length - 1, Math.floor(progress * chunks.length));
  const chunk = chunks[chunkIndex];
  const chunkWords = chunk.split(/\s+/).filter(Boolean);
  const chunkStart = cue.start + (chunkIndex / chunks.length) * dur;
  const idealChunk = Math.max(
    0.05,
    Math.min(dur / chunks.length, chunkWords.length * MAX_WORD_SEC),
  );
  const chunkProgress = Math.min(1, Math.max(0, (t - chunkStart) / idealChunk));
  const wordIndex = Math.min(
    chunkWords.length - 1,
    Math.floor(chunkProgress * chunkWords.length),
  );
  return { text: chunk, wordIndex, progress: chunkProgress };
}
