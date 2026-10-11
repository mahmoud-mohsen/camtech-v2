"""Face detection / embedding / quality pipeline shared by the API and the
validation script, so both measure exactly what production does.

Accuracy measures on top of plain insightface:
  * EXIF orientation is applied (phone photos are often stored sideways).
  * Small faces (typically the Emirates ID portrait) are re-detected on an
    upscaled crop so landmarks and alignment are not computed on ~80px faces.
  * Grayscale harmonisation: when one side of a comparison is black & white,
    every image in that comparison is embedded in grayscale.
"""

import io
import logging
import math
import os
import threading
from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import numpy as np
from PIL import ExifTags, Image

from . import runtime

logger = logging.getLogger("face_embedding")

MODEL_NAME = os.environ.get("INSIGHTFACE_MODEL_NAME", "buffalo_l")
MODEL_VERSION = f"insightface_{MODEL_NAME}"
# Detector input size for documents (small faces) and selfies (large faces).
# Detection at 320 is ~3x faster than 640 and plenty for a selfie face.
DET_SIZE = int(os.environ.get("INSIGHTFACE_DET_SIZE", "640"))
SELFIE_DET_SIZE = int(os.environ.get("INSIGHTFACE_SELFIE_DET_SIZE", "320"))
MIN_DET_SCORE = float(os.environ.get("INSIGHTFACE_MIN_DET_SCORE", "0.5"))

# Faces smaller than this (shorter bbox side, px) are re-detected on an
# upscaled crop. ID-card portraits are usually 60-150px in a card photo.
SMALL_FACE_PX = int(os.environ.get("FACE_SMALL_FACE_PX", "160"))
UPSCALE_TARGET_PX = int(os.environ.get("FACE_UPSCALE_TARGET_PX", "256"))

# Images whose mean HSV saturation is below this are treated as grayscale.
GRAYSCALE_SATURATION = float(os.environ.get("FACE_GRAYSCALE_SATURATION", "18"))

# Selfie quality gates (documents are only required to contain a face).
SELFIE_MIN_FACE_PX = int(os.environ.get("SELFIE_MIN_FACE_PX", "90"))
SELFIE_MIN_SHARPNESS = float(os.environ.get("SELFIE_MIN_SHARPNESS", "25"))
SELFIE_MIN_BRIGHTNESS = float(os.environ.get("SELFIE_MIN_BRIGHTNESS", "45"))
SELFIE_MAX_BRIGHTNESS = float(os.environ.get("SELFIE_MAX_BRIGHTNESS", "225"))
SELFIE_MAX_YAW = float(os.environ.get("SELFIE_MAX_YAW", "30"))
SELFIE_MAX_PITCH = float(os.environ.get("SELFIE_MAX_PITCH", "30"))

# Input limits. camtech accepts uploads of up to 10MB, so the same per-image
# byte limit here. The pixel limit is read from the image header before any
# decoding (it still lets 48-64MP phone photos through: JPEGs are decoded at
# reduced size, see decode_image).
MAX_IMAGE_BYTES = int(os.environ.get("FACE_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
MAX_PIXELS = int(os.environ.get("FACE_MAX_PIXELS", "100000000"))
# Long side images are reduced to while decoding. Selfies and liveness frames
# have large faces, so 1600px loses nothing. Documents keep more resolution:
# the ID-card portrait is only 60-150px in a card photo and goes through the
# small-face upscale path, which needs the original detail.
MAX_SIDE = int(os.environ.get("FACE_MAX_SIDE", "1600"))
MAX_SIDE_DOCUMENT = int(os.environ.get("FACE_MAX_SIDE_DOCUMENT", "4096"))
# Long side of the thumbnail the grayscale test runs on.
_GRAY_THUMB_SIDE = 256

_face_app = None
# Guards lazy model loading: concurrent first requests load the model once.
_face_app_lock = threading.Lock()


class FaceError(Exception):
    """Client-facing failure with a stable machine-readable code."""

    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass
class FaceResult:
    embedding: np.ndarray
    det_score: float
    face_count: int
    bbox: List[float]
    image_width: int
    image_height: int
    face_px: float
    sharpness: float
    brightness: float
    yaw: Optional[float]
    pitch: Optional[float]
    is_grayscale: bool
    upscaled: bool
    issues: List[str] = field(default_factory=list)
    # The detected face (original image coordinates), for callers that run
    # more models on it. Not part of the API output.
    face: object = field(default=None, repr=False, compare=False)

    @property
    def face_area_ratio(self) -> float:
        w = self.bbox[2] - self.bbox[0]
        h = self.bbox[3] - self.bbox[1]
        return float(w * h) / float(self.image_width * self.image_height)

    def to_dict(self, include_embedding: bool = True) -> dict:
        d = {
            "det_score": self.det_score,
            "face_count": self.face_count,
            "bbox": self.bbox,
            "image_width": self.image_width,
            "image_height": self.image_height,
            "face_area_ratio": self.face_area_ratio,
            "face_px": self.face_px,
            "sharpness": self.sharpness,
            "brightness": self.brightness,
            "yaw": self.yaw,
            "pitch": self.pitch,
            "is_grayscale": self.is_grayscale,
            "upscaled": self.upscaled,
            "issues": self.issues,
        }
        if include_embedding:
            d["embedding"] = self.embedding.astype(float).tolist()
        return d


def get_face_app():
    if _face_app is None:
        with _face_app_lock:
            if _face_app is None:
                _load_face_app()
    return _face_app


def _load_face_app():
    global _face_app
    from insightface.app import FaceAnalysis
    from insightface.model_zoo import model_zoo

    logger.info("Loading insightface model '%s'...", MODEL_NAME)
    # insightface 0.7.3 creates every session through
    # model_zoo.PickableInferenceSession with only providers/provider_options,
    # so the thread budget (runtime.session_options) cannot be passed in.
    # Swap in a subclass that adds sess_options for the duration of the load.
    original = model_zoo.PickableInferenceSession
    opts = runtime.session_options()

    class _Session(original):
        def __init__(self, model_path, **kwargs):
            kwargs.setdefault("sess_options", opts)
            super().__init__(model_path, **kwargs)

    model_zoo.PickableInferenceSession = _Session
    try:
        fa = FaceAnalysis(
            name=MODEL_NAME,
            providers=["CPUExecutionProvider"],
            # The detector and the ArcFace recognizer, plus the 68-point
            # landmark model, which only runs for active-liveness frames that
            # need landmarks (blink, look up/down and smile challenges). The
            # quality head pose comes from the detector's 5 keypoints.
            allowed_modules=["detection", "recognition", "landmark_3d_68"],
        )
    finally:
        model_zoo.PickableInferenceSession = original
    fa.prepare(ctx_id=0, det_size=(DET_SIZE, DET_SIZE))
    threads = {name: m.session.get_session_options().intra_op_num_threads for name, m in fa.models.items()}
    if any(t != runtime.INTRA_OP_THREADS for t in threads.values()):
        logger.warning("insightface sessions did not take the thread setting: %s", threads)
    _face_app = fa
    logger.info(
        "Model '%s' loaded (%d intra-op threads, %d concurrent inferences).",
        MODEL_NAME, runtime.INTRA_OP_THREADS, runtime.MAX_CONCURRENCY,
    )


def warm_up():
    """Loads the models and runs one inference of each so the first real
    request is fast."""
    fa = get_face_app()
    blank = np.zeros((DET_SIZE, DET_SIZE, 3), dtype=np.uint8)
    fa.det_model.detect(blank, input_size=(DET_SIZE, DET_SIZE))
    fa.det_model.detect(blank, input_size=(SELFIE_DET_SIZE, SELFIE_DET_SIZE))
    fa.models["recognition"].get_feat(np.zeros((112, 112, 3), dtype=np.uint8))


def _exif_upright(arr: np.ndarray, orientation) -> np.ndarray:
    """Applies the EXIF orientation like PIL.ImageOps.exif_transpose, but on
    the (already reduced) array."""
    if orientation == 2:
        return cv2.flip(arr, 1)
    if orientation == 3:
        return cv2.rotate(arr, cv2.ROTATE_180)
    if orientation == 4:
        return cv2.flip(arr, 0)
    if orientation == 5:
        return cv2.transpose(arr)
    if orientation == 6:
        return cv2.rotate(arr, cv2.ROTATE_90_CLOCKWISE)
    if orientation == 7:
        return cv2.flip(cv2.transpose(arr), -1)
    if orientation == 8:
        return cv2.rotate(arr, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return arr


def check_image_size(n_bytes: int):
    if n_bytes > MAX_IMAGE_BYTES:
        raise FaceError("IMAGE_TOO_LARGE", f"Image larger than {MAX_IMAGE_BYTES} bytes", status=400)


def decode_image(data: bytes, role: str = "selfie") -> np.ndarray:
    """Bytes -> BGR uint8 array with EXIF orientation applied and the long
    side reduced to MAX_SIDE (MAX_SIDE_DOCUMENT for role="document").

    Large JPEGs are decoded directly at 1/2, 1/4 or 1/8 size (DCT scaling,
    never below the cap), so a 12MP photo is not fully decoded first."""
    if not data:
        raise FaceError("EMPTY_IMAGE", "Empty image upload", status=400)
    check_image_size(len(data))
    max_side = MAX_SIDE_DOCUMENT if role == "document" else MAX_SIDE
    try:
        pil = Image.open(io.BytesIO(data))  # reads the header only
        w, h = pil.size
    except Exception:
        raise FaceError("BAD_IMAGE", "Could not decode image", status=400)
    if w * h > MAX_PIXELS:
        raise FaceError("IMAGE_TOO_LARGE", f"Image larger than {MAX_PIXELS} pixels", status=400)
    try:
        scale = max_side / max(w, h, 1)
        if scale < 1.0 and pil.format == "JPEG":
            pil.draft("RGB", (math.ceil(w * scale), math.ceil(h * scale)))
        orientation = pil.getexif().get(ExifTags.Base.Orientation, 1)
        if pil.mode not in ("RGB", "L"):
            pil = pil.convert("RGB")
        # Grayscale stays single-channel until the final conversion.
        arr = np.asarray(pil)
    except Exception:
        raise FaceError("BAD_IMAGE", "Could not decode image", status=400)
    h, w = arr.shape[:2]
    if max(h, w) > max_side:
        s = max_side / max(h, w)
        arr = cv2.resize(arr, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    arr = _exif_upright(arr, orientation)
    return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR if arr.ndim == 2 else cv2.COLOR_RGB2BGR)


def is_grayscale(img: np.ndarray) -> bool:
    """Mean HSV saturation below the threshold, measured on a small thumbnail
    (the mean barely moves, and HSV of a full-size image is wasted work)."""
    h, w = img.shape[:2]
    scale = _GRAY_THUMB_SIDE / max(h, w, 1)
    if scale < 1.0:
        img = cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return float(hsv[..., 1].mean()) < GRAYSCALE_SATURATION


def to_gray3(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)


def _largest(faces):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def _detect(img: np.ndarray, size: int):
    """Runs only the detector (no recognition on every face found)."""
    from insightface.app.common import Face

    bboxes, kpss = get_face_app().det_model.detect(img, input_size=(size, size))
    return [
        Face(bbox=bboxes[i, :4], kps=kpss[i], det_score=float(bboxes[i, 4]))
        for i in range(bboxes.shape[0])
    ]


def _embed(img: np.ndarray, face) -> np.ndarray:
    emb = get_face_app().models["recognition"].get(img, face)
    return (emb / np.linalg.norm(emb)).astype(np.float32)


def _pose_from_kps(kps: np.ndarray):
    """Approximate (yaw, pitch) in degrees from the 5 detector keypoints
    (left eye, right eye, nose, left mouth, right mouth). Good enough to
    reject clearly turned/tilted heads; not a precise head-pose estimate."""
    le, re, nose, lm, rm = kps
    eye_mid = (le + re) / 2
    mouth_mid = (lm + rm) / 2
    eye_dist = float(np.linalg.norm(re - le)) or 1.0
    yaw_ratio = float(nose[0] - eye_mid[0]) / eye_dist
    span = float(mouth_mid[1] - eye_mid[1]) or 1.0
    # A frontal nose tip sits ~55% of the way from the eyes to the mouth.
    pitch_ratio = float(nose[1] - eye_mid[1]) / span - 0.55
    yaw = float(np.degrees(np.arcsin(np.clip(yaw_ratio * 2.0, -1.0, 1.0))))
    pitch = float(np.degrees(np.arcsin(np.clip(pitch_ratio * 2.0, -1.0, 1.0))))
    return yaw, pitch


def _face_crop(img: np.ndarray, bbox, scale: float):
    h, w = img.shape[:2]
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    side = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * scale
    x0, y0 = int(max(0, cx - side / 2)), int(max(0, cy - side / 2))
    x1, y1 = int(min(w, cx + side / 2)), int(min(h, cy + side / 2))
    return img[y0:y1, x0:x1]


def _sharpness(face_crop: np.ndarray) -> float:
    gray = cv2.cvtColor(cv2.resize(face_crop, (112, 112)), cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def analyze(
    img: np.ndarray,
    role: str = "selfie",
    force_grayscale: bool = False,
    gray_source: Optional[bool] = None,
) -> FaceResult:
    """Detects the primary (largest) face and returns its embedding + quality.

    role="selfie" adds quality issues (blur, lighting, pose, size, multiple
    faces); role="document" only requires a confident face. `gray_source` is
    is_grayscale(img) when the caller has already computed it.
    """
    if gray_source is None:
        gray_source = is_grayscale(img)
    work = to_gray3(img) if force_grayscale else img

    det_size = SELFIE_DET_SIZE if role == "selfie" else DET_SIZE
    faces = _detect(work, det_size)
    if not faces and det_size != DET_SIZE:
        faces = _detect(work, DET_SIZE)
    if not faces:
        raise FaceError("NO_FACE", "No face detected in image")
    orig_face = _largest(faces)
    face_count = len(faces)
    face, face_img, upscaled = orig_face, work, False

    face_px = float(min(face.bbox[2] - face.bbox[0], face.bbox[3] - face.bbox[1]))
    if face_px < SMALL_FACE_PX:
        # Re-detect on an upscaled crop around the face: alignment landmarks
        # on a tiny face are noisy, which costs a lot of similarity.
        crop = _face_crop(work, face.bbox, scale=2.2)
        factor = UPSCALE_TARGET_PX / max(face_px, 1.0)
        if crop.size and factor > 1.0:
            big = cv2.resize(crop, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
            big_faces = _detect(big, SELFIE_DET_SIZE)
            if big_faces:
                candidate = _largest(big_faces)
                if candidate.det_score >= face.det_score * 0.8:
                    face, face_img, upscaled = candidate, big, True

    if face.det_score < MIN_DET_SCORE:
        raise FaceError(
            "LOW_DETECTION_SCORE",
            f"Face detection confidence too low ({face.det_score:.2f})",
        )

    embedding = _embed(face_img, face)
    crop = _face_crop(face_img, face.bbox, scale=1.0)
    sharpness = _sharpness(crop) if crop.size else 0.0
    brightness = float(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).mean()) if crop.size else 0.0
    yaw, pitch = _pose_from_kps(face.kps)

    # Geometry is reported in the original (EXIF-corrected) image's
    # coordinates even when the embedding came from the upscaled crop.
    bbox = [float(v) for v in orig_face.bbox]

    issues = []
    if role == "selfie":
        if face_count > 1:
            issues.append("MULTIPLE_FACES")
        if min(bbox[2] - bbox[0], bbox[3] - bbox[1]) < SELFIE_MIN_FACE_PX:
            issues.append("FACE_TOO_SMALL")
        if sharpness < SELFIE_MIN_SHARPNESS:
            issues.append("BLURRY")
        if brightness < SELFIE_MIN_BRIGHTNESS:
            issues.append("TOO_DARK")
        elif brightness > SELFIE_MAX_BRIGHTNESS:
            issues.append("TOO_BRIGHT")
        if abs(yaw) > SELFIE_MAX_YAW:
            issues.append("HEAD_TURNED")
        if abs(pitch) > SELFIE_MAX_PITCH:
            issues.append("HEAD_TILTED")

    return FaceResult(
        embedding=embedding,
        det_score=float(face.det_score),
        face_count=face_count,
        bbox=bbox,
        image_width=int(img.shape[1]),
        image_height=int(img.shape[0]),
        face_px=float(min(bbox[2] - bbox[0], bbox[3] - bbox[1])),
        sharpness=sharpness,
        brightness=brightness,
        yaw=yaw,
        pitch=pitch,
        is_grayscale=gray_source,
        upscaled=upscaled,
        issues=issues,
        face=orig_face,
    )


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def compare(reference: np.ndarray, probes: List[np.ndarray]) -> dict:
    """Compares one reference image (e.g. Emirates ID front) against one or
    more probe images (e.g. liveness selfies). Returns the best similarity.

    If any image is grayscale, all of them are embedded in grayscale so the
    colour/B&W domain gap doesn't drag similarity down.
    """
    if not probes:
        raise FaceError("NO_PROBES", "At least one probe image is required", status=400)

    # Computed once: analyze() reports it too.
    ref_gray = is_grayscale(reference)
    probes_gray = [is_grayscale(p) for p in probes]
    harmonize = ref_gray or any(probes_gray)
    ref = analyze(reference, role="document", force_grayscale=harmonize, gray_source=ref_gray)

    results = []
    for i, probe in enumerate(probes):
        try:
            r = analyze(probe, role="selfie", force_grayscale=harmonize, gray_source=probes_gray[i])
            results.append({
                "index": i,
                "similarity": cosine(ref.embedding, r.embedding),
                "quality": r.to_dict(include_embedding=False),
            })
        except FaceError as e:
            results.append({"index": i, "similarity": None, "error": {"code": e.code, "message": e.message}})

    scored = [r for r in results if r["similarity"] is not None]
    if not scored:
        first_error = results[0]["error"]
        raise FaceError(first_error["code"], f"No usable face in the selfie: {first_error['message']}")

    best = max(scored, key=lambda r: r["similarity"])
    return {
        "best_similarity": best["similarity"],
        "best_index": best["index"],
        "probes": results,
        "reference": ref.to_dict(include_embedding=False),
        "grayscale_harmonized": harmonize,
        "model_version": MODEL_VERSION,
    }


# ---------------------------------------------------------------- liveness

# Standard 68-point indices of each eye: corner, top, top, corner, bottom, bottom.
_EYE_68 = ((36, 37, 38, 39, 40, 41), (42, 43, 44, 45, 46, 47))
# Standard 68-point indices of the mouth corners.
_MOUTH_CORNERS_68 = (48, 54)
MAX_LIVENESS_FRAMES = int(os.environ.get("LIVENESS_MAX_FRAMES", "17"))


def eye_aspect_ratio(landmarks_68: np.ndarray) -> float:
    """Mean eye aspect ratio (Soukupova & Cech) of both eyes: about 0.25-0.35
    when open, below about 0.15 when closed."""
    pts = np.asarray(landmarks_68, dtype=np.float64)[:, :2]
    ratios = []
    for p1, p2, p3, p4, p5, p6 in _EYE_68:
        width = np.linalg.norm(pts[p1] - pts[p4]) or 1.0
        ratios.append((np.linalg.norm(pts[p2] - pts[p6]) + np.linalg.norm(pts[p3] - pts[p5])) / (2.0 * width))
    return float(np.mean(ratios))


def mouth_ratio(landmarks_68: np.ndarray) -> float:
    """Mouth width (corner 48 to corner 54) divided by the distance between
    the eye centres (mean of points 36-41 and of 42-47). Scale-free; it grows
    when the person smiles."""
    pts = np.asarray(landmarks_68, dtype=np.float64)[:, :2]
    left_eye = pts[list(_EYE_68[0])].mean(axis=0)
    right_eye = pts[list(_EYE_68[1])].mean(axis=0)
    eye_dist = float(np.linalg.norm(right_eye - left_eye)) or 1.0
    left, right = _MOUTH_CORNERS_68
    return float(np.linalg.norm(pts[right] - pts[left])) / eye_dist


def head_pitch(landmarks_68: np.ndarray, mean_shape_68: np.ndarray) -> float:
    """Head pitch in degrees, POSITIVE = the person looks UP (chin up).

    Same fit insightface 0.7.x does for `face.pose` after the 3D-68 landmark
    model (model_zoo/landmark.py + utils/transform.py): an affine camera P
    with landmarks = P @ [mean_shape, 1] is solved by least squares, its
    first two rows are normalised to r1, r2, r3 = r1 x r2, and pitch =
    atan2(R[2,1], R[2,2]), i.e. insightface's pose[0]. Only the image x/y of
    the landmarks enter the fit.

    Sign: the mean shape is in image axes (x right, y down) with z towards
    the camera (the nose tip has the largest z). A positive rotation about x
    gives y' = cos*y - sin*z, so the protruding nose tip moves UP in the
    image relative to the eyes, which is what a chin-up head does. pose[0]
    is therefore already "positive = looking up" and is returned unchanged.
    (The keypoint `pitch` has the opposite sense: positive = nose lower.)
    """
    pts = np.asarray(landmarks_68, dtype=np.float64)[:, :2]
    x = np.asarray(mean_shape_68, dtype=np.float64)[:, :3]
    x_homo = np.hstack((x, np.ones((x.shape[0], 1))))
    p = np.linalg.lstsq(x_homo, pts, rcond=None)[0].T  # 2 x 4
    r1 = p[0, :3] / (np.linalg.norm(p[0, :3]) or 1.0)
    r2 = p[1, :3] / (np.linalg.norm(p[1, :3]) or 1.0)
    r3 = np.cross(r1, r2)
    return float(np.degrees(np.arctan2(r3[1], r3[2])))


def _landmark_measures(img: np.ndarray, face) -> dict:
    """Eye openness, head pitch and mouth width from one run of the 3D-68
    landmark model."""
    model = get_face_app().models["landmark_3d_68"]
    landmarks = model.get(img, face)
    return {
        "ear": eye_aspect_ratio(landmarks),
        "head_pitch": head_pitch(landmarks, model.mean_lmk),
        "mouth_ratio": mouth_ratio(landmarks),
    }


def _measure(img: np.ndarray, reference_embedding: Optional[np.ndarray], landmarks: bool) -> dict:
    """Head pose, landmark measures, identity and passive liveness of the main face."""
    from . import anti_spoof

    faces = _detect(img, SELFIE_DET_SIZE) or _detect(img, DET_SIZE)
    if not faces:
        raise FaceError("NO_FACE", "No face detected in image")
    face = _largest(faces)
    yaw, pitch = _pose_from_kps(face.kps)
    out = {
        "face_count": len(faces),
        "det_score": float(face.det_score),
        "bbox": [float(v) for v in face.bbox],
        "face_area_ratio": float((face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]))
        / float(img.shape[0] * img.shape[1]),
        # Positive yaw = nose towards the right of the (unmirrored) image,
        # i.e. the person turned to their own left.
        "yaw": yaw,
        "pitch": pitch,
        "ear": None,
        "head_pitch": None,
        "mouth_ratio": None,
        "similarity": None,
        "antispoof": anti_spoof.score(img, face.bbox),
    }
    if landmarks:
        out.update(_landmark_measures(img, face))
    if reference_embedding is not None:
        out["similarity"] = cosine(reference_embedding, _embed(img, face))
    return out


def measure_liveness(reference: np.ndarray, frames: List[np.ndarray], landmarks: bool) -> dict:
    """Measurements for liveness decisions (camtech decides, this only measures).

    `reference` is the first selfie; every frame (the closer selfie and the
    active-challenge frames) is compared with it. Passive anti-spoof scores
    are included when the models are installed. With `landmarks`, the
    reference and every frame also get `ear`, `head_pitch` and `mouth_ratio`."""
    from . import anti_spoof

    if len(frames) > MAX_LIVENESS_FRAMES:
        raise FaceError("TOO_MANY_FRAMES", f"At most {MAX_LIVENESS_FRAMES} frames", status=400)
    ref = analyze(reference, role="selfie")
    # The face analyze() found (same detector sizes, same order, not upscaled).
    ref_face = ref.face
    results = []
    for i, frame in enumerate(frames):
        try:
            results.append({"index": i, **_measure(frame, ref.embedding, landmarks)})
        except FaceError as e:
            results.append({"index": i, "error": {"code": e.code, "message": e.message}})
    reference_out = {
        "face_count": ref.face_count,
        "yaw": ref.yaw,
        "pitch": ref.pitch,
        "antispoof": anti_spoof.score(reference, ref_face.bbox),
    }
    if landmarks:
        reference_out.update(_landmark_measures(reference, ref_face))
    return {
        "model_version": MODEL_VERSION,
        "antispoof": anti_spoof.status(),
        "reference": reference_out,
        "frames": results,
    }
