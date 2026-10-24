from __future__ import annotations

import hashlib
import json
import logging
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_FACE_CASCADE: cv2.CascadeClassifier | None = None
_MP_DETECTOR = None
_MP_MODEL_PATH: Path | None = None

_MEDIAPIPE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)

ASPECT_MAP = {
    "9:16": 9 / 16,
    "1:1": 1.0,
    "16:9": 16 / 9,
}


@dataclass
class CropKeyframe:
    t: float
    crop_x: int
    crop_y: int

    def to_dict(self) -> dict[str, Any]:
        return {"t": self.t, "crop_x": self.crop_x, "crop_y": self.crop_y}


@dataclass
class FramingSegment:
    """Discrete framing window — fixed crop from start→end (hard cut at boundaries)."""

    start: float
    end: float
    crop_x: int
    crop_y: int
    speaker_id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "crop_x": self.crop_x,
            "crop_y": self.crop_y,
            "speaker_id": self.speaker_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FramingSegment:
        return cls(
            start=float(data["start"]),
            end=float(data["end"]),
            crop_x=int(data["crop_x"]),
            crop_y=int(data["crop_y"]),
            speaker_id=int(data["speaker_id"]) if data.get("speaker_id") is not None else None,
        )


@dataclass
class SplitPane:
    """One panel crop from the source (stacked or side-by-side in the output)."""

    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int
    role: str = "top"  # "top" | "bottom" | "left" | "right"

    def to_dict(self) -> dict[str, Any]:
        return {
            "crop_x": self.crop_x,
            "crop_y": self.crop_y,
            "crop_w": self.crop_w,
            "crop_h": self.crop_h,
            "role": self.role,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SplitPane:
        return cls(
            crop_x=int(data["crop_x"]),
            crop_y=int(data["crop_y"]),
            crop_w=int(data["crop_w"]),
            crop_h=int(data["crop_h"]),
            role=str(data.get("role") or "top"),
        )


@dataclass
class ReframePlan:
    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int
    used_center_fallback: bool
    aspect: str
    keyframes: list[CropKeyframe] = field(default_factory=list)
    segments: list[FramingSegment] = field(default_factory=list)
    detector: str = "haar"
    focal_x: float | None = None
    switch_style: str = "hard_cut"
    # single = classic crop; split_stack = two speakers up/down;
    # reaction_stack = reactor + reacted-to content.
    layout: str = "single"
    panes: list[SplitPane] = field(default_factory=list)
    # Dual-layout composition (ignored for layout=single).
    stack_direction: str = "top_bottom"  # top_bottom | bottom_top | side_by_side
    panel_ratio: float = 0.5  # primary (reactor) panel share of the canvas
    fit_mode: str = "contain"  # contain (+ blur) | cover (fill + crop)

    def to_dict(self) -> dict[str, Any]:
        return {
            "crop_x": self.crop_x,
            "crop_y": self.crop_y,
            "crop_w": self.crop_w,
            "crop_h": self.crop_h,
            "used_center_fallback": self.used_center_fallback,
            "aspect": self.aspect,
            "keyframes": [k.to_dict() for k in self.keyframes],
            "segments": [s.to_dict() for s in self.segments],
            "detector": self.detector,
            "focal_x": self.focal_x,
            "switch_style": self.switch_style,
            "layout": self.layout,
            "panes": [p.to_dict() for p in self.panes],
            "stack_direction": self.stack_direction,
            "panel_ratio": self.panel_ratio,
            "fit_mode": self.fit_mode,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ReframePlan:
        kfs = [
            CropKeyframe(t=float(k["t"]), crop_x=int(k["crop_x"]), crop_y=int(k["crop_y"]))
            for k in (data.get("keyframes") or [])
        ]
        segs = [FramingSegment.from_dict(s) for s in (data.get("segments") or [])]
        panes = [SplitPane.from_dict(p) for p in (data.get("panes") or [])]
        return cls(
            crop_x=int(data["crop_x"]),
            crop_y=int(data["crop_y"]),
            crop_w=int(data["crop_w"]),
            crop_h=int(data["crop_h"]),
            used_center_fallback=bool(data.get("used_center_fallback")),
            aspect=str(data.get("aspect") or "9:16"),
            keyframes=kfs,
            segments=segs,
            detector=str(data.get("detector") or "haar"),
            focal_x=float(data["focal_x"]) if data.get("focal_x") is not None else None,
            switch_style=str(data.get("switch_style") or "hard_cut"),
            layout=str(data.get("layout") or "single"),
            panes=panes,
            stack_direction=str(data.get("stack_direction") or "top_bottom"),
            panel_ratio=float(data.get("panel_ratio") or 0.5),
            fit_mode=str(data.get("fit_mode") or "contain"),
        )


def _face_cascade() -> cv2.CascadeClassifier:
    global _FACE_CASCADE
    if _FACE_CASCADE is None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _FACE_CASCADE = cv2.CascadeClassifier(path)
    return _FACE_CASCADE


def _ensure_mediapipe_model(cache_dir: Path) -> Path | None:
    global _MP_MODEL_PATH
    if _MP_MODEL_PATH and _MP_MODEL_PATH.exists():
        return _MP_MODEL_PATH
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / "blaze_face_short_range.tflite"
    if dest.exists() and dest.stat().st_size > 1000:
        _MP_MODEL_PATH = dest
        return dest
    try:
        logger.info("Downloading MediaPipe face model…")
        urllib.request.urlretrieve(_MEDIAPIPE_MODEL_URL, dest)
        _MP_MODEL_PATH = dest
        return dest
    except Exception as exc:
        logger.warning("MediaPipe model download failed: %s", exc)
        return None


def _mediapipe_detector(cache_dir: Path):
    global _MP_DETECTOR
    if _MP_DETECTOR is not None:
        return _MP_DETECTOR
    try:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
    except Exception as exc:
        logger.info("MediaPipe unavailable: %s", exc)
        return None
    model = _ensure_mediapipe_model(cache_dir)
    if not model:
        return None
    try:
        options = vision.FaceDetectorOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.IMAGE,
            min_detection_confidence=0.45,
        )
        _MP_DETECTOR = vision.FaceDetector.create_from_options(options)
        return _MP_DETECTOR
    except Exception as exc:
        logger.warning("MediaPipe FaceDetector init failed: %s", exc)
        return None


def _detect_faces_mediapipe(
    frame: np.ndarray, detector
) -> list[tuple[float, float, float, float]]:
    """Return list of (cx, cy, w, h) in full-frame coords."""
    try:
        from mediapipe import Image as MpImage
        from mediapipe import ImageFormat
    except Exception:
        return []
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = MpImage(image_format=ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)
    out: list[tuple[float, float, float, float]] = []
    h, w = frame.shape[:2]
    for det in result.detections or []:
        box = det.bounding_box
        if box is None:
            continue
        fw = float(box.width)
        fh = float(box.height)
        cx = float(box.origin_x) + fw / 2
        cy = float(box.origin_y) + fh / 2
        # Bias upward so upper body stays in frame
        cy = max(0.0, cy - fh * 0.25)
        out.append((cx, cy, fw, fh))
    return out


def _detect_faces_haar(frame: np.ndarray) -> list[tuple[float, float, float, float]]:
    h, w = frame.shape[:2]
    scale = 480 / max(h, w) if max(h, w) > 480 else 1.0
    small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    faces = _face_cascade().detectMultiScale(
        gray, scaleFactor=1.15, minNeighbors=4, minSize=(28, 28)
    )
    inv = 1.0 / scale
    out: list[tuple[float, float, float, float]] = []
    for x, y, fw, fh in faces:
        cx = (x + fw / 2) * inv
        cy = (y + fh / 2) * inv - (fh * inv) * 0.25
        out.append((cx, max(0.0, cy), fw * inv, fh * inv))
    return out


def _detect_person_hog(frame: np.ndarray) -> tuple[float, float] | None:
    """Fallback: HOG full-body — return torso-ish center."""
    h, w = frame.shape[:2]
    scale = 640 / max(h, w) if max(h, w) > 640 else 1.0
    small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    rects, weights = hog.detectMultiScale(small, winStride=(8, 8), padding=(8, 8), scale=1.05)
    if len(rects) == 0:
        return None
    # Pick highest-weight / largest
    best_i = int(np.argmax([rw * rh for (_, _, rw, rh) in rects])) if len(rects) else 0
    if len(weights):
        best_i = int(np.argmax(weights))
    x, y, rw, rh = rects[best_i]
    inv = 1.0 / scale
    cx = (x + rw / 2) * inv
    cy = (y + rh * 0.35) * inv  # upper body
    return cx, cy


def _pick_subject(
    faces: list[tuple[float, float, float, float]],
    prev: tuple[float, float] | None,
) -> tuple[float, float] | None:
    if not faces:
        return None
    if prev is None:
        cx, cy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        return cx, cy
    px, py = prev
    best = min(faces, key=lambda f: (f[0] - px) ** 2 + (f[1] - py) ** 2)
    dist = ((best[0] - px) ** 2 + (best[1] - py) ** 2) ** 0.5
    if dist > max(best[2], best[3]) * 4:
        cx, cy, _, _ = max(faces, key=lambda f: f[2] * f[3])
        return cx, cy
    return best[0], best[1]


@dataclass
class _SpeakerTrack:
    id: int
    cx: float
    cy: float
    w: float
    h: float
    mouth_score: float = 0.0
    age: int = 0
    missed: int = 0
    prev_mouth: np.ndarray | None = None


def _mouth_roi(frame: np.ndarray, face: tuple[float, float, float, float]) -> np.ndarray | None:
    """Lower ~40% of the face box — proxy for lip motion."""
    cx, cy, fw, fh = face
    x1 = int(max(0, cx - fw * 0.45))
    x2 = int(min(frame.shape[1], cx + fw * 0.45))
    y1 = int(max(0, cy + fh * 0.05))
    y2 = int(min(frame.shape[0], cy + fh * 0.55))
    if x2 - x1 < 6 or y2 - y1 < 6:
        return None
    gray = cv2.cvtColor(frame[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (32, 24))


def _mouth_activity(prev: np.ndarray | None, cur: np.ndarray | None) -> float:
    if prev is None or cur is None:
        return 0.0
    if prev.shape != cur.shape:
        return 0.0
    diff = cv2.absdiff(prev, cur)
    return float(np.mean(diff))


def _match_faces_to_tracks(
    tracks: list[_SpeakerTrack],
    faces: list[tuple[float, float, float, float]],
    frame: np.ndarray,
    next_id: int,
) -> tuple[list[_SpeakerTrack], int]:
    """Greedy IoU/distance match — keeps stable speaker IDs across frames."""
    if not faces:
        for tr in tracks:
            tr.missed += 1
        return [tr for tr in tracks if tr.missed <= 4], next_id

    used_faces: set[int] = set()
    for tr in tracks:
        best_i = -1
        best_d = 1e18
        for i, face in enumerate(faces):
            if i in used_faces:
                continue
            cx, cy, fw, fh = face
            d = (cx - tr.cx) ** 2 + (cy - tr.cy) ** 2
            thresh = (max(tr.w, fw) * 1.8) ** 2
            if d < best_d and d < thresh:
                best_d = d
                best_i = i
        if best_i >= 0:
            face = faces[best_i]
            used_faces.add(best_i)
            mouth = _mouth_roi(frame, face)
            activity = _mouth_activity(tr.prev_mouth, mouth)
            tr.cx, tr.cy, tr.w, tr.h = face
            tr.mouth_score = 0.55 * tr.mouth_score + 0.45 * activity
            tr.prev_mouth = mouth
            tr.age += 1
            tr.missed = 0
        else:
            tr.missed += 1

    tracks = [tr for tr in tracks if tr.missed <= 4]
    for i, face in enumerate(faces):
        if i in used_faces:
            continue
        mouth = _mouth_roi(frame, face)
        tracks.append(
            _SpeakerTrack(
                id=next_id,
                cx=face[0],
                cy=face[1],
                w=face[2],
                h=face[3],
                mouth_score=0.0,
                age=1,
                prev_mouth=mouth,
            )
        )
        next_id += 1
    return tracks, next_id


def _active_speaker_id(
    tracks: list[_SpeakerTrack],
    current: int | None,
    pending: int | None,
    pending_hits: int,
    *,
    confirm: int = 2,
) -> tuple[int | None, int | None, int]:
    """Pick speaking face (mouth motion + size). Hysteresis avoids flicker."""
    live = [tr for tr in tracks if tr.missed == 0]
    if not live:
        return current, pending, pending_hits

    def score(tr: _SpeakerTrack) -> float:
        area = tr.w * tr.h
        return tr.mouth_score * 3.0 + (area / 10000.0)

    best = max(live, key=score)
    if current is None:
        return best.id, None, 0
    cur_tr = next((t for t in live if t.id == current), None)
    # Stay on current unless another clearly wins
    if cur_tr is not None and score(best) < score(cur_tr) * 1.25 and best.id == current:
        return current, None, 0
    if best.id == current:
        return current, None, 0
    # Require sustained win before switching (Opus-style)
    if pending == best.id:
        pending_hits += 1
    else:
        pending = best.id
        pending_hits = 1
    if pending_hits >= confirm:
        return best.id, None, 0
    return current, pending, pending_hits


def _ema(values: list[float], alpha: float = 0.28) -> list[float]:
    if not values:
        return values
    out = [values[0]]
    for v in values[1:]:
        out.append(alpha * v + (1 - alpha) * out[-1])
    return out


def _crop_dims(frame_w: int, frame_h: int, target_ratio: float) -> tuple[int, int]:
    src_ratio = frame_w / max(frame_h, 1)
    if src_ratio > target_ratio:
        crop_h = frame_h
        crop_w = int(crop_h * target_ratio)
    else:
        crop_w = frame_w
        crop_h = int(crop_w / target_ratio)
    return min(crop_w, frame_w), min(crop_h, frame_h)


def _clamp_crop(cx: float, cy: float, crop_w: int, crop_h: int, frame_w: int, frame_h: int) -> tuple[int, int]:
    x = int(max(0, min(frame_w - crop_w, cx - crop_w / 2)))
    y = int(max(0, min(frame_h - crop_h, cy - crop_h / 2)))
    return x, y


def _apply_deadzone(
    prev_cx: float,
    prev_cy: float,
    cx: float,
    cy: float,
    crop_w: int,
    crop_h: int,
    deadzone: float = 0.18,
) -> tuple[float, float]:
    """Keep crop still unless subject drifts near the edge of the frame window."""
    # Subject position relative to previous crop center
    dx = abs(cx - prev_cx) / max(crop_w, 1)
    dy = abs(cy - prev_cy) / max(crop_h, 1)
    if dx < deadzone and dy < deadzone:
        return prev_cx, prev_cy
    # Soft follow — only move partway
    return prev_cx + (cx - prev_cx) * 0.55, prev_cy + (cy - prev_cy) * 0.55


def tracking_cache_path(
    cache_root: Path,
    video_path: Path,
    aspect: str,
    focal_x: float | None,
    manual: bool,
    *,
    speaker_focus: bool = True,
    switch_style: str = "hard_cut",
    layout: str = "single",
    stack_direction: str = "top_bottom",
    panel_ratio: float = 0.5,
    fit_mode: str = "contain",
) -> Path:
    layout_key = (layout or "single").lower().strip()
    stack_key = (stack_direction or "top_bottom").lower().strip()
    fit_key = (fit_mode or "contain").lower().strip()
    pr = round(float(panel_ratio or 0.5), 3)
    try:
        st = video_path.stat()
        identity = (
            f"{video_path.resolve()}|{st.st_size}|{st.st_mtime_ns}|{aspect}|"
            f"{focal_x}|{manual}|speaker_focus={speaker_focus}|{switch_style}|"
            f"layout={layout_key}|stack={stack_key}|pr={pr}|fit={fit_key}|reaction_v4"
        )
    except OSError:
        identity = (
            f"{video_path}|{aspect}|{focal_x}|{manual}|"
            f"speaker_focus={speaker_focus}|{switch_style}|layout={layout_key}|"
            f"stack={stack_key}|pr={pr}|fit={fit_key}|reaction_v4"
        )
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:20]
    return cache_root / f"track_{digest}.json"


def _pane_crop_around(
    cx: float,
    cy: float,
    frame_w: int,
    frame_h: int,
    *,
    face_w: float = 0.0,
    face_h: float = 0.0,
    tightness: float = 1.0,
) -> tuple[int, int, int, int]:
    """Crop a ~9:8 window (half of 9:16) centered on a subject.

    ``tightness`` > 1 zooms in more on the face (used for reaction top pane).
    """
    # Each vertical half of 9:16 is 9:8.
    pane_ratio = 9 / 8
    crop_w, crop_h = _crop_dims(frame_w, frame_h, pane_ratio)
    t = max(0.6, float(tightness))
    # Prefer a tighter crop around the face when we know its size.
    if face_w > 0 and face_h > 0:
        base_frac = 0.55 / t
        face_mult = 3.2 / t
        tight_w = int(min(frame_w, max(crop_w * base_frac, face_w * face_mult)))
        tight_h = int(tight_w / pane_ratio)
        if tight_h <= frame_h and tight_w >= 64:
            crop_w, crop_h = tight_w, tight_h
    # Bias slightly up so heads aren't cropped.
    cy = max(0.0, cy - face_h * 0.15)
    x, y = _clamp_crop(cx, cy, crop_w, crop_h, frame_w, frame_h)
    return x, y, crop_w, crop_h


def _rect_overlap_area(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    return max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)


def _point_in_zone(cx: float, cy: float, zone: tuple[int, int, int, int]) -> bool:
    zx, zy, zw, zh = zone
    return zx <= cx < zx + zw and zy <= cy < zy + zh


def _reaction_source_zones(
    reactor: tuple[float, float, float, float],
    frame_w: int,
    frame_h: int,
) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Split the source into non-overlapping (reactor_zone, content_zone).

    Reaction videos are one file with two logical sources (creator + original).
    Zones never overlap so crop coordinates cannot be reused across panels.
    """
    rcx, rcy, rw, rh = reactor
    h_bias = abs(rcx / max(frame_w, 1) - 0.5)
    v_bias = abs(rcy / max(frame_h, 1) - 0.5)

    # Side-by-side (most common): vertical divider.
    if h_bias >= v_bias * 0.7 or h_bias > 0.1:
        gap = max(8, int(max(rw, 1) * 0.15))
        if rcx >= frame_w * 0.5:
            # Creator on right → original content on left.
            split = int(max(frame_w * 0.22, min(frame_w * 0.78, rcx - rw * 0.7)))
            split = max(gap, min(frame_w - gap, split))
            content_r = max(1, split - gap // 2)
            reactor_x = min(frame_w - 1, split + gap // 2)
            content_zone = (0, 0, content_r, frame_h)
            reactor_zone = (reactor_x, 0, max(1, frame_w - reactor_x), frame_h)
        else:
            # Creator on left → original content on right.
            split = int(max(frame_w * 0.22, min(frame_w * 0.78, rcx + rw * 0.7)))
            split = max(gap, min(frame_w - gap, split))
            reactor_r = max(1, split - gap // 2)
            content_x = min(frame_w - 1, split + gap // 2)
            reactor_zone = (0, 0, reactor_r, frame_h)
            content_zone = (content_x, 0, max(1, frame_w - content_x), frame_h)
        return reactor_zone, content_zone

    # Stacked in source: horizontal divider.
    gap = max(8, int(max(rh, 1) * 0.15))
    if rcy < frame_h * 0.5:
        split = int(max(frame_h * 0.22, min(frame_h * 0.78, rcy + rh * 0.75)))
        split = max(gap, min(frame_h - gap, split))
        reactor_zone = (0, 0, frame_w, max(1, split - gap // 2))
        y0 = min(frame_h - 1, split + gap // 2)
        content_zone = (0, y0, frame_w, max(1, frame_h - y0))
    else:
        split = int(max(frame_h * 0.22, min(frame_h * 0.78, rcy - rh * 0.75)))
        split = max(gap, min(frame_h - gap, split))
        content_zone = (0, 0, frame_w, max(1, split - gap // 2))
        y0 = min(frame_h - 1, split + gap // 2)
        reactor_zone = (0, y0, frame_w, max(1, frame_h - y0))
    return reactor_zone, content_zone


def _even_dim(n: int) -> int:
    return max(2, int(n) // 2 * 2)


def _panel_pixel_sizes(
    out_w: int,
    out_h: int,
    stack_direction: str,
    panel_ratio: float,
) -> tuple[tuple[int, int], tuple[int, int]]:
    """Return ((primary_w, primary_h), (secondary_w, secondary_h))."""
    pr = max(0.25, min(0.75, float(panel_ratio or 0.5)))
    direction = (stack_direction or "top_bottom").lower().strip()
    if direction == "side_by_side":
        primary_w = _even_dim(int(out_w * pr))
        secondary_w = max(2, out_w - primary_w)
        if secondary_w % 2:
            primary_w -= 1
            secondary_w += 1
        return (primary_w, out_h), (secondary_w, out_h)
    primary_h = _even_dim(int(out_h * pr))
    secondary_h = max(2, out_h - primary_h)
    if secondary_h % 2:
        primary_h -= 1
        secondary_h += 1
    return (out_w, primary_h), (out_w, secondary_h)


def _panel_aspect_ratio(
    output_aspect: float,
    stack_direction: str,
    panel_ratio: float,
    *,
    primary: bool,
) -> float:
    """Width/height of one output panel derived from the canvas aspect."""
    pr = max(0.25, min(0.75, float(panel_ratio or 0.5)))
    share = pr if primary else (1.0 - pr)
    direction = (stack_direction or "top_bottom").lower().strip()
    if direction == "side_by_side":
        return output_aspect * share
    return output_aspect / max(share, 0.01)


def _loose_zone_crop(
    subject: tuple[float, float, float, float],
    zone: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    """Nearly-full zone crop biased toward the subject — never cuts the zone short.

    Used with contain+blur so faces stay fully visible inside the panel.
    """
    zx, zy, zw, zh = zone
    if zw < 32 or zh < 32:
        return zx, zy, max(1, zw), max(1, zh)
    # Prefer the full zone so we don't invent empty margins or chop people.
    # Mild subject bias only when the zone is very wide relative to the face.
    cx, cy, fw, fh = subject
    if fw > 0 and zw > fw * 6:
        crop_w = max(int(fw * 4.5), int(zw * 0.72))
        crop_w = min(zw, max(64, crop_w))
        crop_h = zh
        x = int(max(zx, min(zx + zw - crop_w, cx - crop_w / 2)))
        return x, zy, crop_w, crop_h
    return zx, zy, zw, zh


def _cover_crop_in_zone(
    subject: tuple[float, float, float, float],
    zone: tuple[int, int, int, int],
    pane_ratio: float,
) -> tuple[int, int, int, int]:
    """Crop inside ``zone`` to ``pane_ratio``, centered on subject (fill mode)."""
    zx, zy, zw, zh = zone
    if zw < 32 or zh < 32:
        return zx, zy, max(1, zw), max(1, zh)
    crop_w, crop_h = _crop_dims(zw, zh, max(pane_ratio, 0.05))
    cx, cy, fw, fh = subject
    # Generous framing — avoid extreme face zoom that chops heads/shoulders.
    if fw > 0 and fh > 0:
        min_w = int(min(zw, max(fw * 3.8, crop_w * 0.7)))
        min_h = int(min_w / max(pane_ratio, 0.05))
        if min_h <= zh and min_w >= 64:
            # Expand toward full cover crop, never tighter than min around face.
            crop_w = max(min_w, crop_w)
            crop_h = int(crop_w / max(pane_ratio, 0.05))
            if crop_h > zh:
                crop_h = zh
                crop_w = int(crop_h * pane_ratio)
                crop_w = min(crop_w, zw)
    cy = max(float(zy), min(float(zy + zh), cy - max(fh, 0.0) * 0.2))
    x = int(max(zx, min(zx + zw - crop_w, cx - crop_w / 2)))
    y = int(max(zy, min(zy + zh - crop_h, cy - crop_h / 2)))
    return x, y, max(1, crop_w), max(1, crop_h)


def _pane_crop_in_zone(
    subject: tuple[float, float, float, float],
    zone: tuple[int, int, int, int],
    *,
    tightness: float = 1.0,
    pane_ratio: float = 9 / 8,
    fit_mode: str = "contain",
) -> tuple[int, int, int, int]:
    """Crop inside ``zone`` for a dual panel. Default contain keeps subjects whole."""
    _ = tightness
    mode = (fit_mode or "contain").lower().strip()
    if mode == "cover":
        return _cover_crop_in_zone(subject, zone, pane_ratio)
    return _loose_zone_crop(subject, zone)


def _zone_center_subject(
    zone: tuple[int, int, int, int],
) -> tuple[float, float, float, float]:
    zx, zy, zw, zh = zone
    return (
        zx + zw * 0.5,
        zy + zh * 0.42,
        max(zw * 0.3, 32.0),
        max(zh * 0.3, 32.0),
    )


def _pick_subject_in_zone(
    faces: list[tuple[float, float, float, float]],
    zone: tuple[int, int, int, int],
) -> tuple[float, float, float, float]:
    """Largest face whose center lies in ``zone``; else zone center fallback."""
    in_zone = [f for f in faces if _point_in_zone(f[0], f[1], zone)]
    if not in_zone:
        return _zone_center_subject(zone)
    return max(in_zone, key=lambda f: f[2] * f[3])


def _detect_faces_in_roi(
    frame: np.ndarray,
    zone: tuple[int, int, int, int],
    mp_det,
) -> list[tuple[float, float, float, float]]:
    """Run face detection only inside ``zone``; return full-frame coordinates."""
    zx, zy, zw, zh = zone
    h, w = frame.shape[:2]
    zx = max(0, min(w - 1, zx))
    zy = max(0, min(h - 1, zy))
    zw = max(1, min(w - zx, zw))
    zh = max(1, min(h - zy, zh))
    roi = frame[zy : zy + zh, zx : zx + zw]
    if roi.size == 0:
        return []
    faces: list[tuple[float, float, float, float]] = []
    if mp_det is not None:
        faces = _detect_faces_mediapipe(roi, mp_det)
    if not faces:
        faces = _detect_faces_haar(roi)
    # Map ROI-local centers back to full-frame coords.
    return [(cx + zx, cy + zy, fw, fh) for cx, cy, fw, fh in faces]


def _collect_zone_face_samples(
    video_path: Path,
    zone: tuple[int, int, int, int],
    *,
    model_cache_dir: Path | None = None,
    sample_fps: float = 1.5,
    max_samples: int = 24,
) -> tuple[str, list[tuple[float, float, float, float]]]:
    """Independent face samples for one logical source (reactor or content)."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(fps / sample_fps))
    cache_dir = model_cache_dir or (video_path.parent / ".models")
    mp_det = _mediapipe_detector(cache_dir)
    detector_name = "mediapipe" if mp_det is not None else "haar"

    faces_all: list[tuple[float, float, float, float]] = []
    idx = 0
    samples = 0
    while samples < max_samples:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            faces_all.extend(_detect_faces_in_roi(frame, zone, mp_det))
            samples += 1
        idx += 1
    cap.release()
    return detector_name, faces_all


def _reaction_content_crop(
    reactor: tuple[float, float, float, float],
    frame_w: int,
    frame_h: int,
    *,
    content_hint: tuple[float, float, float, float] | None = None,
) -> tuple[int, int, int, int]:
    """Backward-compatible helper: content crop inside the content zone only."""
    _reactor_zone, content_zone = _reaction_source_zones(reactor, frame_w, frame_h)
    if content_hint is not None and _point_in_zone(
        content_hint[0], content_hint[1], content_zone
    ):
        subject = content_hint
    else:
        subject = _zone_center_subject(content_zone)
    return _pane_crop_in_zone(subject, content_zone, fit_mode="contain")


def _normalize_stack_direction(raw: str | None) -> str:
    v = (raw or "top_bottom").lower().strip().replace("-", "_").replace(" ", "_")
    aliases = {
        "top": "top_bottom",
        "topbottom": "top_bottom",
        "bottom": "bottom_top",
        "bottomtop": "bottom_top",
        "side": "side_by_side",
        "sidebyside": "side_by_side",
        "horizontal": "side_by_side",
        "sbs": "side_by_side",
    }
    v = aliases.get(v, v)
    if v not in ("top_bottom", "bottom_top", "side_by_side"):
        return "top_bottom"
    return v


def _normalize_fit_mode(raw: str | None, *, layout: str) -> str:
    v = (raw or "").lower().strip()
    if v in ("contain", "fit", "blur", "letterbox"):
        return "contain"
    if v in ("cover", "fill", "crop"):
        return "cover"
    # Reaction defaults to contain (keep people whole + blur fill).
    return "contain" if layout == "reaction_stack" else "cover"


def _assign_dual_panes(
    reactor_crop: tuple[int, int, int, int],
    content_crop: tuple[int, int, int, int],
    stack_direction: str,
) -> list[SplitPane]:
    rx, ry, rw, rh = reactor_crop
    cx, cy, cw, ch = content_crop
    direction = _normalize_stack_direction(stack_direction)
    if direction == "bottom_top":
        return [
            SplitPane(cx, cy, cw, ch, role="top"),
            SplitPane(rx, ry, rw, rh, role="bottom"),
        ]
    if direction == "side_by_side":
        return [
            SplitPane(rx, ry, rw, rh, role="left"),
            SplitPane(cx, cy, cw, ch, role="right"),
        ]
    return [
        SplitPane(rx, ry, rw, rh, role="top"),
        SplitPane(cx, cy, cw, ch, role="bottom"),
    ]


def _collect_face_samples(
    video_path: Path,
    *,
    model_cache_dir: Path | None = None,
    sample_fps: float = 1.5,
    max_samples: int = 40,
) -> tuple[int, int, str, list[tuple[float, float, float, float]]]:
    """Sample faces across the clip. Returns (frame_w, frame_h, detector, faces)."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, int(fps / sample_fps))
    cache_dir = model_cache_dir or (video_path.parent / ".models")
    mp_det = _mediapipe_detector(cache_dir)
    detector_name = "mediapipe" if mp_det is not None else "haar"

    faces_all: list[tuple[float, float, float, float]] = []
    idx = 0
    samples = 0
    while samples < max_samples:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            faces: list[tuple[float, float, float, float]] = []
            if mp_det is not None:
                faces = _detect_faces_mediapipe(frame, mp_det)
            if not faces:
                faces = _detect_faces_haar(frame)
            faces_all.extend(faces)
            samples += 1
        idx += 1
    cap.release()
    return frame_w, frame_h, detector_name, faces_all


def _cluster_two_faces(
    faces: list[tuple[float, float, float, float]],
    frame_w: int,
) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]] | None:
    """Pick two stable speaker positions from sampled face boxes."""
    if len(faces) < 2:
        return None
    # Sort by x and split into left/right halves of the frame.
    left = [f for f in faces if f[0] < frame_w * 0.5]
    right = [f for f in faces if f[0] >= frame_w * 0.5]
    if left and right:
        def median_face(group: list[tuple[float, float, float, float]]):
            xs = sorted(f[0] for f in group)
            ys = sorted(f[1] for f in group)
            ws = sorted(f[2] for f in group)
            hs = sorted(f[3] for f in group)
            mid = len(group) // 2
            return xs[mid], ys[mid], ws[mid], hs[mid]

        return median_face(left), median_face(right)

    # Fallback: two largest faces that are far apart horizontally.
    ranked = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    a = ranked[0]
    b = None
    for cand in ranked[1:]:
        if abs(cand[0] - a[0]) > frame_w * 0.18:
            b = cand
            break
    if b is None:
        return None
    pair = sorted([a, b], key=lambda f: f[0])
    return pair[0], pair[1]


def compute_dual_layout_plan(
    video_path: Path,
    *,
    layout: str,
    aspect: str = "9:16",
    model_cache_dir: Path | None = None,
    focal_x: float | None = None,
    stack_direction: str = "top_bottom",
    panel_ratio: float = 0.5,
    fit_mode: str | None = None,
) -> ReframePlan:
    """Build a dual-panel plan: podcast split or reaction (creator + content).

    Panel pixel sizes are derived from ``aspect`` + ``stack_direction`` +
    ``panel_ratio``. Each logical source is cropped independently; FFmpeg then
    fits (contain+blur) or covers without stretching faces.
    """
    layout = (layout or "split_stack").lower().strip()
    if layout not in ("split_stack", "reaction_stack"):
        layout = "split_stack"
    if aspect not in ASPECT_MAP:
        aspect = "9:16"
    stack_direction = _normalize_stack_direction(stack_direction)
    fit_mode = _normalize_fit_mode(fit_mode, layout=layout)
    panel_ratio = max(0.25, min(0.75, float(panel_ratio or 0.5)))
    output_aspect = ASPECT_MAP[aspect]
    primary_pane_ratio = _panel_aspect_ratio(
        output_aspect, stack_direction, panel_ratio, primary=True
    )
    secondary_pane_ratio = _panel_aspect_ratio(
        output_aspect, stack_direction, panel_ratio, primary=False
    )

    frame_w, frame_h, detector_name, faces = _collect_face_samples(
        video_path, model_cache_dir=model_cache_dir
    )
    # Full-frame crop kept as fallback / metadata.
    full_w, full_h = _crop_dims(frame_w, frame_h, output_aspect)
    full_x, full_y = _clamp_crop(frame_w / 2, frame_h * 0.42, full_w, full_h, frame_w, frame_h)

    pair = _cluster_two_faces(faces, frame_w) if faces else None

    def _finish(
        reactor_crop: tuple[int, int, int, int],
        content_crop: tuple[int, int, int, int],
        *,
        used_fallback: bool,
        layout_name: str,
    ) -> ReframePlan:
        # Guarantee non-overlapping source crops.
        a = (
            float(reactor_crop[0]),
            float(reactor_crop[1]),
            float(reactor_crop[0] + reactor_crop[2]),
            float(reactor_crop[1] + reactor_crop[3]),
        )
        b = (
            float(content_crop[0]),
            float(content_crop[1]),
            float(content_crop[0] + content_crop[2]),
            float(content_crop[1] + content_crop[3]),
        )
        if _rect_overlap_area(a, b) > 1.0:
            # Fall back to zone centers if something went wrong.
            primary = (
                reactor_crop[0] + reactor_crop[2] / 2,
                reactor_crop[1] + reactor_crop[3] / 2,
                float(reactor_crop[2]),
                float(reactor_crop[3]),
            )
            rz, cz = _reaction_source_zones(primary, frame_w, frame_h)
            reactor_crop = _loose_zone_crop(_zone_center_subject(rz), rz)
            content_crop = _loose_zone_crop(_zone_center_subject(cz), cz)
        panes = _assign_dual_panes(reactor_crop, content_crop, stack_direction)
        return ReframePlan(
            crop_x=full_x,
            crop_y=full_y,
            crop_w=full_w,
            crop_h=full_h,
            used_center_fallback=used_fallback,
            aspect=aspect,
            detector=detector_name,
            focal_x=focal_x,
            switch_style="split",
            layout=layout_name,
            panes=panes,
            stack_direction=stack_direction,
            panel_ratio=panel_ratio,
            fit_mode=fit_mode,
        )

    if layout == "split_stack" and pair is not None:
        left, right = pair
        if abs(left[1] - right[1]) > abs(left[0] - right[0]) * 1.2:
            top_f, bot_f = sorted([left, right], key=lambda f: f[1])
        else:
            top_f, bot_f = left, right
        # Podcast: independent face crops (cover/contain per fit_mode).
        # Use synthetic zones around each face so crops never share pixels.
        def face_zone(f: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
            cx, cy, fw, fh = f
            zw = int(min(frame_w, max(fw * 5.0, frame_w * 0.35)))
            zh = int(min(frame_h, max(fh * 5.5, frame_h * 0.55)))
            x = int(max(0, min(frame_w - zw, cx - zw / 2)))
            y = int(max(0, min(frame_h - zh, cy - zh * 0.4)))
            return x, y, zw, zh

        z_top = face_zone(top_f)
        z_bot = face_zone(bot_f)
        reactor_crop = _pane_crop_in_zone(
            top_f, z_top, pane_ratio=primary_pane_ratio, fit_mode=fit_mode
        )
        content_crop = _pane_crop_in_zone(
            bot_f, z_bot, pane_ratio=secondary_pane_ratio, fit_mode=fit_mode
        )
        return _finish(reactor_crop, content_crop, used_fallback=False, layout_name="split_stack")

    # Seed reactor face for reaction (or split fallback).
    if faces:
        primary = max(faces, key=lambda f: f[2] * f[3])
        if focal_x is not None:
            primary = min(
                faces, key=lambda f: abs(f[0] / max(frame_w, 1) - float(focal_x))
            )
    else:
        primary = (frame_w * 0.5, frame_h * 0.35, frame_w * 0.2, frame_h * 0.25)

    if pair is not None:
        left, right = pair
        if focal_x is not None:
            primary = min(
                [left, right],
                key=lambda f: abs(f[0] / max(frame_w, 1) - float(focal_x)),
            )
        else:
            primary = max([left, right], key=lambda f: f[2] * f[3])

    reactor_zone, content_zone = _reaction_source_zones(primary, frame_w, frame_h)

    if layout == "reaction_stack":
        # Independent detection inside each zone (never share bounding boxes).
        _det_r, reactor_faces = _collect_zone_face_samples(
            video_path, reactor_zone, model_cache_dir=model_cache_dir
        )
        _det_c, content_faces = _collect_zone_face_samples(
            video_path, content_zone, model_cache_dir=model_cache_dir
        )
        reactor_subject = _pick_subject_in_zone(reactor_faces, reactor_zone)
        if not reactor_faces and _point_in_zone(primary[0], primary[1], reactor_zone):
            reactor_subject = primary
        content_subject = _pick_subject_in_zone(content_faces, content_zone)

        reactor_crop = _pane_crop_in_zone(
            reactor_subject,
            reactor_zone,
            pane_ratio=primary_pane_ratio,
            fit_mode=fit_mode,
        )
        content_crop = _pane_crop_in_zone(
            content_subject,
            content_zone,
            pane_ratio=secondary_pane_ratio,
            fit_mode=fit_mode,
        )
        return _finish(
            reactor_crop,
            content_crop,
            used_fallback=len(faces) < 1,
            layout_name="reaction_stack",
        )

    # Split fallback with <2 faces.
    reactor_crop = _pane_crop_around(
        primary[0],
        primary[1],
        frame_w,
        frame_h,
        face_w=primary[2],
        face_h=primary[3],
    )
    content_crop = _pane_crop_in_zone(
        _zone_center_subject(content_zone),
        content_zone,
        pane_ratio=secondary_pane_ratio,
        fit_mode=fit_mode,
    )
    return _finish(
        reactor_crop,
        content_crop,
        used_fallback=len(faces) < 1,
        layout_name="split_stack",
    )


def _ema_with_cuts(
    values: list[float],
    cut_flags: list[bool],
    alpha: float = 0.28,
) -> list[float]:
    """EMA that resets at hard-cut boundaries so crops never blend across speakers."""
    if not values:
        return values
    out = [values[0]]
    for i, v in enumerate(values[1:], start=1):
        if cut_flags[i]:
            out.append(v)
        else:
            out.append(alpha * v + (1 - alpha) * out[-1])
    return out


def _build_hard_cut_segments(
    samples_t: list[float],
    samples_cx: list[float],
    samples_cy: list[float],
    samples_sid: list[int | None],
    *,
    crop_w: int,
    crop_h: int,
    frame_w: int,
    frame_h: int,
    duration: float,
    min_shot_seconds: float,
) -> tuple[list[FramingSegment], list[CropKeyframe]]:
    """Collapse samples into fixed-crop segments; cuts are instantaneous (no pan)."""
    if not samples_t:
        return [], []

    raw: list[tuple[float, float, float, float, int | None]] = []
    i = 0
    n = len(samples_t)
    while i < n:
        sid = samples_sid[i]
        j = i + 1
        while j < n and samples_sid[j] == sid:
            j += 1
        cx = float(np.median(samples_cx[i:j]))
        cy = float(np.median(samples_cy[i:j]))
        start_t = samples_t[i]
        end_t = samples_t[j - 1]
        raw.append((start_t, end_t, cx, cy, sid))
        i = j

    # Merge shots shorter than min duration into the previous shot (anti-jitter).
    merged: list[tuple[float, float, float, float, int | None]] = []
    for start_t, end_t, cx, cy, sid in raw:
        span = max(0.0, end_t - start_t)
        if merged and span < min_shot_seconds and sid != merged[-1][4]:
            prev = merged[-1]
            merged[-1] = (prev[0], end_t, prev[2], prev[3], prev[4])
        elif merged and sid == merged[-1][4]:
            prev = merged[-1]
            merged[-1] = (prev[0], end_t, prev[2], prev[3], sid)
        else:
            merged.append((start_t, end_t, cx, cy, sid))

    if not merged:
        return [], []

    # Extend segment ends to the next start (and last to duration).
    segments: list[FramingSegment] = []
    keyframes: list[CropKeyframe] = []
    for idx, (start_t, end_t, cx, cy, sid) in enumerate(merged):
        next_start = merged[idx + 1][0] if idx + 1 < len(merged) else max(duration, end_t)
        crop_x, crop_y = _clamp_crop(cx, cy, crop_w, crop_h, frame_w, frame_h)
        seg_end = max(start_t, next_start)
        segments.append(
            FramingSegment(
                start=start_t,
                end=seg_end,
                crop_x=crop_x,
                crop_y=crop_y,
                speaker_id=sid,
            )
        )
        # One keyframe at the cut instant — FFmpeg sendcmd snaps x/y with no interpolation.
        keyframes.append(CropKeyframe(t=start_t, crop_x=crop_x, crop_y=crop_y))

    if keyframes and keyframes[0].t > 0.05:
        keyframes.insert(
            0,
            CropKeyframe(t=0.0, crop_x=keyframes[0].crop_x, crop_y=keyframes[0].crop_y),
        )
    if duration > 0 and keyframes and keyframes[-1].t < duration - 0.05:
        last = keyframes[-1]
        keyframes.append(CropKeyframe(t=duration, crop_x=last.crop_x, crop_y=last.crop_y))

    return segments, keyframes


def load_cached_plan(path: Path) -> ReframePlan | None:
    if not path.exists():
        return None
    try:
        return ReframePlan.from_dict(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return None


def save_plan(path: Path, plan: ReframePlan) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(plan.to_dict(), indent=2), encoding="utf-8")


def compute_reframe_plan(
    video_path: Path,
    aspect: str = "9:16",
    sample_fps: float = 2.0,
    max_samples: int = 90,
    *,
    focal_x: float | None = None,
    manual_override: bool = False,
    model_cache_dir: Path | None = None,
    speaker_focus: bool = True,
    switch_style: str = "hard_cut",
    min_shot_seconds: float = 1.2,
    transcript_speakers: list[tuple[float, float, str]] | None = None,
) -> ReframePlan:
    """Subject-aware reframing.

    ``switch_style="hard_cut"`` (default with speaker focus): OpusClip-style
    instant cuts between speakers — never eases/pans horizontally.
    ``switch_style="subject"``: ordinary single-subject tracking with smooth follow.
    """
    if aspect not in ASPECT_MAP:
        aspect = "9:16"
    target_ratio = ASPECT_MAP[aspect]
    style = (switch_style or "hard_cut").lower().strip()
    if style in ("smooth", "pan", "follow"):
        style = "subject"
    if style not in ("hard_cut", "subject"):
        style = "hard_cut"
    if not speaker_focus:
        style = "subject"

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / fps if frame_count > 0 else 0.0
    step = max(1, int(fps / sample_fps))

    crop_w, crop_h = _crop_dims(frame_w, frame_h, target_ratio)

    # Manual focal override — static crop at user X, vertical center-biased
    if manual_override and focal_x is not None:
        cap.release()
        fx = max(0.0, min(1.0, float(focal_x)))
        cx = fx * frame_w
        cy = frame_h * 0.42
        crop_x, crop_y = _clamp_crop(cx, cy, crop_w, crop_h, frame_w, frame_h)
        return ReframePlan(
            crop_x=crop_x,
            crop_y=crop_y,
            crop_w=crop_w,
            crop_h=crop_h,
            used_center_fallback=False,
            aspect=aspect,
            keyframes=[],
            segments=[],
            detector="manual",
            focal_x=fx,
            switch_style="manual",
        )

    cache_dir = model_cache_dir or (video_path.parent / ".models")
    mp_det = _mediapipe_detector(cache_dir)
    detector_name = "mediapipe" if mp_det is not None else "haar"

    samples_t: list[float] = []
    samples_cx: list[float] = []
    samples_cy: list[float] = []
    samples_sid: list[int | None] = []
    cut_flags: list[bool] = []
    prev: tuple[float, float] | None = None
    tracks: list[_SpeakerTrack] = []
    next_track_id = 1
    active_id: int | None = None
    pending_id: int | None = None
    pending_hits = 0
    last_switch_t = -1e9
    switches = 0
    idx = 0
    samples = 0
    misses = 0

    # Optional diarization labels → prefer face closest to that speaker's side.
    speaker_label_at = _speaker_label_lookup(transcript_speakers)

    while samples < max_samples:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            t = idx / fps
            faces: list[tuple[float, float, float, float]] = []
            if mp_det is not None:
                faces = _detect_faces_mediapipe(frame, mp_det)
            if not faces:
                faces = _detect_faces_haar(frame)

            tracks, next_track_id = _match_faces_to_tracks(
                tracks, faces, frame, next_track_id
            )
            prev_active = active_id

            if speaker_focus and len([tr for tr in tracks if tr.missed == 0]) >= 2:
                # Bias mouth scores with transcript speaker label when available
                label = speaker_label_at(t) if speaker_label_at else None
                if label:
                    _apply_transcript_speaker_bias(tracks, label, frame_w)
                active_id, pending_id, pending_hits = _active_speaker_id(
                    tracks, active_id, pending_id, pending_hits, confirm=2
                )
                # Minimum shot length — ignore confirmed switches that are too soon
                if (
                    prev_active is not None
                    and active_id is not None
                    and prev_active != active_id
                    and (t - last_switch_t) < min_shot_seconds
                ):
                    active_id = prev_active
                    pending_id = None
                    pending_hits = 0
            else:
                # Single-person / subject mode: stick to largest / nearest face
                active_tr_pick = None
                if tracks:
                    live = [tr for tr in tracks if tr.missed == 0]
                    if live:
                        active_tr_pick = max(live, key=lambda tr: tr.w * tr.h)
                        active_id = active_tr_pick.id

            if prev_active is not None and active_id is not None and prev_active != active_id:
                switches += 1
                last_switch_t = t

            active_tr = next((tr for tr in tracks if tr.id == active_id), None)
            if active_tr is not None:
                center = (active_tr.cx, active_tr.cy)
            else:
                center = _pick_subject(faces, prev)
                if center is None:
                    person = _detect_person_hog(frame)
                    if person:
                        center = person
                        if "hog" not in detector_name:
                            detector_name = detector_name + "+hog"

            switched = (
                speaker_focus
                and prev is not None
                and prev_active is not None
                and active_id is not None
                and prev_active != active_id
            )

            if center is not None:
                if style == "hard_cut":
                    # Hold framing on same speaker; snap instantly on switch (no ease/pan).
                    if prev is not None and not switched:
                        center = _apply_deadzone(
                            prev[0],
                            prev[1],
                            center[0],
                            center[1],
                            crop_w,
                            crop_h,
                            deadzone=0.22,
                        )
                    # else: keep new speaker center as-is (hard cut)
                else:
                    if prev is not None and not switched:
                        center = _apply_deadzone(
                            prev[0],
                            prev[1],
                            center[0],
                            center[1],
                            crop_w,
                            crop_h,
                            deadzone=0.16,
                        )
                    elif prev is not None and switched:
                        center = (
                            prev[0] + (center[0] - prev[0]) * 0.55,
                            prev[1] + (center[1] - prev[1]) * 0.55,
                        )
                samples_t.append(t)
                samples_cx.append(center[0])
                samples_cy.append(center[1])
                samples_sid.append(active_id)
                cut_flags.append(bool(switched))
                prev = center
                misses = 0
            else:
                misses += 1
                if prev is not None and misses <= 3:
                    samples_t.append(t)
                    samples_cx.append(prev[0])
                    samples_cy.append(prev[1])
                    samples_sid.append(active_id)
                    cut_flags.append(False)
            samples += 1
        idx += 1
    cap.release()
    if switches:
        detector_name = f"{detector_name}+speakerswitch"
        logger.info(
            "Speaker switches detected: %d (%s) in %s",
            switches,
            style,
            video_path.name,
        )

    used_fallback = False
    if not samples_cx:
        used_fallback = True
        cx = frame_w / 2
        cy = frame_h / 2
        if focal_x is not None:
            cx = max(0.0, min(1.0, float(focal_x))) * frame_w
        crop_x, crop_y = _clamp_crop(cx, cy, crop_w, crop_h, frame_w, frame_h)
        logger.warning("No faces/people detected in %s; using center/focal crop", video_path.name)
        return ReframePlan(
            crop_x=crop_x,
            crop_y=crop_y,
            crop_w=crop_w,
            crop_h=crop_h,
            used_center_fallback=True,
            aspect=aspect,
            keyframes=[],
            segments=[],
            detector=detector_name,
            focal_x=focal_x,
            switch_style=style,
        )

    segments: list[FramingSegment] = []
    if style == "hard_cut" and speaker_focus:
        segments, keyframes = _build_hard_cut_segments(
            samples_t,
            samples_cx,
            samples_cy,
            samples_sid,
            crop_w=crop_w,
            crop_h=crop_h,
            frame_w=frame_w,
            frame_h=frame_h,
            duration=duration,
            min_shot_seconds=min_shot_seconds,
        )
    else:
        # Ordinary subject tracking — smooth EMA, no speaker hard cuts
        sm_x = _ema_with_cuts(samples_cx, cut_flags, alpha=0.28)
        sm_y = _ema_with_cuts(samples_cy, cut_flags, alpha=0.28)
        keyframes = []
        for t, cx, cy in zip(samples_t, sm_x, sm_y):
            x, y = _clamp_crop(cx, cy, crop_w, crop_h, frame_w, frame_h)
            if keyframes and abs(keyframes[-1].crop_x - x) < 4 and abs(keyframes[-1].crop_y - y) < 4:
                continue
            keyframes.append(CropKeyframe(t=t, crop_x=x, crop_y=y))
        if keyframes and keyframes[0].t > 0.05:
            keyframes.insert(
                0, CropKeyframe(t=0.0, crop_x=keyframes[0].crop_x, crop_y=keyframes[0].crop_y)
            )
        if keyframes and duration > 0 and keyframes[-1].t < duration - 0.1:
            keyframes.append(
                CropKeyframe(t=duration, crop_x=keyframes[-1].crop_x, crop_y=keyframes[-1].crop_y)
            )

    if not keyframes:
        cx = float(np.median(samples_cx))
        cy = float(np.median(samples_cy))
        crop_x, crop_y = _clamp_crop(cx, cy, crop_w, crop_h, frame_w, frame_h)
        return ReframePlan(
            crop_x=crop_x,
            crop_y=crop_y,
            crop_w=crop_w,
            crop_h=crop_h,
            used_center_fallback=used_fallback,
            aspect=aspect,
            keyframes=[],
            segments=segments,
            detector=detector_name,
            focal_x=focal_x,
            switch_style=style,
        )

    mid = keyframes[len(keyframes) // 2]
    # For hard cuts, keep keyframes even if only two discrete positions.
    # For subject mode, drop near-static animation.
    if style != "hard_cut":
        xs = [k.crop_x for k in keyframes]
        if max(xs) - min(xs) < 12 and len(keyframes) > 1:
            keyframes = []

    return ReframePlan(
        crop_x=mid.crop_x,
        crop_y=mid.crop_y,
        crop_w=crop_w,
        crop_h=crop_h,
        used_center_fallback=used_fallback,
        aspect=aspect,
        keyframes=keyframes,
        segments=segments,
        detector=detector_name,
        focal_x=focal_x,
        switch_style=style,
    )


def _speaker_label_lookup(
    transcript_speakers: list[tuple[float, float, str]] | None,
):
    if not transcript_speakers:
        return None
    rows = [(float(a), float(b), str(s)) for a, b, s in transcript_speakers if s]

    def lookup(t: float) -> str | None:
        for start, end, label in rows:
            if start <= t < end:
                return label
        return None

    return lookup


def _apply_transcript_speaker_bias(
    tracks: list[_SpeakerTrack],
    label: str,
    frame_w: int,
) -> None:
    """When diarization says speaker A/B (or left/right), boost the matching face side."""
    live = [tr for tr in tracks if tr.missed == 0]
    if len(live) < 2:
        return
    lab = label.lower().strip()
    prefer_left = any(tok in lab for tok in ("0", "a", "left", "l", "spk_0", "speaker_0", "speaker 0"))
    prefer_right = any(
        tok in lab for tok in ("1", "b", "right", "r", "spk_1", "speaker_1", "speaker 1")
    )
    if not prefer_left and not prefer_right:
        # Stable hash of label → left/right bucket
        prefer_left = (sum(ord(c) for c in lab) % 2) == 0
        prefer_right = not prefer_left
    ordered = sorted(live, key=lambda tr: tr.cx)
    target = ordered[0] if prefer_left else ordered[-1]
    target.mouth_score = max(target.mouth_score, 1.0) * 1.8


def ffmpeg_crop_filter(plan: ReframePlan) -> str:
    """Static crop filter (used when no keyframes / sendcmd unavailable)."""
    return f"crop={plan.crop_w}:{plan.crop_h}:{plan.crop_x}:{plan.crop_y}"


def write_sendcmd(path: Path, plan: ReframePlan) -> Path | None:
    """Write FFmpeg sendcmd file to animate crop x/y over time."""
    if not plan.keyframes or len(plan.keyframes) < 2:
        return None
    lines: list[str] = []
    for kf in plan.keyframes:
        lines.append(f"{kf.t:.3f} crop@track x {kf.crop_x};")
        lines.append(f"{kf.t:.3f} crop@track y {kf.crop_y};")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _windows_fonts_dir() -> Path | None:
    import os

    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or r"C:\Windows"
    fonts = Path(windir) / "Fonts"
    return fonts if fonts.is_dir() else None


def _ass_filter_suffix(ass_path: Path | None) -> str:
    if not ass_path or not ass_path.exists():
        return ""
    ass_esc = str(ass_path.resolve()).replace("\\", "/").replace(":", r"\:")
    fonts = _windows_fonts_dir()
    if fonts is not None:
        fonts_esc = str(fonts.resolve()).replace("\\", "/").replace(":", r"\:")
        return f",ass='{ass_esc}':fontsdir='{fonts_esc}'"
    return f",ass='{ass_esc}'"


def ffmpeg_vf_chain(
    plan: ReframePlan,
    *,
    out_w: int,
    out_h: int,
    ass_path: Path | None,
    sendcmd_path: Path | None,
) -> str:
    """Single-pane crop → scale → optional ASS. Not used for split layouts."""
    # Reset timestamps so ASS times (0-based) match section downloads from yt-dlp
    parts: list[str] = ["setpts=PTS-STARTPTS"]
    if sendcmd_path and sendcmd_path.exists() and plan.keyframes:
        cmd_esc = str(sendcmd_path.resolve()).replace("\\", "/").replace(":", r"\:")
        parts.append(f"sendcmd=f='{cmd_esc}'")
        parts.append(
            f"crop@track={plan.crop_w}:{plan.crop_h}:{plan.crop_x}:{plan.crop_y}"
        )
    else:
        parts.append(ffmpeg_crop_filter(plan))
    parts.append(f"scale={out_w}:{out_h}:flags=fast_bilinear")
    suffix = _ass_filter_suffix(ass_path)
    if suffix:
        parts.append(suffix.lstrip(","))
    return ",".join(parts)


def _ffmpeg_pane_branch(
    src: str,
    pane: SplitPane,
    pw: int,
    ph: int,
    out_label: str,
    fit_mode: str,
) -> str:
    """Build one panel: independent crop, then contain+blur or cover scale (no stretch)."""
    crop = f"crop={pane.crop_w}:{pane.crop_h}:{pane.crop_x}:{pane.crop_y}"
    mode = (fit_mode or "contain").lower().strip()
    if mode == "cover":
        # Crop already matches panel aspect; scale to exact panel pixels.
        return (
            f"[{src}]{crop},"
            f"scale={pw}:{ph}:flags=fast_bilinear[{out_label}];"
        )
    # Contain: fit inside panel, fill leftover with blurred copy of the same crop.
    fg = f"fg{out_label}"
    bg = f"bg{out_label}"
    bgb = f"bgb{out_label}"
    fgf = f"fgf{out_label}"
    return (
        f"[{src}]{crop},split=2[{fg}][{bg}];"
        f"[{bg}]scale={pw}:{ph}:force_original_aspect_ratio=increase,"
        f"crop={pw}:{ph},boxblur=18:8[{bgb}];"
        f"[{fg}]scale={pw}:{ph}:force_original_aspect_ratio=decrease[{fgf}];"
        f"[{bgb}][{fgf}]overlay=(W-w)/2:(H-h)/2[{out_label}];"
    )


def ffmpeg_split_filter_complex(
    plan: ReframePlan,
    *,
    out_w: int,
    out_h: int,
    ass_path: Path | None,
) -> str:
    """Compose two independent crops onto the output canvas (stack or side-by-side).

    Panel sizes come from ``plan.aspect`` via ``out_w``/``out_h`` plus
    ``stack_direction`` / ``panel_ratio``. Each branch never reuses the other
    pane's crop coordinates. Contain mode preserves aspect (no face stretch)
    and fills gaps with a blurred background from the same source crop.
    """
    if len(plan.panes) < 2:
        raise ValueError("split layout requires two panes")

    direction = _normalize_stack_direction(plan.stack_direction)
    fit_mode = _normalize_fit_mode(plan.fit_mode, layout=plan.layout or "reaction_stack")
    (pw0, ph0), (pw1, ph1) = _panel_pixel_sizes(
        out_w, out_h, direction, plan.panel_ratio
    )

    if direction == "side_by_side":
        first = next((p for p in plan.panes if p.role == "left"), plan.panes[0])
        second = next((p for p in plan.panes if p.role == "right"), plan.panes[1])
        stack_op = "hstack"
        labels = ("left", "right")
        sizes = ((pw0, ph0), (pw1, ph1))
    else:
        first = next((p for p in plan.panes if p.role == "top"), plan.panes[0])
        second = next((p for p in plan.panes if p.role == "bottom"), plan.panes[1])
        stack_op = "vstack"
        labels = ("top", "bot")
        # For bottom_top, panes are already role-swapped; panel_ratio still
        # describes the reactor share — map sizes by which role is primary.
        if direction == "bottom_top":
            # Reactor is bottom → secondary size on top, primary on bottom.
            sizes = ((pw1, ph1), (pw0, ph0))
        else:
            sizes = ((pw0, ph0), (pw1, ph1))

    ass = _ass_filter_suffix(ass_path)
    if ass:
        stack_tail = f"{stack_op}=inputs=2{ass}[vout]"
    else:
        stack_tail = f"{stack_op}=inputs=2[vout]"

    a0, a1 = labels
    (w0, h0), (w1, h1) = sizes
    branch0 = _ffmpeg_pane_branch("s0", first, w0, h0, a0, fit_mode)
    branch1 = _ffmpeg_pane_branch("s1", second, w1, h1, a1, fit_mode)
    return (
        f"[0:v]setpts=PTS-STARTPTS,split=2[s0][s1];"
        f"{branch0}{branch1}"
        f"[{a0}][{a1}]{stack_tail}"
    )
