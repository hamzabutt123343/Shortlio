from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

try:
    import mediapipe as mp

    _MEDIAPIPE = True
except ImportError:
    mp = None  # type: ignore
    _MEDIAPIPE = False


ASPECT_MAP = {
    "9:16": 9 / 16,
    "1:1": 1.0,
    "16:9": 16 / 9,
}


@dataclass
class ReframePlan:
    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int
    used_center_fallback: bool
    aspect: str

    def to_dict(self) -> dict:
        return {
            "crop_x": self.crop_x,
            "crop_y": self.crop_y,
            "crop_w": self.crop_w,
            "crop_h": self.crop_h,
            "used_center_fallback": self.used_center_fallback,
            "aspect": self.aspect,
        }


def _smooth(values: list[float], alpha: float = 0.25) -> list[float]:
    if not values:
        return values
    out = [values[0]]
    for v in values[1:]:
        out.append(alpha * v + (1 - alpha) * out[-1])
    return out


def _detect_face_center(frame: np.ndarray) -> tuple[float, float] | None:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(48, 48))
    if len(faces) == 0 and _MEDIAPIPE and mp is not None:
        try:
            with mp.solutions.face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5) as fd:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                res = fd.process(rgb)
                if res.detections:
                    det = res.detections[0].location_data.relative_bounding_box
                    h, w = frame.shape[:2]
                    cx = (det.xmin + det.width / 2) * w
                    cy = (det.ymin + det.height / 2) * h
                    return cx, cy
        except Exception as exc:
            logger.debug("MediaPipe face detection failed: %s", exc)
        return None
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return x + w / 2, y + h / 2


def compute_reframe_plan(
    video_path: Path,
    aspect: str = "9:16",
    sample_fps: float = 2.0,
    max_samples: int = 120,
) -> ReframePlan:
    if aspect not in ASPECT_MAP:
        aspect = "9:16"
    target_ratio = ASPECT_MAP[aspect]

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(fps / sample_fps))

    centers_x: list[float] = []
    centers_y: list[float] = []
    idx = 0
    samples = 0
    while samples < max_samples:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        center = _detect_face_center(frame)
        if center:
            centers_x.append(center[0])
            centers_y.append(center[1])
        idx += step
        samples += 1
        if total_frames and idx >= total_frames:
            break
    cap.release()

    used_fallback = False
    if centers_x:
        cx = _smooth(centers_x)[-1]
        cy = _smooth(centers_y)[-1]
    else:
        used_fallback = True
        cx = frame_w / 2
        cy = frame_h / 2
        logger.warning("No faces detected in %s; using center crop", video_path.name)

    # Crop dimensions for target aspect inside source frame
    src_ratio = frame_w / frame_h
    if src_ratio > target_ratio:
        crop_h = frame_h
        crop_w = int(crop_h * target_ratio)
    else:
        crop_w = frame_w
        crop_h = int(crop_w / target_ratio)

    crop_w = min(crop_w, frame_w)
    crop_h = min(crop_h, frame_h)
    crop_x = int(max(0, min(frame_w - crop_w, cx - crop_w / 2)))
    crop_y = int(max(0, min(frame_h - crop_h, cy - crop_h / 2)))

    return ReframePlan(
        crop_x=crop_x,
        crop_y=crop_y,
        crop_w=crop_w,
        crop_h=crop_h,
        used_center_fallback=used_fallback,
        aspect=aspect,
    )
