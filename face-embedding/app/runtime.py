"""CPU budget and request limits shared by the API and the model wrappers.

The service runs one uvicorn worker per container. Inside it, at most
FACE_MAX_CONCURRENCY inferences run at once and each ONNX session gets
FACE_INTRA_OP_THREADS threads, so concurrency x threads should not exceed the
container's CPUs (onnxruntime otherwise starts one thread per host core in
every session and the threads fight each other).

No onnxruntime import at module level: the model-free unit tests import this.
"""

import math
import os

import cv2


def _env_int(name: str, default: int) -> int:
    """Integer env var; unset or empty means `default`."""
    value = os.environ.get(name, "").strip()
    return int(value) if value else default


def _cgroup_cpu_limit():
    """CPU limit of the container (cgroup v2, then v1), None when unlimited.
    os.cpu_count() reports the host's cores, not the pod's limit."""
    try:
        with open("/sys/fs/cgroup/cpu.max") as f:
            quota, period = f.read().split()[:2]
        if quota != "max":
            return int(quota) / int(period)
        return None
    except (OSError, ValueError):
        pass
    try:
        with open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us") as f:
            quota = int(f.read())
        with open("/sys/fs/cgroup/cpu/cpu.cfs_period_us") as f:
            period = int(f.read())
        if quota > 0 and period > 0:
            return quota / period
    except (OSError, ValueError):
        pass
    return None


def cpu_count() -> int:
    try:
        n = len(os.sched_getaffinity(0))
    except AttributeError:  # not available on Windows / macOS
        n = os.cpu_count() or 1
    limit = _cgroup_cpu_limit()
    if limit:
        n = min(n, math.ceil(limit))
    return max(1, n)


CPUS = cpu_count()
# Threads per ONNX session (and for OpenCV). Beyond ~4 the small face models
# barely get faster, so extra cores are better spent on parallel requests.
INTRA_OP_THREADS = max(1, _env_int("FACE_INTRA_OP_THREADS", min(CPUS, 4)))
# Inferences running at once; further requests wait (see main.py).
MAX_CONCURRENCY = max(1, _env_int("FACE_MAX_CONCURRENCY", max(1, CPUS // INTRA_OP_THREADS)))

# OpenCV work (decode resize, crops, colour conversion) runs inside the same
# inference slot, so it gets the same thread budget.
cv2.setNumThreads(INTRA_OP_THREADS)


def session_options():
    """onnxruntime SessionOptions with the thread budget applied."""
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = INTRA_OP_THREADS
    opts.inter_op_num_threads = 1
    return opts
