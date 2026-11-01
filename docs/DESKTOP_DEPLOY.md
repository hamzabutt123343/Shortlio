# Shortlio desktop deployment

Shortlio is a **Windows desktop-first** product. Users install the EXE and process video on their PC. The website (Vercel) handles auth, billing, usage limits, and a secure Groq Whisper proxy.

This document prepares production — it does **not** deploy for you.

## Architecture reminder

| Component | Host | Secrets |
|-----------|------|---------|
| Next.js website | Vercel | `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, billing keys |
| Windows EXE | GitHub Releases | **None** — only user JWT at runtime + public `appUrl` |
| Python engine | Bundled inside EXE | Receives `SHORTLIO_ACCESS_TOKEN` from Electron session |

Never put `GROQ_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in `desktop/`, `app-config.json`, or `extraResources`.

## 1. Vercel (website + desktop APIs)

1. Import the GitHub repo into Vercel (Next.js).
2. Set environment variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Same project as Auth |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server only |
| `NEXT_PUBLIC_APP_URL` | Yes | e.g. `https://your-app.vercel.app` |
| `GROQ_API_KEY` | Yes for Whisper | Used by `/api/desktop/ai/transcribe` |
| `LLM_PROVIDER` | Optional | `heuristic` (default) / `groq` / `gemini` |
| Billing keys | Optional | Lemon/Stripe if used |

3. Supabase Auth → URL configuration: add production origin to Site URL + Redirect URLs.
4. Deploy. Confirm `GET /api/health` and that `/api/desktop/engine-config` returns 401 without auth.

## 2. Bundle the Windows engine

On a Windows build machine (or in CI):

```powershell
cd desktop
npm ci
powershell -ExecutionPolicy Bypass -File .\scripts\bundle-engine.ps1
```

`bundle-engine.ps1` copies a **relocatable** CPython into `resources/engine/python/` (full `sys.base_prefix` tree + pip deps). Do **not** ship a Windows `venv` — its `pyvenv.cfg` `home=` points at the build machine (e.g. GitHub `hostedtoolcache`) and fails on user PCs with exit 103.

Then place binaries (not committed to git):

- `desktop/resources/ffmpeg/ffmpeg.exe`
- `desktop/resources/ffmpeg/ffprobe.exe`
- `desktop/resources/node/node.exe` (portable Node 20 x64)

Recommended FFmpeg: official/static Windows builds (gyan.dev essentials).

## 3. Package the EXE

```powershell
cd desktop
# Bake production URL
node -e "require('fs').writeFileSync('app-config.json', JSON.stringify({ appUrl: 'https://YOUR_APP.vercel.app' }, null, 2))"
npm run dist:win
```

Artifacts: `desktop/dist/*.exe` (NSIS + portable).

### GitHub Actions

1. Repo → Settings → Variables → `SHORTLIO_APP_URL` = production site (no trailing slash).
2. Tag: `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`
3. Workflow [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml):
   - Runs `bundle-engine.ps1`
   - Expects FFmpeg/Node as cached artifacts or download steps you configure
   - Secret-scans the package tree for leaked keys
   - Uploads `.exe` to the GitHub Release

## 4. Desktop runtime env (injected by Electron — do not bake secrets)

| Variable | Value |
|----------|-------|
| `SHORTLIO_API_URL` | From `app-config.json` / `SHORTLIO_APP_URL` |
| `SHORTLIO_ACCESS_TOKEN` | User session access token |
| `SHORTLIO_TOKEN_FILE` | Temp file Electron refreshes for long jobs |
| `TEMP_DIR` | `%APPDATA%\shortlio-desktop\cache` (Electron userData) |
| `OUTPUT_DIR` | `%USERPROFILE%\Videos\Shortlio` |
| `OUTPUT_MODE` | `local` |
| `TRANSCRIPTION_PROVIDER` | `groq_proxy` |
| `LLM_PROVIDER` | `heuristic` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Bundled paths |
| `YTDLP_JS_RUNTIME` | `node` (bundled on PATH) |

## 5. Smoke test checklist

- [ ] Browser `/create` shows download CTA (no processing form)
- [ ] Desktop app loads production URL and exposes `window.shortlioDesktop`
- [ ] Sign in → create project → job moves `queued` → `processing` → `ready`
- [ ] MP4 appears under `Videos\Shortlio\<job-id>\`
- [ ] Free plan quota blocks at 3 clips/day (server `reserve_clip_quota`)
- [ ] Packaged tree has **no** `GROQ_API_KEY` / `SERVICE_ROLE` strings (`npm run` CI scan)

## 6. Optional: local cloud worker (operators only)

`worker/main.py` poll loop remains for your own debugging. Customers do not need it. Do not require Railway for the product path.

## 7. Scaling more desktop users

Each user runs their own engine — horizontal scale is free on the media side. Scale Vercel/Supabase for auth, quota RPCs, and Groq proxy traffic. Add rate limits on `/api/desktop/ai/transcribe` if abuse appears.
