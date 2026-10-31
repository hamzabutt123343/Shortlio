# Shortlio

AI-powered long-form → short-form clipping SaaS for **Windows desktop**. Transcript-first analysis, viral-moment ranking, smart speaker reframing, animated captions, local FFmpeg rendering, free/Pro quotas, and provider-independent billing.

**Product model:** users download the Windows EXE, sign in, and process YouTube / Kick / Twitch on their own PC. The website handles registration, billing, usage, and installer download — not browser-based video processing.

## Architecture

| Piece | Role |
|-------|------|
| **Next.js (Vercel)** | Marketing, auth, billing, quota APIs, secure Groq Whisper proxy, desktop job APIs |
| **Supabase** | Auth, PostgreSQL + RLS, usage/quota RPCs (optional Storage for legacy cloud paths) |
| **Windows EXE (`desktop/`)** | Electron shell + bundled Python engine (yt-dlp, OpenCV, FFmpeg). Saves clips under `Videos\Shortlio` |
| **Python engine (`worker/`)** | Same pipeline as before; desktop runs `local_runner.py` per job. `main.py` poll loop is **dev/optional** only |

```
Website (auth/billing/download) ──► Windows EXE ──► local_runner (pipeline)
                                         │
                                         └── JWT ──► /api/desktop/* + Groq proxy
```

API secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`) stay on the server. The EXE only receives the user’s session access token.

## Prerequisites (development)

- Node.js 20.9+
- Python 3.11+ (for local engine / worker)
- [FFmpeg](https://ffmpeg.org/) and `ffprobe` on `PATH` (bundled in release builds)
- A free [Supabase](https://supabase.com) project
- Optional: `GROQ_API_KEY` for desktop Whisper via `/api/desktop/ai/transcribe`

## 1. Database setup

1. Create a Supabase project.
2. In the SQL editor, run migrations in order under `supabase/migrations/`.
3. Storage → create a **private** bucket named `clips` (optional for desktop-local output).
4. Auth → enable Email provider.

## 2. Web app

```powershell
cd D:\shortlio
copy .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In a **browser**, Create shows a download CTA. Processing UI unlocks inside the desktop shell.

## 3. Desktop app (primary product)

```powershell
cd D:\shortlio\desktop
npm install
# Optional: prepare bundled engine layout for packaging
# powershell -File .\scripts\bundle-engine.ps1
$env:SHORTLIO_APP_URL="http://localhost:3000"
npm run dev
```

Dev mode falls back to `worker\.venv\Scripts\python.exe` and `worker\local_runner.py` when `desktop/resources/engine` is missing.

Release packaging: see [docs/DESKTOP_DEPLOY.md](./docs/DESKTOP_DEPLOY.md).

## 4. Dev/optional cloud worker

Not required for customers. Operators can still run:

```powershell
cd D:\shortlio\worker
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python main.py
```

## Plans & billing

| Plan | Price | Limits |
|------|-------|--------|
| Basic (Free) | Free | 3 **successful** clips per **UTC** day (server-enforced) |
| Pro | **Rs 500 lifetime** | Unlimited under fair-use / capacity |

Purchases: [discord.gg/yaWrgpnya5](https://discord.gg/yaWrgpnya5). Activate Pro in Supabase (`profiles.plan` / subscriptions).

## Pipeline (honest behavior)

1. Validate public URL (SSRF / private IP blocked).
2. Fetch captions when available; else audio + Groq Whisper proxy (desktop) or local faster-whisper (dev).
3. Rank candidate moments (heuristic by default).
4. Download selected ranges; reframe; burn captions; write MP4 to `Videos\Shortlio`.
5. Register clip metadata + confirm quota via `/api/desktop/*`.

## Security notes

- Service role + Groq keys: server only — never in the EXE or `extraResources`.
- Desktop sidecar authenticates with the user JWT.
- Daily limits enforced by `reserve_clip_quota` / `confirm_clip_success` on the backend.
- Users must have rights to process/republish source media.

## Project layout

```
src/app          Next.js pages + API (incl. /api/desktop)
src/lib          Auth, quota, billing, desktop bridge
src/components   UI (DesktopRequired gate)
worker/          Python pipeline + local_runner.py
desktop/         Electron + engine spawn + bundle scripts
docs/            DESKTOP_DEPLOY.md
supabase/        SQL migrations
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Browser cannot create clips | Expected — install Windows app |
| Job stays queued in desktop | Engine bundled? See `engine:status` / `bundle-engine.ps1` |
| Auth errors | `.env.local` Supabase URL/anon key; redirect URLs |
| Whisper fails | `GROQ_API_KEY` on Vercel/web for proxy |
| Quota wrong after failure | `usage_events` should show `clip_release` for the job |

## Status

See [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) and [docs/DESKTOP_DEPLOY.md](./docs/DESKTOP_DEPLOY.md).
