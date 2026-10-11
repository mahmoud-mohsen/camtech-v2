"""Checks the passive anti-spoof models on your own photos, with both pixel scalings.

Use one real selfie (taken with the camera) and one attack photo (for example the
same selfie shown on a phone screen and photographed again, or a printed photo).
The right scaling is the one where the real selfie scores high (close to 1) and
the attack scores low; set ANTISPOOF_INPUT_SCALE to it.

    pip install onnxruntime opencv-python-headless numpy insightface
    python scripts/check_antispoof.py real.jpg attack.jpg
"""

import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def main(paths):
    from app import anti_spoof, face_engine

    if not anti_spoof.load():
        sys.exit(f"Models not loaded: {anti_spoof.status()['error']}")
    for path in paths:
        img = cv2.imread(path)
        if img is None:
            print(f"{path}: cannot read")
            continue
        faces = face_engine._detect(img, face_engine.DET_SIZE)
        if not faces:
            print(f"{path}: no face")
            continue
        bbox = face_engine._largest(faces).bbox
        for scale, label in ((1.0, "raw 0-255"), (1 / 255.0, "0-1")):
            anti_spoof.INPUT_SCALE = scale
            r = anti_spoof.score(img, bbox)
            print(f"{path:30s} {label:10s} real={r['score']:.3f} {r['models']}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    np.set_printoptions(precision=3)
    main(sys.argv[1:])
