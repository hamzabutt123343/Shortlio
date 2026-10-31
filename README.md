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
| **Desktop shell (`desktop/`)** | Thin Electron Windows app that loads the same hosted web URL |

Long FFmpeg work never runs inside a web request. If the worker is offline, the dashboard shows a clear **worker unavailable** status; jobs stay `queued`.

Browser and Windows desktop share one backend: same accounts, projects, and cloud rendering. The `.exe` does **not** bundle FFmpeg or the Python worker.

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

## 4. Production deploy (web + worker)

The Windows app is only useful once Shortlio is reachable on a public URL with a running worker.

### Web (Vercel recommended)

1. Import the GitHub repo into [Vercel](https://vercel.com) (Next.js detected automatically).
2. Set env vars from `.env.example` (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, billing keys, etc.).
3. Set `NEXT_PUBLIC_APP_URL` to the production URL (e.g. `https://your-app.vercel.app`).
4. In Supabase Auth → URL configuration, add that origin to **Site URL** and **Redirect URLs**.

### Worker (always-on host)

The worker cannot run on Vercel serverless. Use Railway, Fly.io, a VPS, or any machine that stays online:

1. Deploy `worker/` with Python 3.11+, FFmpeg/`ffprobe` on `PATH`, and `requirements.txt`.
2. Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (same project as the web app).
3. Keep `WORKER_CONCURRENCY` modest on small instances.

Until the worker heartbeats, the dashboard shows **worker unavailable** and jobs remain `queued`.

## 5. Windows desktop shell

Thin Electron wrapper around the hosted site (Discord/Slack pattern).

```powershell
cd D:\shortlio\desktop
npm install
# Dev against local Next:
$env:SHORTLIO_APP_URL="http://localhost:3000"
npm run dev

# Or from repo root:
npm run desktop:dev
```

Production URL is baked into `desktop/app-config.json` at package time (override with env `SHORTLIO_APP_URL`).

### Build installer locally

```powershell
cd D:\shortlio\desktop
# Point the packaged app at your live site before building:
# edit app-config.json → { "appUrl": "https://your-app.vercel.app" }
npm run dist:win
# Artifacts under desktop/dist/ (NSIS installer + portable .exe)
```

### GitHub Release (CI)

1. In the GitHub repo → **Settings → Secrets and variables → Actions → Variables**, add `SHORTLIO_APP_URL` = your production site (no trailing slash).
2. Tag and push:

```powershell
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

3. Workflow [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml) builds on `windows-latest` and attaches `.exe` files to the GitHub Release.
4. Marketing CTAs on `/download` and the landing page link to `https://github.com/hamzabutt123343/Shortlio/releases/latest`.

Manual runs: **Actions → Desktop Windows release → Run workflow** (uploads artifacts; tagged pushes also create a Release).

## Plans & billing

| Plan | Price | Limits |
|------|-------|--------|
| Basic (Free) | Free | 3 **successful** clips per **UTC** day (server-enforced) |
| Pro | **Rs 500 lifetime** | Unlimited under fair-use / capacity (no daily UI counter) |

Purchases are handled on Discord: [discord.gg/yaWrgpnya5](https://discord.gg/yaWrgpnya5). After payment, activate the user’s plan in Supabase (`profiles.plan` / subscriptions) — card checkout is not required for the Discord flow.

Failed/cancelled jobs release reservations and do not permanently consume successful-clip quota.

Legacy card adapters (`BILLING_PROVIDER=lemon_squeezy` / `stripe`) remain in the codebase but the product UI points buyers to Discord.

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
desktop/         Electron Windows shell (loads hosted URL)
supabase/        SQL migrations
.github/         CI (desktop Windows release)
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
