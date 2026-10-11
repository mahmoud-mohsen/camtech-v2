FROM python:3.11-slim

WORKDIR /app

# build-essential: insightface ships as source and compiles a C extension.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Non-root user (uid 1001, matched by the k8s securityContext).
RUN groupadd -r -g 1001 appgroup && useradd -r -m -u 1001 -g appgroup appuser
USER appuser

ENV INSIGHTFACE_MODEL_NAME=buffalo_l
# Bake the buffalo_l model pack (~326MB) into the image at build time, so pods
# don't need internet access to download it on first start.
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition', 'landmark_3d_68'], providers=['CPUExecutionProvider'])"

# Passive liveness models (Silent-Face MiniFASNet, ONNX, Apache-2.0), committed in models/anti_spoof.
# The pinned SHA-256 values make the service refuse a tampered or wrong file.
COPY --chown=appuser:appgroup models ./models
ENV ANTISPOOF_MODEL_DIR=/app/models/anti_spoof \
    ANTISPOOF_SHA256_MINIFASNETV2=b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907 \
    ANTISPOOF_SHA256_MINIFASNETV1SE=ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676

# CPU budget (app/runtime.py). Empty = derived from the container CPU limit:
# FACE_INTRA_OP_THREADS = min(CPUs, 4) threads per ONNX session,
# FACE_MAX_CONCURRENCY = CPUs / threads inferences at once. Keep
# concurrency x threads <= CPU limit. Libraries using OpenMP/BLAS get 1 thread
# so they don't add their own pools on top.
ENV FACE_INTRA_OP_THREADS="" \
    FACE_MAX_CONCURRENCY="" \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1
# Request limits and queueing (app/face_engine.py, app/main.py).
ENV FACE_MAX_IMAGE_BYTES=10485760 \
    FACE_MAX_PIXELS=100000000 \
    FACE_MAX_SIDE=1600 \
    FACE_MAX_SIDE_DOCUMENT=4096 \
    FACE_MAX_PROBES=8 \
    FACE_MAX_REQUEST_BYTES=104857600 \
    FACE_MAX_QUEUE=16 \
    FACE_QUEUE_TIMEOUT_SECONDS=15

COPY --chown=appuser:appgroup app ./app

ENV PORT=8001 \
    UVICORN_TIMEOUT_KEEP_ALIVE=75
EXPOSE 8001

# /livez answers without touching the models (process up, event loop free).
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/livez' % os.environ.get('PORT', '8001'), timeout=4)"

# One worker per container: scale with replicas (or raise FACE_MAX_CONCURRENCY
# within one worker, which shares the loaded models). More workers each load
# the ~300MB of models and need the CPU budget divided between them.
# Keep-alive longer than the client's idle pool timeout avoids races where
# the server closes a connection the client is about to reuse.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive ${UVICORN_TIMEOUT_KEEP_ALIVE}"]
