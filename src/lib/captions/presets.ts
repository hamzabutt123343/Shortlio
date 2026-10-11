import type { CaptionPresetId } from "@/lib/types";

export interface CaptionStyle {
  id: CaptionPresetId;
  name: string;
  description: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  shadow: boolean;
  position: "bottom" | "center" | "top";
  maxWordsPerCaption: number;
  animation: "none" | "fade" | "pop" | "karaoke" | "word_pop";
}

export const CAPTION_PRESETS: CaptionStyle[] = [
  {
    id: "classic_white",
    name: "Classic White",
    description: "Clean white captions with a soft outline",
    fontFamily: "Montserrat",
    fontSize: 54,
    fontWeight: 700,
    textColor: "#FFFFFF",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 3,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    shadow: true,
    position: "bottom",
    maxWordsPerCaption: 6,
    animation: "fade",
  },
  {
    id: "bold_yellow",
    name: "Bold Yellow",
    description: "High-contrast yellow for punchy hooks",
    fontFamily: "Impact",
    fontSize: 58,
    fontWeight: 800,
    textColor: "#FFE566",
    highlightColor: "#FFFFFF",
    outlineColor: "#111111",
    outlineWidth: 4,
    backgroundColor: "#000000",
    backgroundOpacity: 0.15,
    shadow: true,
    position: "bottom",
    maxWordsPerCaption: 5,
    animation: "pop",
  },
  {
    id: "karaoke_highlight",
    name: "Karaoke Highlight",
    description: "Word-by-word highlight as speech progresses",
    fontFamily: "Montserrat",
    fontSize: 52,
    fontWeight: 700,
    textColor: "#E8E8E8",
    highlightColor: "#3DD6C6",
    outlineColor: "#0A0A0A",
    outlineWidth: 3,
    backgroundColor: "#000000",
    backgroundOpacity: 0.35,
    shadow: false,
    position: "bottom",
    maxWordsPerCaption: 8,
    animation: "karaoke",
  },
  {
    id: "word_by_word_pop",
    name: "Word-by-Word Pop",
    description: "One emphatic word at a time",
    fontFamily: "Anton",
    fontSize: 72,
    fontWeight: 700,
    textColor: "#FFFFFF",
    highlightColor: "#FF6B4A",
    outlineColor: "#000000",
    outlineWidth: 5,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    shadow: true,
    position: "center",
    maxWordsPerCaption: 1,
    animation: "word_pop",
  },
  {
    id: "clean_minimal",
    name: "Clean Minimal",
    description: "Quiet, readable subtitles",
    fontFamily: "Inter",
    fontSize: 42,
    fontWeight: 500,
    textColor: "#F5F5F5",
    highlightColor: "#F5F5F5",
    outlineColor: "#222222",
    outlineWidth: 1,
    backgroundColor: "#000000",
    backgroundOpacity: 0.45,
    shadow: false,
    position: "bottom",
    maxWordsPerCaption: 10,
    animation: "fade",
  },
  {
    id: "neon_accent",
    name: "Neon Accent",
    description: "Bright accent highlight on dark video",
    fontFamily: "Montserrat",
    fontSize: 56,
    fontWeight: 800,
    textColor: "#FFFFFF",
    highlightColor: "#7CFFB2",
    outlineColor: "#04140C",
    outlineWidth: 3,
    backgroundColor: "#000000",
    backgroundOpacity: 0.2,
    shadow: true,
    position: "bottom",
    maxWordsPerCaption: 5,
    animation: "karaoke",
  },
  {
    id: "podcast_bold",
    name: "Podcast Bold",
    description: "Large lower-third style for talk content",
    fontFamily: "Roboto",
    fontSize: 48,
    fontWeight: 700,
    textColor: "#FAFAFA",
    highlightColor: "#F0C14B",
    outlineColor: "#000000",
    outlineWidth: 2,
    backgroundColor: "#111111",
    backgroundOpacity: 0.55,
    shadow: false,
    position: "bottom",
    maxWordsPerCaption: 8,
    animation: "fade",
  },
  {
    id: "creator_style",
    name: "Creator Style",
    description: "Modern stacked captions for short-form",
    fontFamily: "Poppins",
    fontSize: 56,
    fontWeight: 700,
    textColor: "#FFFFFF",
    highlightColor: "#FF4D6D",
    outlineColor: "#000000",
    outlineWidth: 4,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    shadow: true,
    position: "center",
    maxWordsPerCaption: 4,
    animation: "pop",
  },
];

export function getCaptionPreset(id: string): CaptionStyle {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];
}
