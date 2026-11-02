from pipeline.transcript import _scout_windows, merge_transcript_window, window_coverage_ratio
from pipeline.transcript import TranscriptSegment


def test_scout_windows_short_vod_is_single_pass():
    windows = _scout_windows(600, budget=1200, chunk=90)
    assert windows == [(0.0, 600)]


def test_scout_windows_spreads_across_long_vod():
    windows = _scout_windows(21303, budget=1200, chunk=90)
    assert len(windows) >= 10
    total = sum(e - s for s, e in windows)
    assert total <= 1200 + 90  # ~budget
    assert windows[0][0] == 0.0
    assert windows[-1][1] <= 21303 + 0.1


def test_scout_windows_respects_intro_skip():
    windows = _scout_windows(21303, budget=1200, chunk=90, skip_start=120.0)
    assert windows
    assert all(s >= 120.0 - 0.01 for s, _ in windows)
    assert windows[0][0] >= 119.0


def test_scout_windows_can_cover_two_minute_clips():
    windows = _scout_windows(21303, budget=1200, chunk=135, skip_start=120.0)
    assert windows
    assert all((e - s) >= 120.0 for s, e in windows)


def test_coverage_and_merge():
    existing = [
        TranscriptSegment(0, 10, "hello"),
        TranscriptSegment(100, 110, "far"),
    ]
    assert window_coverage_ratio(existing, 0, 10) >= 0.99
    assert window_coverage_ratio(existing, 40, 70) < 0.1
    fresh = [TranscriptSegment(40, 50, "mid")]
    merged = merge_transcript_window(existing, fresh, 40, 50)
    texts = [s.text for s in merged]
    assert texts == ["hello", "mid", "far"]
