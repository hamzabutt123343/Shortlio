"""Record a short window from an active live stream (never treated as a full VOD download)."""

from __future__ import annotations

import logging
import time
from pathlib import Path

from config import Settings, get_settings, run_subprocess, validate_public_http_url, ytdlp_base_args
from pipeline.source_platform import SourceAccessError, detect_platform_from_url, map_ytdlp_error

logger = logging.getLogger(__name__)

# Keep live snapshots short — long live pulls are unreliable and heavy.
_MIN_LIVE_SECONDS = 20.0
_MAX_LIVE_SECONDS = 180.0


def clamp_live_record_seconds(value: float | int | None, default: float = 90.0) -> float:
    try:
        n = float(value) if value is not None else default
    except (TypeError, ValueError):
        n = default
    return max(_MIN_LIVE_SECONDS, min(_MAX_LIVE_SECONDS, n))


def record_live_snapshot(
    url: str,
    dest_dir: Path,
    *,
    duration_seconds: float = 90.0,
    settings: Settings | None = None,
) -> Path:
    """
    Capture approximately `duration_seconds` of the current live edge via yt-dlp + ffmpeg.

    This is intentionally not a VOD section download — live timelines grow and cannot be
    addressed with absolute start/end like finished broadcasts.
    """
    settings = settings or get_settings()
    url = validate_public_http_url(url)
    platform = detect_platform_from_url(url)
    seconds = clamp_live_record_seconds(duration_seconds)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"live_snapshot_{int(time.time())}.mp4"

    cmd = [
        *ytdlp_base_args(settings),
        "--no-part",
        "--no-mtime",
        "-f",
        "bv*[height<=720]+ba/b[height<=720]/best",
        "--merge-output-format",
        "mp4",
        "--downloader",
        "ffmpeg",
        "--downloader-args",
        f"ffmpeg_i:-t {int(seconds)}",
        "-o",
        str(out),
        url,
    ]

    logger.info("Live snapshot start platform=%s duration=%.0fs url=%s", platform, seconds, url)
    try:
        run_subprocess(cmd, timeout=max(300.0, seconds * 4 + 120.0))
    except Exception as exc:
        raise SourceAccessError(map_ytdlp_error(exc, platform=platform)) from exc

    if out.exists() and out.stat().st_size >= 10_000:
        return out

    mp4s = sorted(dest_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if mp4s and mp4s[0].stat().st_size >= 10_000:
        return mp4s[0]

    raise SourceAccessError(
        f"Live snapshot failed on {platform}. The stream may have ended, be offline, "
        "or require login. Try again while the channel is live, or use a VOD URL."
    )
