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
