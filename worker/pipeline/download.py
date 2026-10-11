from __future__ import annotations

import logging
from pathlib import Path

from config import Settings, get_settings, run_subprocess, validate_public_http_url

logger = logging.getLogger(__name__)


def segment_cache_path(work_dir: Path, index: int) -> Path:
    return work_dir / f"segment_{index:03d}.mp4"


def _section_spec(start: float, end: float) -> str:
    return f"*{start:.3f}-{end:.3f}"


def download_section_ytdlp(
    url: str,
    start: float,
    end: float,
    dest: Path,
    *,
    settings: Settings | None = None,
) -> Path:
    settings = settings or get_settings()
    url = validate_public_http_url(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest

    section = _section_spec(start, end)
    out_tpl = str(dest.with_suffix(".%(ext)s"))
    cmd = [
        "yt-dlp",
        "--download-sections",
        section,
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_tpl,
        url,
    ]
    try:
        run_subprocess(cmd, timeout=1800)
    except Exception as exc:
        logger.warning("Section download failed (%s), falling back to full then trim", exc)
        return _fallback_download_and_trim(url, start, end, dest, settings)

    if dest.exists():
        return dest
    for candidate in dest.parent.glob(dest.stem + ".*"):
        if candidate.suffix.lower() in {".mp4", ".mkv", ".webm"}:
            candidate.rename(dest)
            return dest
    return _fallback_download_and_trim(url, start, end, dest, settings)


def _fallback_download_and_trim(
    url: str,
    start: float,
    end: float,
    dest: Path,
    settings: Settings,
) -> Path:
    full = dest.parent / "source_full.mp4"
    if not full.exists() or full.stat().st_size == 0:
        cmd = [
            "yt-dlp",
            "-f",
            "bv*+ba/b",
            "--merge-output-format",
            "mp4",
            "-o",
            str(full),
            url,
        ]
        run_subprocess(cmd, timeout=3600)

    ffmpeg = settings.resolved_ffmpeg()
    duration = max(0.1, end - start)
    cmd = [
        ffmpeg,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(full),
        "-t",
        f"{duration:.3f}",
        "-c",
        "copy",
        str(dest),
    ]
    try:
        run_subprocess(cmd, timeout=600)
    except Exception:
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(full),
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            str(dest),
        ]
        run_subprocess(cmd, timeout=1200)
    return dest


def download_moment_segment(
    *,
    job_id: str,
    source_url: str,
    start: float,
    end: float,
    index: int,
    padding: float | None = None,
    settings: Settings | None = None,
) -> Path:
    settings = settings or get_settings()
    pad = padding if padding is not None else settings.segment_padding_seconds
    start_p = max(0.0, start - pad)
    end_p = end + pad
    work_dir = settings.resolved_temp_dir() / job_id / "segments"
    work_dir.mkdir(parents=True, exist_ok=True)
    dest = segment_cache_path(work_dir, index)
    return download_section_ytdlp(source_url, start_p, end_p, dest, settings=settings)
