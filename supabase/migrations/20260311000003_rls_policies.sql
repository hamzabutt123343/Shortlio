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
