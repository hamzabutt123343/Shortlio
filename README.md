# Shortlio

AI-powered long-form → short-form clipping SaaS. Transcript-first analysis, viral-moment ranking, smart speaker reframing, animated captions, async FFmpeg rendering, free/Pro quotas, and provider-independent billing.

Built for a **free-first** stack: local `faster-whisper`, heuristic moment scoring, optional free-tier Groq/Gemini, OpenCV reframing, Supabase Auth/DB/Storage, and a separate Python worker.

## Architecture

| Piece | Role |
|-------|------|
| **Next.js (App Router)** | UI, auth session, API routes, billing webhooks, quota reservation |
| **Supabase** | Auth, PostgreSQL + RLS, Storage (`clips` bucket) |
| **Python worker** | Claims jobs via `claim_next_job`, runs yt-dlp / Whisper / OpenCV / FFmpeg |
| **PostgreSQL queue** | Durable jobs table + `FOR UPDATE SKIP LOCKED` (no Redis required) |

Long FFmpeg work never runs inside a web request. If the worker is offline, the dashboard shows a clear **worker unavailable** status; jobs stay `queued`.

## Prerequisites (Windows)

- Node.js 20.9+
- Python 3.11+
- [FFmpeg](https://ffmpeg.org/) and `ffprobe` on `PATH`
- A free [Supabase](https://supabase.com) project
- Optional: GPU for faster local Whisper

## 1. Database setup

1. Create a Supabase project.
2. In the SQL editor, run migrations in order:

   - `supabase/migrations/20260311000001_init_schema.sql`
   - `supabase/migrations/20260311000002_claim_job.sql`
   - `supabase/migrations/20260311000003_rls_policies.sql`

3. Storage → create a **private** bucket named `clips`.
4. Auth → enable Email provider (confirm email optional for local dev).

## 2. Web app

```powershell
cd D:\shortlio
copy .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```powershell
npm run test      # unit tests
npm run lint
npm run build
```

## 3. Video worker

```powershell
cd D:\shortlio\worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same project)
python main.py
```

Defaults:

- `TRANSCRIPTION_PROVIDER=local_faster_whisper` (downloads model on first use; CPU works, GPU faster)
- `LLM_PROVIDER=heuristic` (no API key; free). Optional: `groq` / `gemini` with free-tier keys

Hardware notes:

- Whisper `base` on CPU: acceptable for short sources; large models need more RAM/VRAM.
- Reframing + encoding is CPU/GPU heavy; keep `WORKER_CONCURRENCY=1` on laptops.

## Plans & billing

| Plan | Price | Limits |
|------|-------|--------|
| Free | $0 | 3 **successful** clips per **UTC** day (server-enforced) |
| Pro | $10/mo | Unlimited under fair-use / capacity (no daily UI counter) |

Failed/cancelled jobs release reservations and do not permanently consume successful-clip quota.

Billing adapter: `BILLING_PROVIDER=lemon_squeezy` (default) or `stripe`. Configure test-mode keys only in development. Webhooks are signature-verified and idempotent via `billing_events`.

## Pipeline (honest behavior)

1. Validate public URL (SSRF / private IP blocked).
2. Fetch captions when available; else audio-only download + transcribe.
3. Rank candidate moments (heuristic or optional LLM).
4. Download selected ranges when yt-dlp section seek works; otherwise compliant fallback.
5. Track subject (OpenCV ± MediaPipe), smooth crop, burn captions, upload to Storage.

Partial download efficiency depends on the source CDN. Shortlio reports limitations instead of pretending every source is instant.

## Security notes

- Service role key: server/worker only — never in client bundles.
- RLS on user tables; signed URLs for downloads.
- Subprocess calls use argument lists (no `shell=True` with user input).
- Users must have rights to process/republish source media.

## Project layout

```
src/app          Next.js pages + API
src/lib          Auth, quota, billing, validation, captions
src/components   UI
worker/          Python processing worker
supabase/        SQL migrations
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Jobs stuck in queued | Worker running? `worker_heartbeats` updating? |
| Auth errors | `.env.local` Supabase URL/anon key; redirect URLs |
| Storage upload fails | Bucket `clips` exists; service role key set |
| Whisper slow/OOM | Smaller `WHISPER_MODEL`; close other apps |
| Billing checkout fails | Provider env vars + test mode product/variant |
| Quota wrong after failure | `usage_events` should show `clip_release` for the job |

## Status

See [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) for completed vs configuration-dependent items.
