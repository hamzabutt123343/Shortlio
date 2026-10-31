from __future__ import annotations

import json
import logging
from typing import Any

from config import Settings, get_settings, run_subprocess, validate_public_http_url, ytdlp_base_args
from pipeline.source_platform import (
    SourceAccessError,
    SourceProbe,
    detect_platform_from_url,
    map_ytdlp_error,
    probe_from_metadata,
)

logger = logging.getLogger(__name__)


def fetch_ytdlp_metadata(
    url: str,
    settings: Settings | None = None,
    *,
    strict: bool = False,
) -> dict[str, Any] | None:
    """Best-effort yt-dlp JSON metadata (title, duration, etc.) without downloading media."""
    settings = settings or get_settings()
    platform = detect_platform_from_url(url)
    try:
        url = validate_public_http_url(url)
    except ValueError as exc:
        if strict:
            raise SourceAccessError(str(exc)) from exc
        return None
    cmd = [
        *ytdlp_base_args(settings),
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        url,
    ]
    try:
        result = run_subprocess(cmd, timeout=180)
        raw = (result.stdout or "").strip()
        if not raw:
            if strict:
                raise SourceAccessError(
                    f"No metadata returned for this {platform} URL. "
                    "It may be private, offline, or unsupported."
                )
            return None
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
        if strict:
            raise SourceAccessError(f"Unexpected metadata shape for {platform} URL.")
        return None
    except SourceAccessError:
        raise
    except Exception as exc:
        logger.info("yt-dlp metadata failed: %s", exc)
        if strict:
            raise SourceAccessError(map_ytdlp_error(exc, platform=platform)) from exc
        return None


def fetch_source_probe(
    url: str,
    settings: Settings | None = None,
    *,
    strict: bool = False,
) -> SourceProbe:
    """Resolve platform + live/VOD kind from URL and yt-dlp metadata."""
    settings = settings or get_settings()
    meta = fetch_ytdlp_metadata(url, settings, strict=strict)
    return probe_from_metadata(url, meta)


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
            "is_live",
            "was_live",
            "live_status",
            "availability",
            "extractor",
            "extractor_key",
        )
        if k in meta and meta[k] is not None
    }
    out: dict[str, Any] = {"source_metadata": subset}
    if title:
        out["source_title"] = str(title)[:500]
    if duration is not None:
        out["source_duration"] = duration
    return out


def project_fields_from_probe(probe: SourceProbe) -> dict[str, Any]:
    fields = project_fields_from_metadata(probe.raw or {})
    if probe.title and "source_title" not in fields:
        fields["source_title"] = probe.title
    if probe.duration is not None and "source_duration" not in fields:
        fields["source_duration"] = probe.duration
    # Keep platform string in metadata for UI/debug.
    meta = dict(fields.get("source_metadata") or {})
    meta["shortlio_platform"] = probe.platform
    meta["shortlio_kind"] = probe.kind
    fields["source_metadata"] = meta
    return fields
