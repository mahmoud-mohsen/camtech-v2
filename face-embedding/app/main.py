import asyncio
import collections
import logging
import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import anti_spoof, face_engine, runtime
from .face_engine import FaceError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face_embedding")

# Load + warm the model at startup so the first request doesn't pay the
# model-load cost (and doesn't exceed the backend's read timeout).
LAZY_LOAD = os.environ.get("FACE_LAZY_LOAD", "false").lower() == "true"

# Requests beyond runtime.MAX_CONCURRENCY wait for a slot; at most
# FACE_MAX_QUEUE of them and for at most FACE_QUEUE_TIMEOUT_SECONDS (camtech
# reads with a 30s timeout), after that 503 SERVICE_BUSY with Retry-After.
MAX_QUEUE = int(os.environ.get("FACE_MAX_QUEUE", "16"))
QUEUE_TIMEOUT_SECONDS = float(os.environ.get("FACE_QUEUE_TIMEOUT_SECONDS", "15"))
RETRY_AFTER_SECONDS = int(os.environ.get("FACE_RETRY_AFTER_SECONDS", "2"))
# Most /compare probes accepted (camtech sends 1 or 2).
MAX_PROBES = int(os.environ.get("FACE_MAX_PROBES", "8"))
# Whole request body, checked from Content-Length before the multipart body
# is parsed (and spooled to disk). Default: room for a full liveness request
# of large photos.
MAX_REQUEST_BYTES = int(os.environ.get("FACE_MAX_REQUEST_BYTES", str(100 * 1024 * 1024)))


class ServiceBusy(Exception):
    pass


class _InferenceLimiter:
    """At most `limit` inferences at once, FIFO waiters with a bounded queue
    and wait. Lives on the event loop only (no thread safety needed)."""

    def __init__(self, limit: int, max_waiting: int, timeout: float):
        self.limit = limit
        self.max_waiting = max_waiting
        self.timeout = timeout
        self._active = 0
        self._waiters = collections.deque()

    async def acquire(self):
        if self._active < self.limit and not self._waiters:
            self._active += 1
            return
        if len(self._waiters) >= self.max_waiting:
            raise ServiceBusy()
        fut = asyncio.get_running_loop().create_future()
        self._waiters.append(fut)
        try:
            # release() hands its slot over by resolving the future.
            await asyncio.wait_for(fut, self.timeout)
        except BaseException as e:
            if fut.done() and not fut.cancelled():
                self.release()  # slot handed over just as we gave up: pass it on
            else:
                fut.cancel()
                try:
                    self._waiters.remove(fut)
                except ValueError:
                    pass
            if isinstance(e, asyncio.TimeoutError):
                raise ServiceBusy()
            raise

    def release(self):
        while self._waiters:
            fut = self._waiters.popleft()
            if not fut.done():
                fut.set_result(None)
                return
        self._active -= 1


_limiter = _InferenceLimiter(runtime.MAX_CONCURRENCY, MAX_QUEUE, QUEUE_TIMEOUT_SECONDS)


async def _run_inference(fn, *args):
    """Runs CPU-bound work (decode + models) in the threadpool, within the
    concurrency limit, so the event loop (and /health) stays responsive."""
    await _limiter.acquire()
    try:
        return await run_in_threadpool(fn, *args)
    finally:
        _limiter.release()


async def _read(upload: UploadFile) -> bytes:
    """Upload bytes, refusing files over the limit before reading them."""
    if upload.size is not None:
        face_engine.check_image_size(upload.size)
    data = await upload.read()
    face_engine.check_image_size(len(data))
    return data


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        "CPUs %d: %d concurrent inferences x %d intra-op threads, queue %d / %.0fs",
        runtime.CPUS, runtime.MAX_CONCURRENCY, runtime.INTRA_OP_THREADS, MAX_QUEUE, QUEUE_TIMEOUT_SECONDS,
    )
    if not LAZY_LOAD:
        face_engine.warm_up()
        anti_spoof.load()
    yield


app = FastAPI(title="Face Match Service", version="2.0.0", lifespan=lifespan)


class _RequestSizeLimit:
    """Plain ASGI middleware: 413 when Content-Length is over the limit,
    before anything reads the body."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            for name, value in scope["headers"]:
                if name == b"content-length" and value.isdigit() and int(value) > MAX_REQUEST_BYTES:
                    response = JSONResponse(
                        status_code=413,
                        content={"detail": f"Request larger than {MAX_REQUEST_BYTES} bytes", "code": "REQUEST_TOO_LARGE"},
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


app.add_middleware(_RequestSizeLimit)


@app.exception_handler(FaceError)
async def face_error_handler(_request: Request, exc: FaceError):
    return JSONResponse(
        status_code=exc.status,
        content={"detail": exc.message, "code": exc.code},
    )


@app.exception_handler(ServiceBusy)
async def busy_handler(_request: Request, _exc: ServiceBusy):
    return JSONResponse(
        status_code=503,
        content={"detail": "Face service is busy, retry later", "code": "SERVICE_BUSY"},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )


@app.get("/health")
async def health():
    # Never loads models or waits for an inference slot.
    return {
        "status": "ok",
        "model_version": face_engine.MODEL_VERSION,
        "model_loaded": face_engine._face_app is not None,
        "antispoof": anti_spoof.status(load=False),
    }


@app.get("/livez")
async def livez():
    """Process liveness only (the event loop answers); no model state."""
    return {"status": "ok"}


def _embed(data: bytes, role: str, grayscale: bool) -> dict:
    img = face_engine.decode_image(data, role=role)
    result = face_engine.analyze(img, role=role, force_grayscale=grayscale)
    body = result.to_dict()
    body["model_version"] = face_engine.MODEL_VERSION
    return body


def _compare(ref_data: bytes, probe_data: List[bytes]) -> dict:
    ref_img = face_engine.decode_image(ref_data, role="document")
    probe_imgs = [face_engine.decode_image(d) for d in probe_data]
    return face_engine.compare(ref_img, probe_imgs)


def _liveness(ref_data: bytes, frame_data: List[bytes], landmarks: bool) -> dict:
    ref_img = face_engine.decode_image(ref_data)
    frame_imgs = [face_engine.decode_image(d) for d in frame_data]
    return face_engine.measure_liveness(ref_img, frame_imgs, landmarks)


@app.post("/embed")
async def embed(
    image: UploadFile = File(...),
    role: str = Form("selfie"),
    grayscale: bool = Form(False),
):
    """Embedding + quality for the largest face. `role` is "selfie" (quality
    issues reported) or "document"."""
    data = await _read(image)
    return await _run_inference(_embed, data, role, grayscale)


@app.post("/compare")
async def compare(
    reference: UploadFile = File(...),
    probes: List[UploadFile] = File(...),
):
    """Best similarity of one reference (e.g. Emirates ID front) against one
    or more probes (e.g. the liveness selfies)."""
    if len(probes) > MAX_PROBES:
        raise FaceError("TOO_MANY_PROBES", f"At most {MAX_PROBES} probes", status=400)
    ref_data = await _read(reference)
    probe_data = [await _read(p) for p in probes]
    return await _run_inference(_compare, ref_data, probe_data)


@app.post("/liveness")
async def liveness(
    reference: UploadFile = File(...),
    frames: List[UploadFile] = File(default=[]),
    landmarks: bool = Form(False),
    eyes: bool = Form(False),
):
    """Liveness measurements: for the reference selfie and each frame (the
    closer selfie, then active-challenge frames), the passive anti-spoof
    score, head pose, similarity to the reference and, when `landmarks` is
    true, eye openness, landmark head pitch and mouth width. `eyes` is the
    old name of `landmarks` (still accepted). The caller makes the decision."""
    if len(frames) > face_engine.MAX_LIVENESS_FRAMES:
        raise FaceError("TOO_MANY_FRAMES", f"At most {face_engine.MAX_LIVENESS_FRAMES} frames", status=400)
    ref_data = await _read(reference)
    frame_data = [await _read(f) for f in frames]
    return await _run_inference(_liveness, ref_data, frame_data, landmarks or eyes)
