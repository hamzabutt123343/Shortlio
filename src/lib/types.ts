export type Plan = "free" | "pro";

export type ProjectStatus =
  | "draft"
  | "queued"
  | "processing"
  | "awaiting_selection"
  | "rendering"
  | "ready"
  | "failed"
  | "cancelled";

export type JobStatus = "queued" | "processing" | "ready" | "failed" | "cancelled";

export type ProgressStage =
  | "queued"
  | "fetching_transcript"
  | "transcribing_audio"
  | "analyzing_moments"
  | "fetching_selected_segments"
  | "detecting_subjects"
  | "rendering_clips"
  | "ready"
  | "failed"
  | "cancelled";

export type AspectRatio = "9:16" | "1:1" | "16:9";
export type PlatformPreset = "youtube_shorts" | "tiktok" | "instagram_reels" | "custom";
export type CaptionLanguage = "en" | "hinglish" | "hi" | "ur" | "ar" | "auto" | string;

export type CaptionPresetId =
  | "classic_white"
  | "bold_yellow"
  | "karaoke_highlight"
  | "word_by_word_pop"
  | "clean_minimal"
  | "neon_accent"
  | "podcast_bold"
  | "creator_style"
  | "cinematic_box"
  | "gaming_hype"
  | "typewriter";

export interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  plan: Plan;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface Project {
  id: string;
  user_id: string;
  source_url: string;
  source_platform: string | null;
  source_title: string | null;
  source_duration: number | null;
  source_metadata: Record<string, unknown>;
  status: ProjectStatus;
  requested_clip_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  project_id: string | null;
  user_id: string;
  status: JobStatus;
  job_type: string;
  requested_clip_count: number;
  progress_stage: ProgressStage | string;
  progress_pct: number;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegment {
  id: string;
  project_id: string;
  start_time: number;
  end_time: number;
  text: string;
  speaker_id: string | null;
  language: string | null;
}

export interface ClipCandidate {
  id: string;
  project_id: string;
  start_time: number;
  end_time: number;
  title: string;
  hook: string | null;
  score: number;
  explanation: string | null;
  confidence: number | null;
  recommended_duration: number | null;
  selected: boolean;
  created_at: string;
}

export interface Clip {
  id: string;
  project_id: string;
  user_id: string;
  candidate_id: string | null;
  job_id: string | null;
  title: string;
  start_time: number;
  end_time: number;
  output_format: AspectRatio | string;
  resolution: string;
  platform_preset: string | null;
  caption_language: string;
  caption_preset: string;
  caption_text: unknown[];
  caption_settings: Record<string, unknown>;
  burn_captions: boolean;
  quality: string;
  crop_settings: Record<string, unknown>;
  render_status: "pending" | "rendering" | "ready" | "failed";
  storage_path: string | null;
  thumbnail_path: string | null;
  duration: number | null;
  reframe_warning: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageInfo {
  plan: Plan;
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
  timezone: "UTC";
}

export const FREE_DAILY_CLIP_LIMIT = 3;
export const CLIP_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  fetching_transcript: "Fetching transcript",
  transcribing_audio: "Transcribing audio",
  analyzing_moments: "Analyzing moments",
  fetching_selected_segments: "Fetching selected segments",
  detecting_subjects: "Detecting subjects",
  rendering_clips: "Rendering clips",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
  // Legacy values accidentally stored via str(Enum) on Python 3.11+
  "ProgressStage.FETCHING_TRANSCRIPT": "Fetching transcript",
  "ProgressStage.TRANSCRIBING_AUDIO": "Transcribing audio",
  "ProgressStage.ANALYZING_MOMENTS": "Analyzing moments",
  "ProgressStage.FETCHING_SELECTED_SEGMENTS": "Fetching selected segments",
  "ProgressStage.DETECTING_SUBJECTS": "Detecting subjects",
  "ProgressStage.RENDERING_CLIPS": "Rendering clips",
  "ProgressStage.READY": "Ready",
  "ProgressStage.FAILED": "Failed",
  "ProgressStage.CANCELLED": "Cancelled",
};
