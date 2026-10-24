/** Smart framing modes shared by dashboard create + clip editor. */

export type FramingMode =
  | "smart_auto"
  | "speaker_cuts"
  | "single_subject"
  | "split_stack"
  | "reaction_stack"
  | "static";

export type CropLayout = "single" | "split_stack" | "reaction_stack";

export type StackDirection = "top_bottom" | "bottom_top" | "side_by_side";
export type FitMode = "contain" | "cover";

export type CropSettings = {
  focal_x: number;
  mode: "auto" | "manual_override";
  speaker_focus: boolean;
  tracking_mode: "hard_cut" | "subject";
  layout: CropLayout;
  /** Dual layouts only — where the primary (reactor) panel sits. */
  stack_direction?: StackDirection;
  /** Dual layouts only — primary panel share of the canvas (0.25–0.75). */
  panel_ratio?: number;
  /** Dual layouts — contain = fit + blur fill; cover = fill + crop. */
  fit_mode?: FitMode;
};

export const DEFAULT_FRAMING_MODE: FramingMode = "smart_auto";

export const STACK_DIRECTION_OPTIONS: {
  id: StackDirection;
  label: string;
}[] = [
  { id: "top_bottom", label: "Top / Bottom (reactor on top)" },
  { id: "bottom_top", label: "Bottom / Top (reactor on bottom)" },
  { id: "side_by_side", label: "Side by Side (reactor left)" },
];

export const FIT_MODE_OPTIONS: {
  id: FitMode;
  label: string;
  description: string;
}[] = [
  {
    id: "contain",
    label: "Fit + blur fill",
    description: "Keep people fully visible; fill unused panel space with a blurred background.",
  },
  {
    id: "cover",
    label: "Fill panel (crop)",
    description: "Zoom to fill the panel. May crop edges.",
  },
];

export const FRAMING_OPTIONS: {
  id: FramingMode;
  label: string;
  description: string;
}[] = [
  {
    id: "smart_auto",
    label: "Smart Auto (recommended)",
    description: "Detects speakers and cuts between them. Default for most videos.",
  },
  {
    id: "speaker_cuts",
    label: "Active Speaker Cuts",
    description: "Hard cuts between speakers with no panning.",
  },
  {
    id: "split_stack",
    label: "Split Stack (2 people)",
    description: "Both people at once — one on top, one on bottom. Podcasts & interviews.",
  },
  {
    id: "reaction_stack",
    label: "Reaction Stack",
    description: "Reactor and reacted-to content in separate panels with independent framing.",
  },
  {
    id: "single_subject",
    label: "Single Subject Tracking",
    description: "Smooth follow of one person. Solo, gaming, IRL.",
  },
  {
    id: "static",
    label: "Static Position",
    description: "Fixed crop at center (edit Focal X later in the clip editor).",
  },
];

function clampPanelRatio(n: number | undefined): number {
  if (!Number.isFinite(n as number)) return 0.5;
  return Math.min(0.75, Math.max(0.25, n as number));
}

/** Map a framing mode to crop_settings persisted on jobs/clips. */
export function cropSettingsForFramingMode(
  mode: FramingMode,
  focalX = 0.5,
  extras?: {
    stackDirection?: StackDirection;
    panelRatio?: number;
    fitMode?: FitMode;
  },
): CropSettings {
  const fx = Number.isFinite(focalX) ? Math.min(1, Math.max(0, focalX)) : 0.5;
  const stackDirection = extras?.stackDirection ?? "top_bottom";
  const panelRatio = clampPanelRatio(extras?.panelRatio);
  const fitMode = extras?.fitMode;

  if (mode === "split_stack") {
    return {
      focal_x: fx,
      mode: "auto",
      speaker_focus: false,
      tracking_mode: "subject",
      layout: "split_stack",
      stack_direction: stackDirection,
      panel_ratio: panelRatio,
      fit_mode: fitMode ?? "cover",
    };
  }
  if (mode === "reaction_stack") {
    return {
      focal_x: fx,
      mode: "auto",
      speaker_focus: false,
      tracking_mode: "subject",
      layout: "reaction_stack",
      stack_direction: stackDirection,
      panel_ratio: panelRatio,
      fit_mode: fitMode ?? "contain",
    };
  }
  if (mode === "static") {
    return {
      focal_x: fx,
      mode: "manual_override",
      speaker_focus: false,
      tracking_mode: "hard_cut",
      layout: "single",
    };
  }
  if (mode === "speaker_cuts") {
    return {
      focal_x: fx,
      mode: "auto",
      speaker_focus: true,
      tracking_mode: "hard_cut",
      layout: "single",
    };
  }
  if (mode === "single_subject") {
    return {
      focal_x: fx,
      mode: "auto",
      speaker_focus: false,
      tracking_mode: "subject",
      layout: "single",
    };
  }
  // smart_auto — current default
  return {
    focal_x: fx,
    mode: "auto",
    speaker_focus: true,
    tracking_mode: "hard_cut",
    layout: "single",
  };
}

export function framingModeFromCropSettings(
  raw: Record<string, unknown> | null | undefined,
): FramingMode {
  if (!raw || typeof raw !== "object") return DEFAULT_FRAMING_MODE;
  const layout = String(raw.layout || "single");
  if (layout === "split_stack") return "split_stack";
  if (layout === "reaction_stack") return "reaction_stack";
  if (raw.mode === "manual_override" || raw.mode === "manual") return "static";
  const speakerFocus =
    raw.speaker_focus === undefined && raw.smart_speaker_switch === undefined
      ? true
      : Boolean(raw.speaker_focus ?? raw.smart_speaker_switch);
  // smart_auto and speaker_cuts share the same crop payload; prefer the default label.
  if (speakerFocus) return DEFAULT_FRAMING_MODE;
  if (raw.tracking_mode === "subject" || raw.tracking_mode === "smooth") {
    return "single_subject";
  }
  return DEFAULT_FRAMING_MODE;
}

export function stackDirectionFromCropSettings(
  raw: Record<string, unknown> | null | undefined,
): StackDirection {
  const v = String(raw?.stack_direction || raw?.stack || "top_bottom");
  if (v === "bottom_top" || v === "side_by_side" || v === "top_bottom") return v;
  return "top_bottom";
}

export function panelRatioFromCropSettings(
  raw: Record<string, unknown> | null | undefined,
): number {
  const n = Number(raw?.panel_ratio ?? 0.5);
  return clampPanelRatio(n);
}

export function fitModeFromCropSettings(
  raw: Record<string, unknown> | null | undefined,
  framingMode: FramingMode,
): FitMode {
  const v = String(raw?.fit_mode || "");
  if (v === "cover" || v === "fill" || v === "crop") return "cover";
  if (v === "contain" || v === "fit" || v === "blur" || v === "letterbox") return "contain";
  return framingMode === "reaction_stack" ? "contain" : "cover";
}
