"""Passive liveness: presentation-attack detection on a single face image.

Uses the Silent-Face-Anti-Spoofing ensemble (MiniFASNetV2 on a 2.7x face crop
and MiniFASNetV1SE on a 4.0x crop, 80x80 input, 3 classes: 1 = real face,
0 and 2 = attacks such as printed photos and screens) exported to ONNX. Each
model sees the face with a different amount of context, so print borders,
screen bezels and moire are caught at one scale or the other.

The models are optional at runtime: when the files are missing the service
still starts, `available` is False and callers decide what that means (camtech
records the check as SKIPPED unless liveness.passive_required is on).
"""

import hashlib
import logging
import os
import threading
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np

from . import runtime

logger = logging.getLogger("face_embedding")

MODEL_DIR = os.environ.get(
    "ANTISPOOF_MODEL_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "anti_spoof"),
)
# (file name, face-crop scale, env var with the expected SHA-256)
MODEL_SPECS = [
    ("MiniFASNetV2.onnx", 2.7, "ANTISPOOF_SHA256_MINIFASNETV2"),
    ("MiniFASNetV1SE.onnx", 4.0, "ANTISPOOF_SHA256_MINIFASNETV1SE"),
]
INPUT_SIZE = 80
REAL_CLASS = 1
# Multiplier applied to the 0-255 BGR pixels before inference. 1.0 is verified
# for the pinned files (at 1/255 both models give the same output for any image). The original
# Silent-Face models take raw 0-255 values (1.0); some ONNX exports expect
# 0-1 (1/255). Set to match the export in use.
INPUT_SCALE = float(os.environ.get("ANTISPOOF_INPUT_SCALE", "1.0"))
MODEL_VERSION = "silent_face_minifasnet_v2_v1se"


@dataclass
class _Model:
    name: str
    scale: float
    session: object
    input_name: str


_models: Optional[List[_Model]] = None
_load_error: Optional[str] = None
# Lazy loading can be triggered by concurrent requests (inference runs in a
# threadpool): only one thread loads, the others wait and reuse the result.
_load_lock = threading.Lock()


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load() -> bool:
    """Loads both models once. Returns True when passive liveness is available."""
    if _models is not None:
        return True
    if _load_error is not None:
        return False
    with _load_lock:
        return _load_locked()


def _load_locked() -> bool:
    global _models, _load_error
    if _models is not None:
        return True
    if _load_error is not None:
        return False
    import onnxruntime as ort

    loaded = []
    for file_name, scale, sha_env in MODEL_SPECS:
        path = os.path.join(MODEL_DIR, file_name)
        if not os.path.isfile(path):
            _load_error = f"{file_name} not found in {MODEL_DIR}"
            logger.warning("Passive liveness disabled: %s", _load_error)
            return False
        expected = os.environ.get(sha_env, "").strip().lower()
        if expected and _sha256(path) != expected:
            _load_error = f"{file_name} does not match {sha_env}"
            logger.error("Passive liveness disabled: %s", _load_error)
            return False
        session = ort.InferenceSession(
            path, sess_options=runtime.session_options(), providers=["CPUExecutionProvider"]
        )
        loaded.append(_Model(file_name, scale, session, session.get_inputs()[0].name))
    _models = loaded
    logger.info("Passive liveness models loaded from %s", MODEL_DIR)
    return True


def available() -> bool:
    return load()


def status(load: bool = True) -> dict:
    """`load=False` reports the current state without loading the models
    (used by /health so a probe never pays the model-load cost)."""
    ok = available() if load else _models is not None
    return {"available": ok, "model_version": MODEL_VERSION if _models else None, "error": _load_error}


def crop_box(src_w: int, src_h: int, bbox_xyxy, scale: float) -> Tuple[int, int, int, int]:
    """Silent-Face crop: the face box enlarged `scale` times around its centre,
    shrunk if it does not fit, then shifted inside the image. Returns
    (x0, y0, x1, y1) inclusive pixel coordinates."""
    x, y = float(bbox_xyxy[0]), float(bbox_xyxy[1])
    box_w = max(1.0, float(bbox_xyxy[2]) - x)
    box_h = max(1.0, float(bbox_xyxy[3]) - y)
    scale = min((src_h - 1) / box_h, min((src_w - 1) / box_w, scale))
    new_w, new_h = box_w * scale, box_h * scale
    cx, cy = x + box_w / 2, y + box_h / 2
    x0, y0 = cx - new_w / 2, cy - new_h / 2
    x1, y1 = cx + new_w / 2, cy + new_h / 2
    if x0 < 0:
        x1 -= x0
        x0 = 0
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if x1 > src_w - 1:
        x0 -= x1 - src_w + 1
        x1 = src_w - 1
    if y1 > src_h - 1:
        y0 -= y1 - src_h + 1
        y1 = src_h - 1
    return int(max(0, x0)), int(max(0, y0)), int(x1), int(y1)


def softmax_if_needed(logits: np.ndarray) -> np.ndarray:
    """Some exports end with softmax, others with raw logits."""
    v = np.asarray(logits, dtype=np.float64).reshape(-1)
    if np.all(v >= 0) and abs(float(v.sum()) - 1.0) < 1e-3:
        return v
    e = np.exp(v - v.max())
    return e / e.sum()


def _input(img_bgr: np.ndarray, bbox_xyxy, scale: float) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    x0, y0, x1, y1 = crop_box(w, h, bbox_xyxy, scale)
    crop = img_bgr[y0:y1 + 1, x0:x1 + 1]
    crop = cv2.resize(crop, (INPUT_SIZE, INPUT_SIZE))
    tensor = crop.astype(np.float32).transpose(2, 0, 1)[np.newaxis, ...]
    return tensor * INPUT_SCALE


def score(img_bgr: np.ndarray, bbox_xyxy) -> Optional[dict]:
    """Probability (0-1) that the face is real, averaged over both models, plus
    each model's value. None when passive liveness is not available."""
    if not available():
        return None
    per_model = {}
    total = 0.0
    for m in _models:
        out = m.session.run(None, {m.input_name: _input(img_bgr, bbox_xyxy, m.scale)})[0]
        real = float(softmax_if_needed(out)[REAL_CLASS])
        per_model[m.name] = round(real, 4)
        total += real
    return {"score": round(total / len(_models), 4), "models": per_model}
