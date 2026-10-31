from __future__ import annotations

import pytest

from pipeline.source_platform import (
    SourceAccessError,
    assert_source_usable,
    classify_kind_from_url,
    detect_platform_from_url,
    map_ytdlp_error,
    probe_from_metadata,
)


def test_detect_twitch_and_kick():
    assert detect_platform_from_url("https://www.twitch.tv/videos/123") == "twitch"
    assert detect_platform_from_url("https://clips.twitch.tv/Foo") == "twitch"
    assert detect_platform_from_url("https://kick.com/xqc/videos/abc") == "kick"
    assert detect_platform_from_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "youtube"


def test_classify_kinds():
    assert classify_kind_from_url("https://www.twitch.tv/videos/999") == "vod"
    assert classify_kind_from_url("https://clips.twitch.tv/Clip") == "clip"
    assert classify_kind_from_url("https://www.twitch.tv/shroud") == "live"
    assert classify_kind_from_url("https://kick.com/trainwreckstv") == "live"
    assert classify_kind_from_url("https://kick.com/x/videos/uuid-1") == "vod"


def test_probe_live_from_metadata():
    probe = probe_from_metadata(
        "https://www.twitch.tv/shroud",
        {"is_live": True, "live_status": "is_live", "title": "Live now"},
    )
    assert probe.platform == "twitch"
    assert probe.kind == "live"
    assert probe.is_live is True


def test_probe_vod_duration():
    probe = probe_from_metadata(
        "https://www.twitch.tv/videos/1",
        {"duration": 3600, "was_live": True, "title": "Yesterday"},
    )
    assert probe.kind == "vod"
    assert probe.is_finite_vod is True


def test_in_progress_twitch_vod_url_not_treated_as_channel_live():
    """Twitch often sets is_live on the active /videos/id recording — still a VOD path."""
    probe = probe_from_metadata(
        "https://www.twitch.tv/videos/2909822254",
        {
            "is_live": True,
            "live_status": "is_live",
            "duration": 39315,
            "title": "LIVE stream VOD",
        },
    )
    assert probe.kind == "vod"
    assert probe.is_live is False
    assert probe.is_finite_vod is True


def test_assert_rejects_live_for_ai():
    probe = probe_from_metadata(
        "https://kick.com/someone",
        {"is_live": True, "live_status": "is_live"},
    )
    with pytest.raises(SourceAccessError, match="live"):
        assert_source_usable(probe, clip_mode="ai")


def test_assert_allows_live_record():
    probe = probe_from_metadata(
        "https://www.twitch.tv/shroud",
        {"is_live": True, "live_status": "is_live"},
    )
    assert_source_usable(probe, clip_mode="live_record")


def test_map_private_error():
    msg = map_ytdlp_error(RuntimeError("ERROR: Private video"), platform="twitch")
    assert "private" in msg.lower() or "login" in msg.lower()


def test_map_kick_404_mentions_ytdlp_update():
    msg = map_ytdlp_error(
        RuntimeError("ERROR: [kick:vod] Unable to download JSON metadata: HTTP Error 404: Not Found"),
        platform="kick",
    )
    assert "kick" in msg.lower()
    assert "yt-dlp" in msg.lower() or "curl" in msg.lower()


def test_youtube_url_still_youtube():
    assert detect_platform_from_url("https://youtu.be/abcdefghijk") == "youtube"
    assert classify_kind_from_url("https://youtu.be/abcdefghijk") == "vod"
