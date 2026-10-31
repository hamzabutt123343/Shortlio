"""Kick / Twitch / YouTube source detection, live vs VOD policy, and user-facing errors.

Uses yt-dlp metadata (compliant extractor). Never bypasses DRM or login walls.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

SourceKind = Literal["vod", "clip", "live", "upcoming", "unknown"]
PlatformName = Literal[
    "youtube",
    "twitch",
    "kick",
    "tiktok",
    "instagram",
    "vimeo",
    "twitter",
    "unknown",
]

_TWITCH_HOSTS = ("twitch.tv", "clips.twitch.tv", "www.twitch.tv", "m.twitch.tv")
_KICK_HOSTS = ("kick.com", "www.kick.com", "m.kick.com")


@dataclass(frozen=True)
class SourceProbe:
    platform: PlatformName
    kind: SourceKind
    url: str
    title: str | None = None
    duration: float | None = None
    uploader: str | None = None
    channel: str | None = None
    is_live: bool = False
    live_status: str | None = None
    availability: str | None = None
    raw: dict[str, Any] | None = None

    @property
    def is_finite_vod(self) -> bool:
        """True when we can treat the source as a finished timeline for clipping."""
        if self.is_live or self.kind in ("live", "upcoming"):
            return False
        if self.kind in ("vod", "clip"):
            return True
        # Unknown but has a positive duration → treat as VOD-like.
        return bool(self.duration and self.duration > 0)


class SourceAccessError(RuntimeError):
    """User-facing source rejection (private, live, geo, login, unsupported)."""


def normalize_host(url: str) -> str:
    try:
        return urlparse(url.strip()).hostname.replace("www.", "").lower()  # type: ignore[union-attr]
    except Exception:
        return ""


def detect_platform_from_url(url: str) -> PlatformName:
    host = normalize_host(url)
    if not host:
        return "unknown"
    if "youtube" in host or host == "youtu.be" or host.endswith("youtu.be"):
        return "youtube"
    if host == "clips.twitch.tv" or host.endswith("twitch.tv"):
        return "twitch"
    if host == "kick.com" or host.endswith(".kick.com"):
        return "kick"
    if "tiktok" in host:
        return "tiktok"
    if "instagram" in host:
        return "instagram"
    if "vimeo" in host:
        return "vimeo"
    if host in ("twitter.com", "x.com") or host.endswith(".twitter.com"):
        return "twitter"
    return "unknown"


def classify_kind_from_url(url: str, platform: PlatformName | None = None) -> SourceKind:
    """Best-effort URL shape classification before metadata (never trust alone for live)."""
    platform = platform or detect_platform_from_url(url)
    try:
        parsed = urlparse(url.strip())
        path = (parsed.path or "").lower()
        host = (parsed.hostname or "").lower()
    except Exception:
        return "unknown"

    if platform == "twitch":
        if "clips.twitch.tv" in host or "/clip/" in path:
            return "clip"
        if re.search(r"/videos/\d+", path):
            return "vod"
        # Bare channel URL → usually the live page (worker confirms via metadata).
        if re.fullmatch(r"/[a-z0-9_]+/?", path):
            return "live"
        return "unknown"

    if platform == "kick":
        if "/clip/" in path or "/clips/" in path:
            return "clip"
        if "/video/" in path or "/videos/" in path:
            return "vod"
        if re.fullmatch(r"/[a-z0-9_-]+/?", path):
            return "live"
        return "unknown"

    if platform == "youtube":
        if "/live" in path or "/channel" in path:
            return "unknown"
        return "vod"

    return "unknown"


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        n = float(value)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def probe_from_metadata(url: str, meta: dict[str, Any] | None) -> SourceProbe:
    platform = detect_platform_from_url(url)
    url_kind = classify_kind_from_url(url, platform)

    if not meta:
        return SourceProbe(platform=platform, kind=url_kind, url=url)

    live_status = meta.get("live_status")
    if isinstance(live_status, str):
        live_status = live_status.lower()
    else:
        live_status = None

    meta_says_live = bool(meta.get("is_live")) or live_status in ("is_live", "is_upcoming")
    was_live = bool(meta.get("was_live"))
    duration = _float_or_none(meta.get("duration"))

    # Explicit VOD/clip URL shapes win — Twitch marks in-progress broadcasts as is_live
    # even on /videos/<id> pages; those are still section-downloadable timelines.
    if url_kind == "clip" or "clip" in str(meta.get("webpage_url") or "").lower():
        kind: SourceKind = "clip"
    elif url_kind == "vod":
        kind = "vod"
    elif meta_says_live and live_status == "is_upcoming":
        kind = "upcoming"
    elif meta_says_live and url_kind == "live":
        kind = "live"
    elif meta_says_live and not duration:
        kind = "live"
    elif duration and duration > 0:
        kind = "vod"
    elif was_live:
        kind = "vod"
    else:
        kind = url_kind if url_kind != "unknown" else "unknown"

    # Channel live pages sometimes report no duration and is_live=True.
    if kind == "unknown" and not duration and platform in ("twitch", "kick"):
        if url_kind == "live":
            kind = "live"

    title = meta.get("title") or meta.get("fulltitle")
    uploader = meta.get("uploader") or meta.get("creator")
    channel = meta.get("channel") or meta.get("uploader")

    return SourceProbe(
        platform=platform,
        kind=kind,
        url=url,
        title=str(title)[:500] if title else None,
        duration=duration,
        uploader=str(uploader) if uploader else None,
        channel=str(channel) if channel else None,
        is_live=kind in ("live", "upcoming"),
        live_status=live_status,
        availability=str(meta.get("availability")) if meta.get("availability") else None,
        raw=meta,
    )


def map_ytdlp_error(exc: BaseException, *, platform: PlatformName = "unknown") -> str:
    """Turn yt-dlp/extractor failures into clear Shortlio errors."""
    text = str(exc).lower()
    plat = platform if platform != "unknown" else "this platform"

    if any(
        s in text
        for s in (
            "private video",
            "private stream",
            "this video is private",
            "login required",
            "sign in",
            "confirm your age",
            "members-only",
            "subscribers only",
            "subscriber-only",
            "only available to",
        )
    ):
        return (
            f"This {plat} source is private, login-gated, or restricted. "
            "Shortlio only supports public VODs/clips you can open without signing in."
        )
    if any(s in text for s in ("geo", "not available in your", "blocked in your")):
        return f"This {plat} source is geo-restricted or unavailable from the worker region."
    if "impersonat" in text and ("no impersonate" in text or "curl_cffi" in text):
        return (
            f"Could not access this {plat} source: browser impersonation is missing. "
            "Install curl-cffi in the worker venv (pip install curl-cffi) and update yt-dlp."
        )
    if any(s in text for s in ("403", "forbidden")) and platform in ("kick", "twitch"):
        return (
            f"This {plat} source was blocked (HTTP 403). "
            "Ensure curl-cffi is installed and yt-dlp is up to date, then retry."
        )
    if any(s in text for s in ("404", "not found", "does not exist", "removed", "unavailable")):
        if platform == "kick":
            return (
                "This Kick VOD was not found or Kick’s API rejected the request. "
                "Confirm the link opens in a browser, then retry with an updated yt-dlp "
                "(Kick changed their VOD API — worker needs yt-dlp ≥ 2026.10.21 + curl-cffi)."
            )
        return f"This {plat} source was not found or is no longer available."
    if "drm" in text or "encrypted" in text:
        return f"This {plat} media is DRM-protected and cannot be processed."
    if "unsupported url" in text or "no suitable extractor" in text:
        return f"Unsupported {plat} URL. Use a public VOD, past broadcast, or clip link."
    if "live" in text and ("not finished" in text or "still live" in text):
        return (
            "This looks like a live stream still in progress. "
            "Use a finished VOD / past broadcast URL, or choose Live snapshot to record a short window."
        )
    # Keep original detail (truncated) for debugging in the job error field.
    detail = str(exc).strip().splitlines()[-1][:280]
    return f"Could not access source ({plat}): {detail}"


def assert_source_usable(
    probe: SourceProbe,
    *,
    clip_mode: str = "ai",
    max_duration: float | None = None,
) -> None:
    """Raise SourceAccessError when the source cannot run the requested mode."""
    if probe.availability in ("private", "premium_only", "subscriber_only", "needs_auth"):
        raise SourceAccessError(
            f"This {probe.platform} source is {probe.availability.replace('_', ' ')}. "
            "Only public VODs and clips are supported."
        )

    if clip_mode == "live_record":
        if probe.platform not in ("twitch", "kick", "youtube"):
            raise SourceAccessError("Live snapshot is only available for Twitch, Kick, or YouTube live URLs.")
        if probe.kind not in ("live", "unknown") and not probe.is_live:
            # Allow live_record on channel URLs even if metadata was thin.
            if classify_kind_from_url(probe.url, probe.platform) != "live" and not probe.is_live:
                raise SourceAccessError(
                    "Live snapshot requires an active live stream URL. "
                    "For finished streams, use the VOD / past broadcast link with AI or Custom clip."
                )
        return

    if probe.is_live or probe.kind in ("live", "upcoming"):
        raise SourceAccessError(
            f"This looks like a live {probe.platform} stream"
            + (" that has not started yet." if probe.kind == "upcoming" else ".")
            + " Finished VODs and past broadcasts are supported for AI/Custom clips. "
            "To capture an active live stream, choose “Live snapshot” (records a short window only — "
            "live cannot be downloaded like a VOD)."
        )

    if probe.platform in ("twitch", "kick") and probe.kind == "unknown" and not probe.duration:
        # Soft: let download try; metadata sometimes omits duration on clips.
        pass

    if max_duration is not None and probe.duration and probe.duration > max_duration:
        hours = int(max_duration // 3600)
        raise SourceAccessError(
            f"This VOD is {probe.duration / 3600:.1f}h long; the worker limit is {hours}h. "
            "Use Custom clip with a shorter start/end window, or pick a shorter broadcast."
        )


def human_platform_label(platform: PlatformName) -> str:
    return {
        "youtube": "YouTube",
        "twitch": "Twitch",
        "kick": "Kick",
        "tiktok": "TikTok",
        "instagram": "Instagram",
        "vimeo": "Vimeo",
        "twitter": "X",
        "unknown": "video",
    }.get(platform, platform)
