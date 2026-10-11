from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx

from config import Settings, get_settings, run_subprocess, validate_public_http_url

logger = logging.getLogger(__name__)


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


def fetch_youtube_subtitles(url: str, work_dir: Path) -> list[TranscriptSegment] | None:
    out_tpl = str(work_dir / "subs.%(ext)s")
    cmd = [
        "yt-dlp",
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
        run_subprocess(cmd, timeout=600)
    except Exception as exc:
        logger.info("yt-dlp subtitles failed: %s", exc)
        return None

    for path in sorted(work_dir.glob("subs*")):
        if path.suffix.lower() == ".vtt":
            return _parse_vtt(path.read_text(encoding="utf-8", errors="replace"))
        if path.suffix.lower() == ".json3":
            return _parse_json3(json.loads(path.read_text(encoding="utf-8", errors="replace")))
    return None


def download_audio_only(url: str, work_dir: Path) -> Path:
    out = work_dir / "source_audio.m4a"
    if out.exists() and out.stat().st_size > 0:
        return out
    cmd = [
        "yt-dlp",
        "-f",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "m4a",
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


def _get_whisper_model(settings: Settings):
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    from faster_whisper import WhisperModel

    device = settings.whisper_device
    compute_type = settings.whisper_compute_type
    if compute_type == "default":
        compute_type = "float16" if device == "cuda" else "int8"
    _whisper_model = WhisperModel(settings.whisper_model, device=device, compute_type=compute_type)
    return _whisper_model


def transcribe_local(audio_path: Path, settings: Settings | None = None) -> list[TranscriptSegment]:
    settings = settings or get_settings()
    model = _get_whisper_model(settings)
    segments_iter, info = model.transcribe(str(audio_path), vad_filter=True)
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
) -> list[TranscriptSegment]:
    settings = settings or get_settings()
    url = validate_public_http_url(source_url)
    work_dir = _job_dir(settings.resolved_temp_dir(), job_id)

    cached = load_cached_transcript(work_dir)
    if cached:
        return cached

    segments = fetch_youtube_subtitles(url, work_dir)
    if segments:
        save_transcript(work_dir, segments)
        return segments

    audio = download_audio_only(url, work_dir)
    if settings.transcription_provider == "groq":
        segments = transcribe_groq(audio, settings)
    else:
        segments = transcribe_local(audio, settings)

    if not segments:
        raise RuntimeError("Transcription produced no segments")
    save_transcript(work_dir, segments)
    return segments
