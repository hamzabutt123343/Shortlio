from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from config import Settings, get_settings, run_subprocess
from db import get_supabase

logger = logging.getLogger(__name__)

CLIPS_BUCKET = "clips"
DEFAULT_SIGNED_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _object_path(job_id: str, filename: str) -> str:
    safe = filename.replace("\\", "/").lstrip("/")
    return f"{job_id}/{safe}"


def _probe_duration_seconds(path: Path, settings: Settings) -> float:
    ffprobe = settings.resolved_ffprobe()
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(path),
    ]
    result = run_subprocess(cmd, timeout=60, check=False)
    try:
        payload = json.loads(result.stdout or "{}")
        duration = float((payload.get("format") or {}).get("duration") or 0)
        return max(0.1, duration)
    except Exception:
        return 0.0


def ensure_under_upload_limit(local_path: Path, settings: Settings) -> Path:
    """Re-encode oversized clips so Supabase Storage (Free ≤50MB) accepts them."""
    limit = max(5 * 1024 * 1024, int(settings.max_upload_bytes))
    size = local_path.stat().st_size
    if size <= limit:
        return local_path

    duration = _probe_duration_seconds(local_path, settings)
    # Leave headroom for container + audio (~12%).
    target_bits = max(250_000.0, (limit * 8 * 0.88) / max(duration, 1.0))
    audio_bps = 96_000
    video_kbps = max(250, int((target_bits - audio_bps) / 1000))

    out = local_path.with_name(f"{local_path.stem}.underlimit{local_path.suffix}")
    ffmpeg = settings.resolved_ffmpeg()
    # Prefer 720p-class Shorts encode — still looks fine, much smaller than 1080p CRF dumps.
    scale = "scale='min(720,iw)':-2"
    attempts = [
        {"vb": video_kbps, "scale": scale, "crf": None},
        {"vb": max(200, int(video_kbps * 0.75)), "scale": scale, "crf": None},
        {"vb": max(180, int(video_kbps * 0.55)), "scale": "scale='min(540,iw)':-2", "crf": None},
        {"vb": None, "scale": "scale='min(540,iw)':-2", "crf": "32"},
    ]

    logger.warning(
        "Clip is %.1fMB (limit %.1fMB, duration %.1fs) — compressing for Supabase upload",
        size / (1024 * 1024),
        limit / (1024 * 1024),
        duration,
    )

    last_size = size
    for i, attempt in enumerate(attempts):
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(local_path),
            "-vf",
            str(attempt["scale"]),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-threads",
            "0",
        ]
        if attempt["crf"] is not None:
            cmd.extend(["-crf", str(attempt["crf"])])
        else:
            cmd.extend(["-b:v", f"{attempt['vb']}k", "-maxrate", f"{attempt['vb']}k", "-bufsize", f"{int(attempt['vb']) * 2}k"])
        cmd.append(str(out))
        run_subprocess(cmd, timeout=1800)
        if not out.exists() or out.stat().st_size <= 0:
            continue
        last_size = out.stat().st_size
        logger.info(
            "Upload compress attempt %d → %.1fMB (target ≤ %.1fMB)",
            i + 1,
            last_size / (1024 * 1024),
            limit / (1024 * 1024),
        )
        if last_size <= limit:
            return out

    if out.exists() and out.stat().st_size < size:
        # Still over limit but smaller — try upload anyway if somehow limit is higher server-side.
        if out.stat().st_size <= limit:
            return out
        raise RuntimeError(
            f"Clip is still {last_size / (1024 * 1024):.1f}MB after compression; "
            f"Supabase Free allows ~50MB max. Shorten the clip (≤3 min) or raise "
            f"Storage → Global file size limit / upgrade to Pro."
        )
    raise RuntimeError(
        f"Could not shrink clip under {limit / (1024 * 1024):.0f}MB for upload "
        f"(was {size / (1024 * 1024):.1f}MB)."
    )


def upload_clip(
    local_path: Path,
    *,
    job_id: str,
    clip_index: int,
    settings: Settings | None = None,
    signed_seconds: int = DEFAULT_SIGNED_SECONDS,
    storage_path: str | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    client = get_supabase(settings)
    storage = client.storage.from_(CLIPS_BUCKET)
    object_name = storage_path or _object_path(job_id, f"clip_{clip_index:03d}.mp4")

    upload_path = ensure_under_upload_limit(local_path, settings)

    with open(upload_path, "rb") as f:
        storage.upload(
            object_name,
            f,
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )

    signed = storage.create_signed_url(object_name, signed_seconds)
    url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    return {
        "bucket": CLIPS_BUCKET,
        "path": object_name,
        "signed_url": url,
        "expires_in": signed_seconds,
        "size_bytes": upload_path.stat().st_size,
    }


def ensure_bucket_exists(settings: Settings | None = None) -> None:
    """Best-effort bucket check; create via Supabase dashboard if missing."""
    settings = settings or get_settings()
    client = get_supabase(settings)
    try:
        buckets = client.storage.list_buckets()
        names: set[str] = set()
        for b in buckets or []:
            if isinstance(b, dict):
                names.add(str(b.get("name", "")))
            else:
                names.add(str(getattr(b, "name", "")))
        if CLIPS_BUCKET not in names:
            logger.warning(
                "Storage bucket %r not found — create it in Supabase before uploading clips",
                CLIPS_BUCKET,
            )
    except Exception as exc:
        logger.debug("Could not list buckets: %s", exc)
