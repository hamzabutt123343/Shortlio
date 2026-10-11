from __future__ import annotations

import json
import logging
from typing import Any

from config import Settings, get_settings, run_subprocess, validate_public_http_url

logger = logging.getLogger(__name__)


def fetch_ytdlp_metadata(url: str, settings: Settings | None = None) -> dict[str, Any] | None:
    """Best-effort yt-dlp JSON metadata (title, duration, etc.) without downloading media."""
    settings = settings or get_settings()
    try:
        url = validate_public_http_url(url)
    except ValueError:
        return None
    cmd = [
        "yt-dlp",
        "--dump-single-json",
        "--skip-download",
        url,
    ]
    try:
        result = run_subprocess(cmd, timeout=180)
        raw = (result.stdout or "").strip()
        if not raw:
            return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception as exc:
        logger.info("yt-dlp metadata failed: %s", exc)
        return None


def project_fields_from_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    """Map yt-dlp info dict to projects table columns."""
    title = meta.get("title") or meta.get("fulltitle")
    duration = meta.get("duration")
    if duration is not None:
        try:
            duration = float(duration)
        except (TypeError, ValueError):
            duration = None
    subset = {
        k: meta[k]
        for k in (
            "id",
            "title",
            "duration",
            "uploader",
            "channel",
            "channel_id",
            "webpage_url",
            "thumbnail",
            "description",
        )
        if k in meta and meta[k] is not None
    }
    out: dict[str, Any] = {"source_metadata": subset}
    if title:
        out["source_title"] = str(title)[:500]
    if duration is not None:
        out["source_duration"] = duration
    return out
