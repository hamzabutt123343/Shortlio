-- Viral metadata for platform-specific titles/captions/hashtags (per clip)
ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS viral_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clips.viral_metadata IS
  'Platform publish metadata: youtube/tiktok/instagram fields generated from clip transcript';
