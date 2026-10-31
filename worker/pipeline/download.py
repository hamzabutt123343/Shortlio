from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from config import Settings, get_settings, run_subprocess, validate_public_http_url, ytdlp_base_args
from pipeline.source_platform import SourceAccessError, detect_platform_from_url, map_ytdlp_error

logger = logging.getLogger(__name__)


def segment_cache_path(work_dir: Path, index: int) -> Path:
    return work_dir / f"segment_{index:03d}.mp4"


def _global_segment_path(settings: Settings, url: str, start: float, end: float) -> Path:
    key = f"{url.strip()}|{start:.3f}|{end:.3f}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
    root = settings.resolved_temp_dir() / "segment_cache"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{digest}.mp4"


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
        *ytdlp_base_args(settings),
        "--download-sections",
        section,
        # Cap at 720p — plenty for Shorts, much faster to download/encode
        "-f",
        "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_tpl,
        url,
    ]
    platform = detect_platform_from_url(url)
    try:
        run_subprocess(cmd, timeout=1800)
    except Exception as exc:
        logger.warning("Section download failed (%s), falling back to full then trim", exc)
        try:
            return _fallback_download_and_trim(url, start, end, dest, settings)
        except Exception as fallback_exc:
            raise SourceAccessError(
                map_ytdlp_error(fallback_exc, platform=platform)
            ) from fallback_exc

    if dest.exists():
        return dest
    for candidate in dest.parent.glob(dest.stem + ".*"):
        if candidate.suffix.lower() in {".mp4", ".mkv", ".webm"}:
            candidate.rename(dest)
            return dest
    try:
        return _fallback_download_and_trim(url, start, end, dest, settings)
    except Exception as fallback_exc:
        raise SourceAccessError(map_ytdlp_error(fallback_exc, platform=platform)) from fallback_exc


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
            *ytdlp_base_args(settings),
            "-f",
            "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
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


def trim_local_media(
    media_path: Path,
    start: float,
    end: float,
    dest: Path,
    *,
    settings: Settings | None = None,
) -> Path:
    """Cut a window from a local media file (used for live snapshots)."""
    settings = settings or get_settings()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    ffmpeg = settings.resolved_ffmpeg()
    duration = max(0.1, end - start)
    cmd = [
        ffmpeg,
        "-y",
        "-ss",
        f"{max(0.0, start):.3f}",
        "-i",
        str(media_path),
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
            f"{max(0.0, start):.3f}",
            "-i",
            str(media_path),
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
    local_media_path: Path | None = None,
) -> Path:
    settings = settings or get_settings()
    pad = padding if padding is not None else settings.segment_padding_seconds
    start_p = max(0.0, start - pad)
    end_p = end + pad

    if local_media_path is not None:
        work_dir = settings.resolved_temp_dir() / job_id / "segments"
        work_dir.mkdir(parents=True, exist_ok=True)
        dest = segment_cache_path(work_dir, index)
        # Live snapshot timeline is already the clip window — little/no pad.
        return trim_local_media(
            local_media_path,
            max(0.0, start),
            end,
            dest,
            settings=settings,
        )

    # Reuse across jobs so caption-only re-renders skip redownload
    global_dest = _global_segment_path(settings, source_url, start_p, end_p)
    if global_dest.exists() and global_dest.stat().st_size > 0:
        work_dir = settings.resolved_temp_dir() / job_id / "segments"
        work_dir.mkdir(parents=True, exist_ok=True)
        dest = segment_cache_path(work_dir, index)
        if not dest.exists():
            try:
                if hasattr(global_dest, "hardlink_to"):
                    dest.hardlink_to(global_dest)
                else:
                    raise OSError("no hardlink")
            except OSError:
                import shutil

                shutil.copy2(global_dest, dest)
        return dest if dest.exists() else global_dest

    downloaded = download_section_ytdlp(
        source_url, start_p, end_p, global_dest, settings=settings
    )
    work_dir = settings.resolved_temp_dir() / job_id / "segments"
    work_dir.mkdir(parents=True, exist_ok=True)
    dest = segment_cache_path(work_dir, index)
    if downloaded.resolve() != dest.resolve():
        try:
            if not dest.exists():
                dest.hardlink_to(downloaded)
        except OSError:
            import shutil

            if not dest.exists():
                shutil.copy2(downloaded, dest)
    return dest if dest.exists() else downloaded
