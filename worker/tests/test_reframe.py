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
    _panel_pixel_sizes,
    _pane_crop_in_zone,
    _point_in_zone,
    _reaction_content_crop,
    _reaction_source_zones,
    _rect_overlap_area,
    compute_dual_layout_plan,
    compute_reframe_plan,
    ffmpeg_crop_filter,
    ffmpeg_split_filter_complex,
    write_sendcmd,
)
from pipeline.render import OUTPUT_PRESETS, render_clip


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


def _make_reaction_video(path: Path, frames: int = 30, fps: int = 10) -> Path:
    """Classic reaction layout: content PiP on left, large reactor face on right."""
    w, h = 960, 540
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (w, h))
    for i in range(frames):
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        frame[:] = (28, 30, 34)
        # Left: "content" panel with a smaller face
        cv2.rectangle(frame, (20, 80), (340, 460), (60, 90, 140), -1)
        lx, ly = 180, 260
        cv2.rectangle(frame, (lx - 35, ly - 45), (lx + 35, ly + 45), (180, 140, 200), -1)
        cv2.circle(frame, (lx - 12, ly - 10), 4, (20, 20, 20), -1)
        cv2.circle(frame, (lx + 12, ly - 10), 4, (20, 20, 20), -1)
        # Right: large reactor face
        rx, ry = 720, 270
        cv2.rectangle(frame, (rx - 70, ry - 90), (rx + 70, ry + 90), (210, 190, 170), -1)
        cv2.circle(frame, (rx - 22, ry - 20), 8, (20, 20, 20), -1)
        cv2.circle(frame, (rx + 22, ry - 20), 8, (20, 20, 20), -1)
        mouth_y = ry + 35 + (i % 3) * 3
        cv2.rectangle(frame, (rx - 24, mouth_y), (rx + 24, mouth_y + 10), (40, 20, 20), -1)
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

    def test_split_stack_plan_has_two_panes(self):
        tmp = tempfile.mkdtemp()
        try:
            vid = _make_two_speaker_video(Path(tmp) / "split.mp4")
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            plan = compute_dual_layout_plan(
                vid,
                layout="split_stack",
                aspect="9:16",
                model_cache_dir=model_dir,
            )
            self.assertEqual(plan.layout, "split_stack")
            self.assertGreaterEqual(len(plan.panes), 2)
            roles = {p.role for p in plan.panes}
            self.assertIn("top", roles)
            self.assertIn("bottom", roles)
            # Panes should target different horizontal regions when two faces exist
            if not plan.used_center_fallback:
                xs = sorted(p.crop_x for p in plan.panes)
                self.assertGreater(xs[-1] - xs[0], 20)
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_reaction_stack_filter_complex(self):
        tmp = tempfile.mkdtemp()
        try:
            vid = _make_two_speaker_video(Path(tmp) / "react.mp4")
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            plan = compute_dual_layout_plan(
                vid,
                layout="reaction_stack",
                aspect="9:16",
                model_cache_dir=model_dir,
                focal_x=0.2,
                fit_mode="contain",
            )
            self.assertEqual(plan.layout, "reaction_stack")
            self.assertEqual(plan.fit_mode, "contain")
            fc = ffmpeg_split_filter_complex(plan, out_w=1080, out_h=1920, ass_path=None)
            self.assertIn("vstack", fc)
            self.assertIn("boxblur", fc)
            self.assertIn("force_original_aspect_ratio=decrease", fc)
            self.assertIn("split=2", fc)
            self.assertIn("[vout]", fc)
            self.assertEqual(fc.count("ass="), 0)
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_panel_sizes_for_aspects_and_stacks(self):
        # 9:16 top/bottom 50/50
        (pw, ph), (sw, sh) = _panel_pixel_sizes(1080, 1920, "top_bottom", 0.5)
        self.assertEqual(pw + 0, 1080)
        self.assertEqual(ph + sh, 1920)
        # 1:1 side-by-side
        (pw, ph), (sw, sh) = _panel_pixel_sizes(1080, 1080, "side_by_side", 0.5)
        self.assertEqual(ph, 1080)
        self.assertEqual(pw + sw, 1080)
        # 16:9 top-heavy
        (pw, ph), (sw, sh) = _panel_pixel_sizes(1920, 1080, "top_bottom", 0.6)
        self.assertEqual(pw, 1920)
        self.assertEqual(ph + sh, 1080)
        self.assertGreater(ph, sh)

    def test_side_by_side_uses_hstack(self):
        tmp = tempfile.mkdtemp()
        try:
            vid = _make_reaction_video(Path(tmp) / "sbs.mp4")
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            plan = compute_dual_layout_plan(
                vid,
                layout="reaction_stack",
                aspect="16:9",
                model_cache_dir=model_dir,
                stack_direction="side_by_side",
                panel_ratio=0.45,
                fit_mode="contain",
            )
            self.assertEqual(plan.stack_direction, "side_by_side")
            roles = {p.role for p in plan.panes}
            self.assertEqual(roles, {"left", "right"})
            fc = ffmpeg_split_filter_complex(plan, out_w=1920, out_h=1080, ass_path=None)
            self.assertIn("hstack", fc)
            self.assertNotIn("vstack", fc)
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_reaction_zones_are_non_overlapping(self):
        frame_w, frame_h = 960, 540
        reactor = (720.0, 270.0, 140.0, 180.0)
        rz, cz = _reaction_source_zones(reactor, frame_w, frame_h)
        r_box = (rz[0], rz[1], rz[0] + rz[2], rz[1] + rz[3])
        c_box = (cz[0], cz[1], cz[0] + cz[2], cz[1] + cz[3])
        self.assertEqual(_rect_overlap_area(r_box, c_box), 0.0)
        # Reactor center belongs only to the reactor zone.
        self.assertTrue(_point_in_zone(reactor[0], reactor[1], rz))
        self.assertFalse(_point_in_zone(reactor[0], reactor[1], cz))

    def test_reaction_content_crop_excludes_reactor(self):
        """Bottom pane must not center on the reactor (no character duplication)."""
        frame_w, frame_h = 960, 540
        # Reactor on the right (classic YouTube reaction layout).
        reactor = (720.0, 270.0, 140.0, 180.0)
        bx, by, bw, bh = _reaction_content_crop(reactor, frame_w, frame_h)
        # Content crop should sit on the left — reactor center outside it.
        self.assertLess(bx + bw / 2, frame_w * 0.5)
        self.assertFalse(bx <= reactor[0] <= bx + bw and by <= reactor[1] <= by + bh)

    def test_pane_crop_in_zone_never_escapes_zone(self):
        zone = (0, 0, 400, 540)
        # Subject near the right edge of the zone — crop must stay inside.
        subject = (390.0, 270.0, 80.0, 100.0)
        x, y, w, h = _pane_crop_in_zone(subject, zone, tightness=1.2)
        self.assertGreaterEqual(x, zone[0])
        self.assertGreaterEqual(y, zone[1])
        self.assertLessEqual(x + w, zone[0] + zone[2])
        self.assertLessEqual(y + h, zone[1] + zone[3])

    def test_reaction_stack_panes_separate_reactor_and_content(self):
        tmp = tempfile.mkdtemp()
        try:
            vid = _make_reaction_video(Path(tmp) / "reaction.mp4")
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            plan = compute_dual_layout_plan(
                vid,
                layout="reaction_stack",
                aspect="9:16",
                model_cache_dir=model_dir,
            )
            self.assertEqual(plan.layout, "reaction_stack")
            top = next(p for p in plan.panes if p.role == "top")
            bot = next(p for p in plan.panes if p.role == "bottom")
            # Top should favor the right-side reactor; bottom the left content.
            top_cx = top.crop_x + top.crop_w / 2
            bot_cx = bot.crop_x + bot.crop_w / 2
            self.assertGreater(top_cx, bot_cx)
            # Panel crops must not share pixels (the duplication bug).
            top_box = (
                float(top.crop_x),
                float(top.crop_y),
                float(top.crop_x + top.crop_w),
                float(top.crop_y + top.crop_h),
            )
            bot_box = (
                float(bot.crop_x),
                float(bot.crop_y),
                float(bot.crop_x + bot.crop_w),
                float(bot.crop_y + bot.crop_h),
            )
            self.assertEqual(_rect_overlap_area(top_box, bot_box), 0.0)
            # Creator face center (~720) must not land in the bottom crop.
            self.assertFalse(
                bot.crop_x <= 720 <= bot.crop_x + bot.crop_w
                and bot.crop_y <= 270 <= bot.crop_y + bot.crop_h
            )
            fc = ffmpeg_split_filter_complex(plan, out_w=1080, out_h=1920, ass_path=None)
            self.assertIn(f"crop={top.crop_w}:{top.crop_h}:{top.crop_x}:{top.crop_y}", fc)
            self.assertIn(f"crop={bot.crop_w}:{bot.crop_h}:{bot.crop_x}:{bot.crop_y}", fc)
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)

    def test_export_reaction_mp4_aspects_no_clip_overlap(self):
        """Real FFmpeg export across 9:16 / 1:1 / 16:9 — verify dimensions + non-black frames."""
        tmp = Path(tempfile.mkdtemp())
        try:
            vid = _make_reaction_video(tmp / "reaction_src.mp4", frames=24, fps=8)
            model_dir = Path(tempfile.gettempdir()) / "shortlio-mp-models"
            for aspect in ("9:16", "1:1", "16:9"):
                plan = compute_dual_layout_plan(
                    vid,
                    layout="reaction_stack",
                    aspect=aspect,
                    model_cache_dir=model_dir,
                    fit_mode="contain",
                    stack_direction="top_bottom",
                    panel_ratio=0.5,
                )
                out = tmp / f"out_{aspect.replace(':', 'x')}.mp4"
                render_clip(
                    input_path=vid,
                    output_path=out,
                    plan=plan,
                    ass_path=None,
                    aspect=aspect,
                    quality="draft",
                    burn_captions=False,
                )
                self.assertTrue(out.exists() and out.stat().st_size > 1000)
                cap = cv2.VideoCapture(str(out))
                self.assertTrue(cap.isOpened())
                ew, eh = OUTPUT_PRESETS[aspect]
                # draft quality scales to 0.75
                expect_w = int(ew * 0.75) // 2 * 2
                expect_h = int(eh * 0.75) // 2 * 2
                got_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                got_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                self.assertEqual((got_w, got_h), (expect_w, expect_h), aspect)
                # Sample a mid frame — should not be flat black / empty.
                frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_count // 2))
                ok, frame = cap.read()
                cap.release()
                self.assertTrue(ok, aspect)
                mean = float(np.mean(frame))
                self.assertGreater(mean, 8.0, f"{aspect} frame too dark/empty")
                # Top and bottom halves should both have content (not one empty).
                mid = frame.shape[0] // 2
                top_mean = float(np.mean(frame[:mid]))
                bot_mean = float(np.mean(frame[mid:]))
                self.assertGreater(top_mean, 5.0, aspect)
                self.assertGreater(bot_mean, 5.0, aspect)
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
