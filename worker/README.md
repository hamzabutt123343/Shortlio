# Shortlio video worker / desktop engine

**Product path:** the Windows EXE runs `local_runner.py` per job (JWT → `/api/desktop/*`, clips → `Videos\Shortlio`). No always-on cloud worker required.

**Dev/optional:** `python main.py` still polls Supabase with the service role for operator testing.

Pipeline (yt-dlp, scout ASR, moments, OpenCV reframe, FFmpeg) is shared.

## Requirements

- **Python 3.11+**
- **ffmpeg** and **ffprobe** on `PATH` (or set `FFMPEG_PATH` / `FFPROBE_PATH`)
- **yt-dlp** on `PATH` (pip package installs the CLI module; ensure `yt-dlp` command works)
- Supabase project with `jobs` table and `claim_next_job` RPC (see `supabase/migrations/20260311000002_claim_job.sql`)
- Optional: NVIDIA GPU + CUDA for faster **faster-whisper** (`WHISPER_DEVICE=cuda`)
- Optional: **MediaPipe** for better face detection (installed via `requirements.txt`; skipped gracefully if missing)

## Windows setup

1. Install [Python 3.11+](https://www.python.org/downloads/windows/) and check **Add to PATH**.
2. Install ffmpeg (e.g. [gyan.dev builds](https://www.gyan.dev/ffmpeg/builds/)) and add `ffmpeg.exe` / `ffprobe.exe` to PATH.
3. Open PowerShell in `D:\shortlio\worker`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
python main.py
```

## Environment

See `.env.example`. Important defaults:

| Variable | Default | Notes |
|----------|---------|--------|
| `TRANSCRIPTION_PROVIDER` | `local_faster_whisper` | Or `groq` with `GROQ_API_KEY` |
| `LLM_PROVIDER` | `heuristic` | Free offline scoring; or `groq` / `gemini` |
| `WORKER_CONCURRENCY` | `2` | Parallel jobs (thread pool) |
| `TEMP_DIR` | `./tmp/shortlio-worker` | Cache for idempotent retries |

## Job payload (JSON)

The web app should insert rows into `jobs` with `status = 'queued'` and a `payload` like:

```json
{
  "source_url": "https://www.youtube.com/watch?v=...",
  "clip_count": 3,
  "max_clip_duration": 60,
  "aspect_ratio": "9:16",
  "caption_preset": "classic_white",
  "language": "en",
  "quality": "balanced",
  "cleanup_temp": true
}
```

`source_url` must be a public `http`/`https` URL (private IPs and localhost are rejected).

## Progress stages

`progress_stage` transitions: `fetching_transcript` → `transcribing_audio` → `analyzing_moments` → `fetching_selected_segments` → `detecting_subjects` → `rendering_clips` → `ready` (or `failed` / `cancelled`).

Set job `status` to `cancelled` (or `progress_stage` to `cancelled`) to stop in-flight work.

## Caption presets

`classic_white`, `bold_yellow`, `karaoke_highlight`, `word_by_word_pop`, `clean_minimal`, `neon_accent`, `podcast_bold`, `creator_style`

## Supabase storage

Create a public or private bucket named **`clips`**. The worker uploads `job_id/clip_NNN.mp4` and stores signed URLs in `jobs.result`.

## Suggested `jobs` columns

If you are defining the table from scratch, include at minimum:

- `id` uuid PK, `user_id` uuid, `source_url` text (optional if only in payload)
- `status` text, `progress_stage` text, `progress_pct` float
- `payload` jsonb, `result` jsonb, `error_message` text
- `worker_id` text, `heartbeat_at` timestamptz
- `created_at`, `updated_at`, `started_at`, `completed_at` timestamptz

Apply the claim migration after the table exists.

The worker upserts `worker_heartbeats` on each poll and writes transcript segments, clip candidates, and clips to Postgres (see `db.py`).
