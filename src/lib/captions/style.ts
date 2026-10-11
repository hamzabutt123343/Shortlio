import { CAPTION_PRESETS, type CaptionStyle } from "@/lib/captions/presets";

export type CaptionAnimation = CaptionStyle["animation"];
export type CaptionPosition = CaptionStyle["position"];

/** User overrides layered on top of a preset (CapCut-style fine-tuning). */
export type CaptionSettings = Partial<{
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
}>;

export const CAPTION_FONT_STACK: Record<string, string> = {
  Montserrat: 'var(--font-caption-montserrat), "Montserrat", ui-sans-serif, sans-serif',
  Anton: 'var(--font-caption-anton), "Anton", Impact, ui-sans-serif, sans-serif',
  Poppins: 'var(--font-caption-poppins), "Poppins", ui-sans-serif, sans-serif',
  Inter: 'var(--font-caption-inter), "Inter", ui-sans-serif, sans-serif',
  Roboto: 'var(--font-caption-roboto), "Roboto", ui-sans-serif, sans-serif',
  Impact: 'Impact, Haettenschweiler, "Arial Black", ui-sans-serif, sans-serif',
};

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
  return language === "hinglish"
    ? "Yeh moment bilkul viral hone wala hai"
    : "This is the moment that changes everything";
}

export function resolveCaptionStyle(
  presetId: string,
  settings?: CaptionSettings | Record<string, unknown> | null,
): CaptionStyle {
  const base = CAPTION_PRESETS.find((p) => p.id === presetId) ?? CAPTION_PRESETS[0];
  if (!settings || typeof settings !== "object") return base;

  const s = settings as CaptionSettings;
  return {
    ...base,
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

/** Diff against preset so we only persist real overrides. */
export function captionSettingsDiff(
  presetId: string,
  style: CaptionStyle,
): CaptionSettings {
  const base = CAPTION_PRESETS.find((p) => p.id === presetId) ?? CAPTION_PRESETS[0];
  const keys: (keyof CaptionSettings)[] = [
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
  const out: CaptionSettings = {};
  for (const key of keys) {
    if (style[key] !== base[key]) {
      Object.assign(out, { [key]: style[key] });
    }
  }
  return out;
}
