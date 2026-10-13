from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

import httpx

from config import Settings, get_settings, is_youtube_url, run_subprocess, validate_public_http_url, ytdlp_base_args

logger = logging.getLogger(__name__)

ProgressCb = Callable[[float, str], None]


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str
    speaker: str | None = None
    language: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _job_dir(base: Path, job_id: str) -> Path:
    d = base / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def youtube_video_id(url: str) -> str | None:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if host in {"youtu.be", "www.youtu.be"}:
        vid = parsed.path.strip("/").split("/")[0]
        return vid or None
    if "youtube.com" in host or "youtube-nocookie.com" in host:
        qs = parse_qs(parsed.query)
        if qs.get("v"):
            return qs["v"][0]
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live", "v"}:
            return parts[1]
    return None


def _parse_vtt(content: str, language: str = "en") -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    blocks = re.split(r"\n\n+", content.strip())
    time_re = re.compile(
        r"(?P<start>\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(?P<end>\d{2}:\d{2}:\d{2}\.\d{3})"
    )

    def ts_to_sec(ts: str) -> float:
        h, m, s = ts.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)

    for block in blocks:
        lines = block.strip().splitlines()
        if not lines:
            continue
        m = time_re.search(block)
        if not m:
            continue
        start = ts_to_sec(m.group("start"))
        end = ts_to_sec(m.group("end"))
        text_lines = [
            ln
            for ln in lines
            if "-->" not in ln and not ln.startswith("WEBVTT") and not re.match(r"^\d+$", ln)
        ]
        text = re.sub(r"<[^>]+>", "", " ".join(text_lines)).strip()
        if text:
            segments.append(
                TranscriptSegment(start=start, end=end, text=text, language=language)
            )
    return segments


def _parse_json3(data: dict[str, Any], language: str = "en") -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    events = data.get("events") or []
    for ev in events:
        if "segs" not in ev:
            continue
        start = float(ev.get("tStartMs", 0)) / 1000.0
        dur = float(ev.get("dDurationMs", ev.get("d", 0))) / 1000.0
        text = "".join(s.get("utf8", "") for s in ev.get("segs", [])).strip()
        if text:
            segments.append(
                TranscriptSegment(start=start, end=start + max(dur, 0.05), text=text, language=language)
            )
    return segments


def _parse_srv3_xml(content: str, language: str = "en") -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    # <text start="1.2" dur="2.3">Hello</text>
    for m in re.finditer(
        r'<text\s+start="(?P<start>[0-9.]+)"(?:\s+dur="(?P<dur>[0-9.]+)")?[^>]*>(?P<body>.*?)</text>',
        content,
        flags=re.I | re.S,
    ):
        start = float(m.group("start"))
        dur = float(m.group("dur") or 2.0)
        body = re.sub(r"<[^>]+>", "", m.group("body"))
        text = (
            body.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&#39;", "'")
            .replace("&quot;", '"')
            .strip()
        )
        if text:
            segments.append(
                TranscriptSegment(start=start, end=start + max(dur, 0.05), text=text, language=language)
            )
    return segments


_LANG_PREF_EN = ("en", "en-US", "en-GB", "a.en", "hi", "hi-IN", "a.hi")
_LANG_PREF_HI = ("hi", "hi-IN", "a.hi", "en", "en-US", "en-GB", "a.en")
_LANG_PREF_UR = ("ur", "ur-PK", "a.ur", "hi", "hi-IN", "en", "en-US")
_LANG_PREF_AR = ("ar", "ar-SA", "a.ar", "en", "en-US")


def _lang_pref_for(hint: str) -> tuple[str, ...]:
    h = (hint or "en").lower().strip()
    if h in ("hi", "hinglish", "hi-en", "hi_en", "hindi"):
        return _LANG_PREF_HI
    if h in ("ur", "urdu"):
        return _LANG_PREF_UR
    if h in ("ar", "arabic"):
        return _LANG_PREF_AR
    return _LANG_PREF_EN


def _caption_url_with_fmt(base_url: str, fmt: str) -> str:
    """Replace any existing fmt= on timedtext URLs (baseUrl often ships with fmt=srv3)."""
    cleaned = re.sub(r"([?&])fmt=[^&]*", r"\1", base_url)
    cleaned = cleaned.replace("&&", "&").rstrip("&").rstrip("?")
    if not fmt:
        return cleaned
    sep = "&" if "?" in cleaned else "?"
    return f"{cleaned}{sep}fmt={fmt}"


def _innertube_player(vid: str, client: httpx.Client) -> dict[str, Any] | None:
    """YouTube Innertube player — more reliable than scraping the watch HTML."""
    clients = [
        {
            "clientName": "ANDROID",
            "clientVersion": "20.10.38",
            "androidSdkVersion": 30,
            "hl": "en",
            "gl": "US",
        },
        {
            "clientName": "WEB",
            "clientVersion": "2.20250327.00.00",
            "hl": "en",
            "gl": "US",
        },
    ]
    for cl in clients:
        body = {
            "context": {"client": cl},
            "videoId": vid,
            "contentCheckOk": True,
            "racyCheckOk": True,
        }
        resp = client.post(
            "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
            json=body,
        )
        if resp.status_code != 200:
            continue
        data = resp.json()
        status = (data.get("playabilityStatus") or {}).get("status")
        if status in (None, "OK", "LIVE_STREAM_OFFLINE"):
            return data
        logger.info("Innertube %s playability=%s for %s", cl["clientName"], status, vid)
    return None


def fetch_youtube_captions_http(
    url: str,
    *,
    language_hint: str = "en",
) -> list[TranscriptSegment] | None:
    """Pull captions via Innertube — usually seconds vs minutes of Whisper."""
    if not is_youtube_url(url):
        return None
    vid = youtube_video_id(url)
    if not vid:
        return None

    hint = (language_hint or "en").lower()
    lang_pref = _lang_pref_for(hint)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "hi-IN,hi;q=0.9,ur;q=0.8,ar;q=0.7,en-US;q=0.6,en;q=0.5",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=45.0, follow_redirects=True, headers=headers) as client:
            player = _innertube_player(vid, client)
            if not player:
                return None

            tracks = (
                player.get("captions", {})
                .get("playerCaptionsTracklistRenderer", {})
                .get("captionTracks")
                or []
            )
            if not tracks:
                logger.info("No caption tracks for %s", vid)
                return None

            def rank(track: dict[str, Any]) -> tuple[int, int]:
                code = str(track.get("languageCode") or "").lower()
                try:
                    pref = lang_pref.index(code)
                except ValueError:
                    pref = 100
                kind = 0 if track.get("kind") != "asr" else 1
                return (pref, kind)

            track = sorted(tracks, key=rank)[0]
            base_url = track.get("baseUrl")
            if not base_url:
                return None
            lang = str(track.get("languageCode") or "en")

            for fmt in ("json3", "vtt", "srv3"):
                cap_url = _caption_url_with_fmt(base_url, fmt)
                resp = client.get(cap_url)
                if resp.status_code != 200 or not resp.text.strip():
                    continue
                text = resp.text
                segs: list[TranscriptSegment] = []
                try:
                    if text.lstrip().startswith("{"):
                        segs = _parse_json3(resp.json(), language=lang)
                    elif "WEBVTT" in text[:64]:
                        segs = _parse_vtt(text, language=lang)
                    else:
                        segs = _parse_srv3_xml(text, language=lang)
                except Exception as parse_exc:
                    logger.info("Caption parse failed fmt=%s: %s", fmt, parse_exc)
                    continue
                if segs:
                    logger.info(
                        "Fetched %d YouTube caption segments (%s, kind=%s) for %s",
                        len(segs),
                        lang,
                        track.get("kind") or "manual",
                        vid,
                    )
                    return segs
    except Exception as exc:
        logger.info("HTTP caption fetch failed for %s: %s", vid, exc)
        return None
    return None


def fetch_youtube_subtitles(url: str, work_dir: Path, settings: Settings | None = None) -> list[TranscriptSegment] | None:
    settings = settings or get_settings()
    out_tpl = str(work_dir / "subs.%(ext)s")
    cmd = [
        *ytdlp_base_args(settings),
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en.*,hi.*,en,hi",
        "--sub-format",
        "vtt/best",
        "-o",
        out_tpl,
        url,
    ]
    try:
        run_subprocess(cmd, timeout=180)
    except Exception as exc:
        logger.info("yt-dlp subtitles failed: %s", exc)
        return None

    for path in sorted(work_dir.glob("subs*")):
        if path.suffix.lower() == ".vtt":
            return _parse_vtt(path.read_text(encoding="utf-8", errors="replace"))
        if path.suffix.lower() == ".json3":
            return _parse_json3(json.loads(path.read_text(encoding="utf-8", errors="replace")))
    return None


def download_audio_only(url: str, work_dir: Path, settings: Settings | None = None) -> Path:
    settings = settings or get_settings()
    out = work_dir / "source_audio.m4a"
    if out.exists() and out.stat().st_size > 0:
        return out
    # Prefer compact audio for faster download; Whisper resamples anyway.
    cmd = [
        *ytdlp_base_args(settings),
        "-f",
        "bestaudio[acodec*=mp4]/bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "m4a",
        "--audio-quality",
        "7",
        "-o",
        str(out.with_suffix(".%(ext)s")),
        url,
    ]
    run_subprocess(cmd, timeout=3600)
    if not out.exists():
        candidates = list(work_dir.glob("source_audio.*"))
        if not candidates:
            raise RuntimeError("Audio download produced no file")
        return candidates[0]
    return out


_whisper_model = None
_whisper_batched = None


def _get_whisper_model(settings: Settings):
    global _whisper_model, _whisper_batched
    if _whisper_model is not None:
        return _whisper_model, _whisper_batched
    from faster_whisper import BatchedInferencePipeline, WhisperModel

    device = settings.whisper_device
    if device == "auto":
        try:
            import ctranslate2

            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    compute_type = settings.whisper_compute_type
    if compute_type == "default":
        compute_type = "float16" if device == "cuda" else "int8"
    logger.info(
        "Loading Whisper model=%s device=%s compute=%s",
        settings.whisper_model,
        device,
        compute_type,
    )
    _whisper_model = WhisperModel(
        settings.whisper_model,
        device=device,
        compute_type=compute_type,
    )
    try:
        _whisper_batched = BatchedInferencePipeline(model=_whisper_model)
    except Exception as exc:
        logger.info("Batched whisper unavailable (%s); using sequential", exc)
        _whisper_batched = None
    return _whisper_model, _whisper_batched


def transcribe_local(
    audio_path: Path,
    settings: Settings | None = None,
    on_progress: ProgressCb | None = None,
) -> list[TranscriptSegment]:
    settings = settings or get_settings()
    model, batched = _get_whisper_model(settings)
    beam = max(1, int(settings.whisper_beam_size))
    batch_size = max(1, int(settings.whisper_batch_size))

    common = dict(
        vad_filter=True,
        beam_size=beam,
        best_of=beam,
        condition_on_previous_text=False,
        without_timestamps=False,
    )

    if batched is not None:
        segments_iter, info = batched.transcribe(
            str(audio_path),
            batch_size=batch_size,
            **common,
        )
    else:
        segments_iter, info = model.transcribe(str(audio_path), **common)

    duration = float(getattr(info, "duration", 0) or 0)
    out: list[TranscriptSegment] = []
    for seg in segments_iter:
        out.append(
            TranscriptSegment(
                start=float(seg.start),
                end=float(seg.end),
                text=seg.text.strip(),
                language=getattr(info, "language", None),
            )
        )
        if on_progress and duration > 0:
            # Map 10% → 32% while transcribing
            pct = 10.0 + (min(float(seg.end), duration) / duration) * 22.0
            on_progress(pct, "transcribing_audio")
    return out


def transcribe_groq(audio_path: Path, settings: Settings | None = None) -> list[TranscriptSegment]:
    settings = settings or get_settings()
    if not settings.groq_api_key.strip():
        raise RuntimeError("GROQ_API_KEY required for groq transcription")
    with open(audio_path, "rb") as f:
        files = {"file": (audio_path.name, f, "audio/m4a")}
        data = {"model": "whisper-large-v3", "response_format": "verbose_json"}
        headers = {"Authorization": f"Bearer {settings.groq_api_key}"}
        with httpx.Client(timeout=600.0) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers=headers,
                data=data,
                files=files,
            )
            resp.raise_for_status()
            payload = resp.json()
    segments: list[TranscriptSegment] = []
    for seg in payload.get("segments") or []:
        segments.append(
            TranscriptSegment(
                start=float(seg.get("start", 0)),
                end=float(seg.get("end", 0)),
                text=str(seg.get("text", "")).strip(),
                language=payload.get("language"),
            )
        )
    if not segments and payload.get("text"):
        segments.append(
            TranscriptSegment(start=0.0, end=0.0, text=str(payload["text"]).strip(), language=payload.get("language"))
        )
    return segments


def load_cached_transcript(work_dir: Path) -> list[TranscriptSegment] | None:
    path = work_dir / "transcript.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [TranscriptSegment(**item) for item in raw]


def save_transcript(work_dir: Path, segments: list[TranscriptSegment]) -> Path:
    path = work_dir / "transcript.json"
    path.write_text(
        json.dumps([s.to_dict() for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def ensure_transcript(
    *,
    job_id: str,
    source_url: str,
    settings: Settings | None = None,
    on_progress: ProgressCb | None = None,
    language_hint: str = "en",
) -> list[TranscriptSegment]:
    settings = settings or get_settings()
    url = validate_public_http_url(source_url)
    work_dir = _job_dir(settings.resolved_temp_dir(), job_id)

    cached = load_cached_transcript(work_dir)
    if cached:
        return cached

    # 1) Fast path: HTTP captions from YouTube player (seconds)
    if on_progress:
        on_progress(6.0, "fetching_transcript")
    segments = fetch_youtube_captions_http(url, language_hint=language_hint)
    if segments:
        save_transcript(work_dir, segments)
        return segments

    # 2) yt-dlp subtitle download
    segments = fetch_youtube_subtitles(url, work_dir, settings=settings)
    if segments:
        save_transcript(work_dir, segments)
        return segments

    # 3) Slow path: download audio + Whisper
    if on_progress:
        on_progress(10.0, "transcribing_audio")
    audio = download_audio_only(url, work_dir, settings=settings)
    if settings.transcription_provider == "groq":
        segments = transcribe_groq(audio, settings)
    else:
        segments = transcribe_local(audio, settings, on_progress=on_progress)

    if not segments:
        raise RuntimeError("Transcription produced no segments")
    save_transcript(work_dir, segments)
    return segments
