import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from pipeline.reframe import (
    CropKeyframe,
    FramingSegment,
    ReframePlan,
    _build_hard_cut_segments,
    compute_reframe_plan,
    ffmpeg_crop_filter,
    write_sendcmd,
)


def _make_moving_face_video(path: Path, frames: int = 30, fps: int = 10) -> Path:
    w, h = 640, 360
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (w, h))
    for i in range(frames):
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        frame[:] = (40, 40, 40)
        cx = int(80 + (w - 160) * (i / max(frames - 1, 1)))
        cy = h // 2
        cv2.rectangle(frame, (cx - 40, cy - 50), (cx + 40, cy + 50), (220, 200, 180), -1)
        cv2.circle(frame, (cx - 15, cy - 10), 6, (30, 30, 30), -1)
        cv2.circle(frame, (cx + 15, cy - 10), 6, (30, 30, 30), -1)
        writer.write(frame)
    writer.release()
    return path


def _make_two_speaker_video(path: Path, frames: int = 40, fps: int = 10) -> Path:
    """Left face talks first half, right face second half (via mouth flicker)."""
    w, h = 640, 360
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (w, h))
    for i in range(frames):
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        frame[:] = (35, 35, 40)
        # Left face
        lx, ly = 140, h // 2
        cv2.rectangle(frame, (lx - 45, ly - 55), (lx + 45, ly + 55), (210, 190, 170), -1)
        cv2.circle(frame, (lx - 15, ly - 15), 5, (20, 20, 20), -1)
        cv2.circle(frame, (lx + 15, ly - 15), 5, (20, 20, 20), -1)
        # Right face
        rx, ry = 500, h // 2
        cv2.rectangle(frame, (rx - 45, ry - 55), (rx + 45, ry + 55), (200, 180, 160), -1)
        cv2.circle(frame, (rx - 15, ry - 15), 5, (20, 20, 20), -1)
        cv2.circle(frame, (rx + 15, ry - 15), 5, (20, 20, 20), -1)
        # Animate mouth region of active speaker
        if i < frames // 2:
            mouth_y = ly + 25 + (i % 3) * 4
            cv2.rectangle(frame, (lx - 18, mouth_y), (lx + 18, mouth_y + 8), (40, 20, 20), -1)
        else:
            mouth_y = ry + 25 + (i % 3) * 4
            cv2.rectangle(frame, (rx - 18, mouth_y), (rx + 18, mouth_y + 8), (40, 20, 20), -1)
        writer.write(frame)
    writer.release()
    return path


class ReframeTests(unittest.TestCase):
    def test_manual_focal_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            vid = _make_moving_face_video(Path(tmp) / "m.mp4")
            plan = compute_reframe_plan(
                vid, aspect="9:16", focal_x=0.2, manual_override=True, max_samples=10
            )
            self.assertEqual(plan.detector, "manual")
            self.assertLess(plan.crop_w, 640)
            self.assertLess(plan.crop_x, 200)

    def test_auto_plan_has_crop(self):
        tmp = tempfile.mkdtemp()
        try:
            vid = _make_moving_face_video(Path(tmp) / "a.mp4")
            # Keep MediaPipe model outside the video temp dir (Windows file locks)
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            plan = compute_reframe_plan(
                vid,
                aspect="9:16",
                sample_fps=5,
                max_samples=20,
                model_cache_dir=model_dir,
                speaker_focus=True,
                switch_style="hard_cut",
            )
            self.assertGreater(plan.crop_w, 0)
            self.assertGreater(plan.crop_h, 0)
            self.assertGreaterEqual(plan.crop_x, 0)
            filt = ffmpeg_crop_filter(plan)
            self.assertTrue(filt.startswith("crop="))
            self.assertEqual(plan.switch_style, "hard_cut")
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_sendcmd_written_when_keyframes(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = ReframePlan(
                crop_x=10,
                crop_y=0,
                crop_w=200,
                crop_h=360,
                used_center_fallback=False,
                aspect="9:16",
                keyframes=[
                    CropKeyframe(t=0.0, crop_x=10, crop_y=0),
                    CropKeyframe(t=1.0, crop_x=100, crop_y=0),
                    CropKeyframe(t=2.0, crop_x=180, crop_y=0),
                ],
            )
            path = write_sendcmd(Path(tmp) / "cmd.txt", plan)
            self.assertIsNotNone(path)
            text = path.read_text(encoding="utf-8")
            self.assertIn("crop@track x", text)
            self.assertIn("1.000", text)

    def test_active_speaker_switches_with_hysteresis(self):
        from pipeline.reframe import _SpeakerTrack, _active_speaker_id

        left = _SpeakerTrack(id=1, cx=100, cy=200, w=80, h=100, mouth_score=2.0)
        right = _SpeakerTrack(id=2, cx=500, cy=200, w=80, h=100, mouth_score=8.0)
        cur, pending, hits = _active_speaker_id([left, right], 1, None, 0, confirm=2)
        self.assertEqual(cur, 1)  # not yet switched
        self.assertEqual(pending, 2)
        cur, pending, hits = _active_speaker_id([left, right], cur, pending, hits, confirm=2)
        self.assertEqual(cur, 2)  # confirmed switch

    def test_hard_cut_segments_have_no_interpolated_midpoints(self):
        """Segments jump from left crop to right crop with no intermediate x values."""
        samples_t = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
        samples_cx = [120.0, 122.0, 118.0, 500.0, 505.0, 498.0, 502.0]
        samples_cy = [180.0] * 7
        samples_sid = [1, 1, 1, 2, 2, 2, 2]
        segments, keyframes = _build_hard_cut_segments(
            samples_t,
            samples_cx,
            samples_cy,
            samples_sid,
            crop_w=200,
            crop_h=360,
            frame_w=640,
            frame_h=360,
            duration=3.0,
            min_shot_seconds=0.8,
        )
        self.assertGreaterEqual(len(segments), 2)
        self.assertEqual(segments[0].speaker_id, 1)
        self.assertEqual(segments[-1].speaker_id, 2)
        # No keyframe should sit between the two crop clusters
        xs = sorted({kf.crop_x for kf in keyframes})
        self.assertGreaterEqual(len(xs), 2)
        left_x, right_x = xs[0], xs[-1]
        self.assertLess(left_x, 200)
        self.assertGreater(right_x, 250)
        for kf in keyframes:
            # Every keyframe must be near a segment crop (hard cut, not pan)
            nearest = min(abs(kf.crop_x - s.crop_x) for s in segments)
            self.assertLess(nearest, 8)

    def test_hard_cut_merges_short_jitter_shots(self):
        samples_t = [0.0, 0.4, 0.8, 1.0, 1.2, 2.0, 2.5]
        samples_cx = [100.0, 100.0, 100.0, 500.0, 100.0, 100.0, 100.0]
        samples_cy = [180.0] * 7
        samples_sid = [1, 1, 1, 2, 1, 1, 1]  # brief flicker to speaker 2
        segments, _ = _build_hard_cut_segments(
            samples_t,
            samples_cx,
            samples_cy,
            samples_sid,
            crop_w=200,
            crop_h=360,
            frame_w=640,
            frame_h=360,
            duration=2.5,
            min_shot_seconds=1.0,
        )
        # Flicker should be absorbed — mostly one speaker
        speaker_ids = {s.speaker_id for s in segments}
        self.assertIn(1, speaker_ids)
        self.assertLessEqual(len(segments), 2)

    def test_two_speaker_plan_uses_hard_cut_style(self):
        tmp = tempfile.mkdtemp()
        try:
            vid = _make_two_speaker_video(Path(tmp) / "duo.mp4")
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            plan = compute_reframe_plan(
                vid,
                aspect="9:16",
                sample_fps=5,
                max_samples=30,
                model_cache_dir=model_dir,
                speaker_focus=True,
                switch_style="hard_cut",
                min_shot_seconds=0.6,
            )
            self.assertEqual(plan.switch_style, "hard_cut")
            # If we got animated cuts, crops should jump (not densely interpolate)
            if len(plan.keyframes) >= 2:
                xs = [k.crop_x for k in plan.keyframes]
                # Adjacent keyframes that differ should jump by a large amount
                jumps = [abs(xs[i] - xs[i - 1]) for i in range(1, len(xs))]
                big = [j for j in jumps if j > 40]
                tiny = [j for j in jumps if 4 < j < 25]
                # Prefer discrete jumps over a trail of small pans
                self.assertGreaterEqual(len(big) + jumps.count(0), len(tiny))
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_framing_segment_roundtrip(self):
        seg = FramingSegment(start=0.0, end=1.5, crop_x=40, crop_y=10, speaker_id=2)
        restored = FramingSegment.from_dict(seg.to_dict())
        self.assertEqual(restored.speaker_id, 2)
        self.assertEqual(restored.crop_x, 40)


if __name__ == "__main__":
    unittest.main()
