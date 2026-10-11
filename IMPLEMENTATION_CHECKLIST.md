# Shortlio implementation checklist

## Completed (code present)

- [x] Next.js 16 + TypeScript + Tailwind App Router scaffold
- [x] Supabase auth (signup, login, reset password, proxy session refresh)
- [x] Database schema: profiles, subscriptions, projects, jobs, transcript_segments, clip_candidates, clips, usage_events, billing_events, worker_heartbeats
- [x] RLS policies + `claim_next_job` + quota RPCs
- [x] Dashboard, project live progress, clip editor, settings, billing pages
- [x] Landing + pricing (dark charcoal creator-tool UI)
- [x] URL validation + SSRF/private-IP rejection
- [x] API: projects, jobs cancel, clips CRUD/re-render, downloads, usage, billing webhook/checkout
- [x] Free plan daily quota (3 successful clips / UTC day) with reservation + release
- [x] Pro plan billing adapters (Lemon Squeezy default, Stripe optional)
- [x] Caption presets (8 styles) + English/Hinglish options in UI
- [x] Python worker: transcript-first, moments, segment download, reframe, captions, render, storage
- [x] Worker heartbeats + DB persistence of transcripts/candidates/clips
- [x] Worker-unavailable messaging when heartbeats stale
- [x] Unit tests for URL validation and caption presets
- [x] README + `.env.example`

## Partial / needs configuration or hardware

- [ ] Supabase project + migrations applied (operator step)
- [ ] Storage bucket `clips` created
- [ ] Billing provider test keys + webhook endpoint
- [ ] Local Whisper model download on first worker run
- [ ] Optional Groq/Gemini free-tier keys for cloud LLM transcription/analysis
- [ ] End-to-end render verified on your machine (needs ffmpeg, yt-dlp, sample public URL)
- [ ] MediaPipe optional path (graceful if missing)
- [ ] Multi-instance rate limiting (in-memory today; use Redis/edge for scale)

## Not claimed as complete without your env

- Live payment of $10 Pro (requires your merchant account eligibility)
- Guaranteed partial-download speed for every platform CDN
- Unlimited free cloud AI (quotas apply; heuristic/local fallbacks stay available)
