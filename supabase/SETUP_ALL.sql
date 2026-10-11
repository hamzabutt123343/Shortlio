-- Shortlio core schema
-- Apply via Supabase SQL editor or `supabase db push`

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'lemon_squeezy',
  provider_customer_id text,
  provider_subscription_id text,
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive', 'active', 'past_due', 'cancelled', 'expired', 'trialing')),
  plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro')),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_provider_sub_idx
  ON public.subscriptions (provider_subscription_id);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_platform text,
  source_title text,
  source_duration double precision,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'queued', 'processing', 'awaiting_selection',
      'rendering', 'ready', 'failed', 'cancelled'
    )),
  requested_clip_count integer NOT NULL DEFAULT 3,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON public.projects (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- jobs (worker-compatible)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'cancelled')),
  job_type text NOT NULL DEFAULT 'full_pipeline'
    CHECK (job_type IN ('analyze', 'render', 'full_pipeline', 're_render')),
  requested_clip_count integer NOT NULL DEFAULT 3,
  progress_stage text NOT NULL DEFAULT 'queued',
  progress_pct double precision NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  worker_id text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON public.jobs (status, created_at ASC);
CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON public.jobs (project_id);
CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON public.jobs (user_id);

-- ---------------------------------------------------------------------------
-- transcript_segments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  start_time double precision NOT NULL,
  end_time double precision NOT NULL,
  text text NOT NULL,
  speaker_id text,
  language text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS transcript_segments_project_idx
  ON public.transcript_segments (project_id, start_time);

-- ---------------------------------------------------------------------------
-- clip_candidates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clip_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  start_time double precision NOT NULL,
  end_time double precision NOT NULL,
  title text NOT NULL DEFAULT 'Clip',
  hook text,
  score double precision NOT NULL DEFAULT 0,
  explanation text,
  confidence double precision,
  recommended_duration double precision,
  selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS clip_candidates_project_score_idx
  ON public.clip_candidates (project_id, score DESC);

-- ---------------------------------------------------------------------------
-- clips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.clip_candidates (id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs (id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Clip',
  start_time double precision NOT NULL,
  end_time double precision NOT NULL,
  output_format text NOT NULL DEFAULT '9:16',
  resolution text NOT NULL DEFAULT '1080x1920',
  platform_preset text,
  caption_language text NOT NULL DEFAULT 'en',
  caption_preset text NOT NULL DEFAULT 'classic_white',
  caption_text jsonb NOT NULL DEFAULT '[]'::jsonb,
  caption_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  burn_captions boolean NOT NULL DEFAULT true,
  quality text NOT NULL DEFAULT 'balanced',
  crop_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  render_status text NOT NULL DEFAULT 'pending'
    CHECK (render_status IN ('pending', 'rendering', 'ready', 'failed')),
  storage_path text,
  thumbnail_path text,
  duration double precision,
  reframe_warning boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS clips_user_id_idx ON public.clips (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clips_project_id_idx ON public.clips (project_id);

-- ---------------------------------------------------------------------------
-- usage_events (auditable quota)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('clip_success', 'clip_reserved', 'clip_release', 'job_started')),
  quantity integer NOT NULL DEFAULT 1,
  job_id uuid REFERENCES public.jobs (id) ON DELETE SET NULL,
  clip_id uuid REFERENCES public.clips (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_clip_success_unique
  ON public.usage_events (clip_id)
  WHERE event_type = 'clip_success' AND clip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_user_day_idx
  ON public.usage_events (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- billing_events (webhook idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- worker_heartbeats (optional visibility)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS jobs_updated_at ON public.jobs;
CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS clips_updated_at ON public.clips;
CREATE TRIGGER clips_updated_at
  BEFORE UPDATE ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile + free subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'inactive')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Daily free quota: successful clips in UTC day (default 3)
CREATE OR REPLACE FUNCTION public.count_daily_clip_success(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND event_type = 'clip_success'
    AND created_at >= date_trunc('day', timezone('utc', now()))
    AND created_at < date_trunc('day', timezone('utc', now())) + interval '1 day';
$$;

CREATE OR REPLACE FUNCTION public.user_plan(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = p_user_id
        AND s.plan = 'pro'
        AND s.status IN ('active', 'trialing')
        AND (s.current_period_end IS NULL OR s.current_period_end > timezone('utc', now()))
    ) THEN 'pro'
    ELSE 'free'
  END;
$$;

-- Atomically reserve free-plan clip quota before enqueueing render work
CREATE OR REPLACE FUNCTION public.reserve_clip_quota(
  p_user_id uuid,
  p_quantity integer,
  p_job_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_used integer;
  v_limit integer := 3;
  v_remaining integer;
BEGIN
  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;

  v_plan := public.user_plan(p_user_id);
  IF v_plan = 'pro' THEN
    INSERT INTO public.usage_events (user_id, event_type, quantity, job_id, metadata)
    VALUES (p_user_id, 'job_started', p_quantity, p_job_id, jsonb_build_object('plan', 'pro'));
    RETURN jsonb_build_object('ok', true, 'plan', 'pro', 'remaining', null);
  END IF;

  -- Lock user subscription row to serialize concurrent reservations
  PERFORM 1 FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (user_id, plan, status)
    VALUES (p_user_id, 'free', 'inactive');
  END IF;

  v_used := public.count_daily_clip_success(p_user_id);
  -- In-flight reservations: reserved minus released (UTC day)
  v_used := v_used + COALESCE((
    SELECT SUM(quantity) FROM public.usage_events
    WHERE user_id = p_user_id
      AND event_type = 'clip_reserved'
      AND created_at >= date_trunc('day', timezone('utc', now()))
  ), 0)::integer;
  v_used := v_used - COALESCE((
    SELECT SUM(quantity) FROM public.usage_events
    WHERE user_id = p_user_id
      AND event_type = 'clip_release'
      AND created_at >= date_trunc('day', timezone('utc', now()))
  ), 0)::integer;
  IF v_used < 0 THEN
    v_used := 0;
  END IF;

  v_remaining := v_limit - v_used;
  IF p_quantity > v_remaining THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'quota_exceeded',
      'plan', 'free',
      'used', v_used,
      'limit', v_limit,
      'remaining', GREATEST(v_remaining, 0)
    );
  END IF;

  INSERT INTO public.usage_events (user_id, event_type, quantity, job_id, metadata)
  VALUES (
    p_user_id,
    'clip_reserved',
    p_quantity,
    p_job_id,
    jsonb_build_object('plan', 'free')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'plan', 'free',
    'used', v_used + p_quantity,
    'limit', v_limit,
    'remaining', v_limit - (v_used + p_quantity)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_clip_success(
  p_user_id uuid,
  p_clip_id uuid,
  p_job_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_events (user_id, event_type, quantity, job_id, clip_id)
  VALUES (p_user_id, 'clip_success', 1, p_job_id, p_clip_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_clip_reservation(
  p_user_id uuid,
  p_job_id uuid,
  p_quantity integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_events (user_id, event_type, quantity, job_id, metadata)
  VALUES (
    p_user_id,
    'clip_release',
    p_quantity,
    p_job_id,
    jsonb_build_object('reason', 'job_failed_or_cancelled')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_daily_clip_success(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_clip_quota(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_clip_success(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_clip_reservation(uuid, uuid, integer) TO service_role;
-- Atomically claim the next queued job (FOR UPDATE SKIP LOCKED).
-- Expects public.jobs with at least: id, status, progress_stage, worker_id,
-- heartbeat_at, started_at, updated_at, created_at.

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.jobs
  SET
    status = 'processing',
    worker_id = p_worker_id,
    heartbeat_at = timezone('utc', now()),
    started_at = COALESCE(started_at, timezone('utc', now())),
    updated_at = timezone('utc', now()),
    progress_stage = COALESCE(NULLIF(progress_stage, 'queued'), 'fetching_transcript')
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_job(text) TO service_role;
-- Row Level Security

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- subscriptions
CREATE POLICY subscriptions_select_own ON public.subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- projects
CREATE POLICY projects_select_own ON public.projects
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY projects_insert_own ON public.projects
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY projects_update_own ON public.projects
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY projects_delete_own ON public.projects
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- jobs
CREATE POLICY jobs_select_own ON public.jobs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY jobs_insert_own ON public.jobs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY jobs_update_own ON public.jobs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- transcript_segments via project ownership
CREATE POLICY transcript_select_own ON public.transcript_segments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  );

CREATE POLICY candidates_select_own ON public.clip_candidates
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  );
CREATE POLICY candidates_update_own ON public.clip_candidates
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  );

-- clips
CREATE POLICY clips_select_own ON public.clips
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY clips_update_own ON public.clips
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY clips_delete_own ON public.clips
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- usage
CREATE POLICY usage_select_own ON public.usage_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- billing_events / worker_heartbeats: service role only (no user policies)

-- Storage bucket policies documented in README; create bucket `clips` in dashboard.
