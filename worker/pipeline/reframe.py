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
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ReframePlan:
        kfs = [
            CropKeyframe(t=float(k["t"]), crop_x=int(k["crop_x"]), crop_y=int(k["crop_y"]))
            for k in (data.get("keyframes") or [])
        ]
        segs = [FramingSegment.from_dict(s) for s in (data.get("segments") or [])]
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
) -> Path:
    try:
        st = video_path.stat()
        identity = (
            f"{video_path.resolve()}|{st.st_size}|{st.st_mtime_ns}|{aspect}|"
            f"{focal_x}|{manual}|speaker_focus={speaker_focus}|{switch_style}|hardcut_v2"
        )
    except OSError:
        identity = (
            f"{video_path}|{aspect}|{focal_x}|{manual}|"
            f"speaker_focus={speaker_focus}|{switch_style}|hardcut_v2"
        )
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:20]
    return cache_root / f"track_{digest}.json"


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


def ffmpeg_vf_chain(
    plan: ReframePlan,
    *,
    out_w: int,
    out_h: int,
    ass_path: Path | None,
    sendcmd_path: Path | None,
) -> str:
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
    if ass_path and ass_path.exists():
        ass_esc = str(ass_path.resolve()).replace("\\", "/").replace(":", r"\:")
        fonts = _windows_fonts_dir()
        if fonts is not None:
            fonts_esc = str(fonts.resolve()).replace("\\", "/").replace(":", r"\:")
            parts.append(f"ass='{ass_esc}':fontsdir='{fonts_esc}'")
        else:
            parts.append(f"ass='{ass_esc}'")
    return ",".join(parts)
