from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from config import Settings, get_settings
from db import get_supabase

logger = logging.getLogger(__name__)

CLIPS_BUCKET = "clips"
DEFAULT_SIGNED_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _object_path(job_id: str, filename: str) -> str:
    safe = filename.replace("\\", "/").lstrip("/")
    return f"{job_id}/{safe}"


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

    with open(local_path, "rb") as f:
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
        "size_bytes": local_path.stat().st_size,
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
