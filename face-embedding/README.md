# face-embedding

Face detection, embedding and comparison REST API, built with FastAPI and
[insightface](https://github.com/deepinsight/insightface) `buffalo_l`
(RetinaFace detection + ArcFace recognition).

It finds the main face in an image, returns a 512-d embedding with a quality
report, and compares a reference photo (for example an Emirates ID portrait)
against one or more selfies. It is stateless (no database) and can be used by
any service over HTTP. [camtech-service](https://git.noqodi.com/noqodi-projects/cloud/camtech-service)
calls it for every registration, verification and Face Tech match; clients
never send embeddings.

On top of plain insightface (see `app/face_engine.py`):

- **EXIF orientation** is applied, since phone photos are often stored sideways.
- **Small faces are upscaled.** The Emirates ID portrait is typically 60–150 px, so it is re-detected on an enlarged crop before alignment.
- **Grayscale harmonisation:** when either side of a comparison is black and white, both are embedded in grayscale.
- **Selfie quality report:** blur, brightness, head pose, face size and multiple faces.
- **Speed:** only the detector and recognizer are loaded, recognition runs on the chosen face only, and selfies are detected at 320 px. The model is loaded and warmed up at startup.

## Project layout

| Path | Contents |
|---|---|
| `app/main.py` | FastAPI app and endpoints |
| `app/face_engine.py` | detection, embedding, quality and comparison pipeline |
| `scripts/validate_against_uploads.py` | accuracy measurement on real captures |

## Run locally (Windows)

Requires Python 3.11.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

Use the venv's Python. Running it on the global Python fails with
`No module named 'insightface'`. On Windows, `insightface` compiles a C
extension, so it needs **Microsoft C++ Build Tools** ("Desktop development
with C++").

The first start downloads the `buffalo_l` model pack (~326 MB) to
`~/.insightface/models/`.

Interactive API docs are served at `http://localhost:8001/docs`.

## API

Errors return `{"detail": "...", "code": "..."}`, for example `NO_FACE`,
`LOW_DETECTION_SCORE` or `BAD_IMAGE`.

- `GET /health` returns `status`, `model_version` and `model_loaded`
  (never loads models). `GET /livez` returns `{"status": "ok"}` without
  touching the models (liveness probe / Docker HEALTHCHECK).
- `POST /embed` takes the multipart fields `image`, `role` (`selfie` or
  `document`) and `grayscale` (bool). It returns `embedding` (512 floats),
  `det_score`, `face_count`, `bbox`, `face_area_ratio`, `sharpness`,
  `brightness`, `yaw`, `pitch`, `is_grayscale`, `upscaled` and `issues`.
  `issues` is filled for selfies and can contain `MULTIPLE_FACES`,
  `FACE_TOO_SMALL`, `BLURRY`, `TOO_DARK`, `TOO_BRIGHT`, `HEAD_TURNED` and
  `HEAD_TILTED`.
- `POST /compare` takes `reference` (for example the Emirates ID front) and one
  or more `probes` (the selfies). It returns `best_similarity` (cosine),
  `best_index`, the per-probe results and `grayscale_harmonized`.

Example:

```bash
curl -F "reference=@id_front.jpg" -F "probes=@selfie1.jpg" -F "probes=@selfie2.jpg" http://localhost:8001/compare
```

The API has no authentication. Keep it on a private network, reachable only by
the services that call it.

## Measure accuracy

```powershell
.\.venv\Scripts\python.exe scripts/validate_against_uploads.py
.\.venv\Scripts\python.exe scripts/validate_against_uploads.py --same-person-groups groups.json
```

The script runs the production pipeline over camtech-service's `uploads/`
folder (selfie vs Emirates ID front). It expects that folder at
`../backend_spring/uploads` relative to this repo, so check out both repos side
by side with camtech-service in a folder named `backend_spring`, or adjust
`UPLOADS_DIR` in the script.

It prints the same-person and different-person similarity distributions and a
threshold sweep. The optional `--same-person-groups` file is a local JSON list
of user-id groups that are the same person (for example
`[["user_2", "user_36"]]`), so duplicate test identities don't pollute the
different-person numbers. Set
camtech-service's `facetech.face-tech.*` similarity bands from this output.

## Config (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `INSIGHTFACE_MODEL_NAME` | `buffalo_l` | model pack |
| `INSIGHTFACE_DET_SIZE` | `640` | detector size for documents |
| `INSIGHTFACE_SELFIE_DET_SIZE` | `320` | detector size for selfies |
| `INSIGHTFACE_MIN_DET_SCORE` | `0.5` | reject weaker detections |
| `FACE_SMALL_FACE_PX` / `FACE_UPSCALE_TARGET_PX` | `160` / `256` | upscale faces smaller than this, to this size |
| `FACE_GRAYSCALE_SATURATION` | `18` | mean HSV saturation below which an image counts as B&W |
| `SELFIE_MIN_FACE_PX`, `SELFIE_MIN_SHARPNESS`, `SELFIE_MIN_BRIGHTNESS`, `SELFIE_MAX_BRIGHTNESS`, `SELFIE_MAX_YAW`, `SELFIE_MAX_PITCH` | `90`, `25`, `45`, `225`, `30`, `30` | selfie quality gates |
| `FACE_LAZY_LOAD` | `false` | `true` skips loading the model at startup |
| `FACE_INTRA_OP_THREADS` | min(CPUs, 4) | threads per ONNX session (and OpenCV); CPUs = container CPU limit |
| `FACE_MAX_CONCURRENCY` | CPUs / threads | inferences at once; keep concurrency x threads <= CPUs |
| `FACE_MAX_QUEUE` / `FACE_QUEUE_TIMEOUT_SECONDS` | `16` / `15` | requests waiting for a slot, and how long; then 503 `SERVICE_BUSY` with `Retry-After` |
| `FACE_RETRY_AFTER_SECONDS` | `2` | `Retry-After` of the 503 |
| `FACE_MAX_IMAGE_BYTES` | `10485760` | per image, 400 `IMAGE_TOO_LARGE` above (camtech allows 10MB) |
| `FACE_MAX_PIXELS` | `100000000` | per image, from the header before decoding, 400 `IMAGE_TOO_LARGE` above |
| `FACE_MAX_SIDE` / `FACE_MAX_SIDE_DOCUMENT` | `1600` / `4096` | long side images are reduced to while decoding (documents: `/embed` role `document` and the `/compare` reference) |
| `FACE_MAX_PROBES` | `8` | `/compare` probes, 400 `TOO_MANY_PROBES` above |
| `FACE_MAX_REQUEST_BYTES` | `104857600` | whole request (Content-Length), 413 `REQUEST_TOO_LARGE` above |
| `PORT` | `8001` | Docker only |
| `UVICORN_TIMEOUT_KEEP_ALIVE` | `75` | Docker only, idle keep-alive seconds |

## Docker

```bash
docker build -t face-embedding .
docker run -p 8001:8001 face-embedding
```

The `buffalo_l` model pack is downloaded during `docker build` and baked into
the image, so containers don't need internet access at startup. The container
runs as a non-root user (uid 1001).

## CI/CD

`.gitlab-ci.yml` uses the shared `devops-projects/noqodi-pipeline`
(`gitlab_pipeline_metrics.yml`) and the appsec scans, like the other Noqodi
services. That template is Maven-based, so this repo overrides its `build` job
(a Python compile check) and `unit_test` job; everything else is the shared
pipeline:

1. A commit on `develop` whose message carries a Jira key
   (`feat: TNOQPS-123 ...`) creates a `develop-<N>` tag.
2. The tag pipeline builds this Dockerfile and pushes
   `dxb.ocir.io/axkxkuqa5j3s/face-embedding:<tag>`, with the security scans.
3. The deploy job sets that tag in
   [cloud-kustoms](https://git.noqodi.com/noqodi-projects/cloud-kustoms)
   `face-embedding/k8s/overlay/dev/kustomization.yaml`; ArgoCD rolls it out to
   `noqodi-dev-cloud-service` as the internal service
   `http://face-embedding:8001` (no ingress).

The Kubernetes manifests and config live in cloud-kustoms, not in this
repository.

## Licensing note

The code depends on the `insightface` library (MIT). The pretrained
`buffalo_l` model pack is published by InsightFace for non-commercial research
use; confirm licensing before commercial production use.

## Liveness

`POST /liveness` measures, and camtech decides:
- **Input:** multipart `reference` (the first selfie), `frames` (the closer selfie when an older app sends one, then the active-challenge frames, at most `LIVENESS_MAX_FRAMES`, default 17), and `landmarks` (bool, run the 3D 68-point landmark model for blink, look up/down and smile challenges; `face_area_ratio` is always returned and is used for the move-closer challenge; the old name `eyes` is still accepted).
- **Output:** for the reference and for each frame:
  - `antispoof.score`: passive liveness, the probability (0-1) that the face is real
  - `yaw` and `pitch` in degrees from the 5 detector keypoints; a positive yaw means the person turned to their own left (nose towards the right of the unmirrored image)
  - with `landmarks` (otherwise `null` on frames and absent on the reference):
    - `ear`: eye aspect ratio; about 0.3 when open, below 0.15 when closed
    - `head_pitch`: degrees from the 3D-68 landmark pose; positive means the person looks up (chin up)
    - `mouth_ratio`: mouth-corner distance (points 48-54) divided by the distance between the eye centres; it grows with a smile
  - `similarity` to the reference (frames only), and `face_count`
- **Errors:** a frame without a face gets `error` instead of failing the request.

**Passive anti-spoofing** uses the Silent-Face-Anti-Spoofing ensemble (MiniFASNetV2 on a 2.7× face crop and MiniFASNetV1SE on a 4.0× crop, ONNX, Apache-2.0):
- The two files go in `models/anti_spoof/` (`MiniFASNetV2.onnx`, `MiniFASNetV1SE.onnx`) and are baked into the image.
- `ANTISPOOF_SHA256_MINIFASNETV2` and `ANTISPOOF_SHA256_MINIFASNETV1SE` pin their checksums: a file that doesn't match is refused.
- `ANTISPOOF_INPUT_SCALE` is 1.0 (raw 0-255 BGR pixels, like the original Silent-Face models). This was checked on the pinned files: scaled to 0-1, both models return the same output for every image.
- Without the files the service still starts. `GET /health` then reports `antispoof.available: false`, and camtech skips the passive check unless `liveness.passive_required` is on.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
runs the model-free tests (crop, softmax, eye aspect ratio). Validate the thresholds on real captures with `scripts/validate_against_uploads.py` before production.
