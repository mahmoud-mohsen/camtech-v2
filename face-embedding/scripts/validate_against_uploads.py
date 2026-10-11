"""Measures face-match accuracy on the real captures in backend_spring/uploads
using exactly the production pipeline (app/face_engine.py), and suggests the
Face Tech decision thresholds.

For every user folder with a selfie (face_pose_front_*.jpg) and an Emirates ID
front image (emirates_id_front_*.jpg) it computes cosine similarity for:
  - same-person pairs: selfie vs. that user's own ID
  - different-person pairs: selfie vs. every other user's ID

Test data often contains the same tester registered under several user ids,
which pollutes the different-person numbers. List such groups in a JSON file
and pass it with --same-person-groups, e.g. [["user_46", "user_54"]].
Pairs inside a group are counted as same-person.

Usage (from face_embedding/):
    .venv\\Scripts\\python.exe scripts/validate_against_uploads.py
    .venv\\Scripts\\python.exe scripts/validate_against_uploads.py --same-person-groups groups.json
    .venv\\Scripts\\python.exe scripts/validate_against_uploads.py --compare-plain
"""

import argparse
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import face_engine  # noqa: E402

UPLOADS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "backend_spring", "uploads")
)


def find_user_images():
    users = {}
    for user_dir in sorted(glob.glob(os.path.join(UPLOADS_DIR, "user_*"))):
        selfies = sorted(glob.glob(os.path.join(user_dir, "face_pose_front_*.jpg")))
        ids = sorted(glob.glob(os.path.join(user_dir, "emirates_id_front_*.jpg")))
        if selfies and ids:
            users[os.path.basename(user_dir)] = {"selfie": selfies[0], "id": ids[0]}
    return users


def load_groups(path):
    if not path:
        return {}
    with open(path, encoding="utf-8") as f:
        groups = json.load(f)
    owner = {}
    for i, group in enumerate(groups):
        for uid in group:
            owner[uid] = i
    return owner


def embed_pipeline(users):
    """Production pipeline: EXIF fix + small-face upscale; grayscale
    harmonisation is applied per pair below."""
    out = {}
    for uid, paths in users.items():
        out[uid] = {}
        for kind, path in paths.items():
            img = face_engine.decode_image(open(path, "rb").read())
            role = "selfie" if kind == "selfie" else "document"
            try:
                color = face_engine.analyze(img, role=role)
                gray = face_engine.analyze(img, role=role, force_grayscale=True)
                out[uid][kind] = (color, gray)
            except face_engine.FaceError as e:
                print(f"  [skip] {uid}/{kind}: {e.code}")
    return out


def embed_plain(users):
    """Old behaviour: no EXIF handling, no upscale, no harmonisation."""
    import cv2

    fa = face_engine.get_face_app()
    out = {}
    for uid, paths in users.items():
        out[uid] = {}
        for kind, path in paths.items():
            img = cv2.imread(path)
            faces = face_engine._detect(img, face_engine.DET_SIZE) if img is not None else []
            if faces:
                out[uid][kind] = face_engine._embed(img, face_engine._largest(faces))
    return out


def pair_scores(emb, owner, harmonized):
    same, diff = [], []
    uids = list(emb)
    for a in uids:
        if "selfie" not in emb[a]:
            continue
        for b in uids:
            if "id" not in emb[b]:
                continue
            if harmonized:
                s_color, s_gray = emb[a]["selfie"]
                i_color, i_gray = emb[b]["id"]
                gray = s_color.is_grayscale or i_color.is_grayscale
                sim = face_engine.cosine(
                    (s_gray if gray else s_color).embedding,
                    (i_gray if gray else i_color).embedding,
                )
            else:
                sim = face_engine.cosine(emb[a]["selfie"], emb[b]["id"])
            same_person = a == b or (a in owner and owner.get(a) == owner.get(b))
            (same if same_person else diff).append((a, b, sim))
    return same, diff


def summarize(label, same, diff):
    s = np.array([x[2] for x in same])
    d = np.array([x[2] for x in diff])
    print(f"\n=== {label} ===")
    if len(s):
        print(f"same-person      n={len(s):4d}  min={s.min():.3f}  p10={np.percentile(s, 10):.3f}  "
              f"mean={s.mean():.3f}  max={s.max():.3f}")
    if len(d):
        print(f"different-person n={len(d):4d}  min={d.min():.3f}  mean={d.mean():.3f}  "
              f"p99={np.percentile(d, 99):.3f}  max={d.max():.3f}")
    return s, d


def suggest(s, d, same, diff):
    if not len(s) or not len(d):
        return
    print("\nThreshold sweep (cosine similarity, higher = more similar):")
    print("  thr    accept-same   accept-different")
    for thr in [0.25, 0.28, 0.30, 0.35, 0.40, 0.45, 0.50]:
        print(f"  {thr:.2f}   {np.mean(s >= thr) * 100:6.1f}%      {np.mean(d >= thr) * 100:6.2f}%")
    print("\nLowest same-person pairs:")
    for a, _, sim in sorted(same, key=lambda x: x[2])[:5]:
        print(f"  {a}: {sim:.3f}")
    print("Highest different-person pairs (check for duplicate identities):")
    for a, b, sim in sorted(diff, key=lambda x: -x[2])[:8]:
        print(f"  {a} selfie vs {b} ID: {sim:.3f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--same-person-groups", help="JSON list of user-id groups that are the same person")
    parser.add_argument("--compare-plain", action="store_true", help="also run the old pipeline for comparison")
    args = parser.parse_args()

    users = find_user_images()
    if len(users) < 2:
        print(f"Need at least 2 users with a selfie and an ID front image under {UPLOADS_DIR}.")
        sys.exit(1)
    owner = load_groups(args.same_person_groups)
    print(f"Found {len(users)} usable users under {UPLOADS_DIR}.")

    face_engine.warm_up()

    if args.compare_plain:
        same, diff = pair_scores(embed_plain(users), owner, harmonized=False)
        summarize("old pipeline (no EXIF fix, no upscale, no grayscale harmonisation)", same, diff)

    same, diff = pair_scores(embed_pipeline(users), owner, harmonized=True)
    s, d = summarize("production pipeline", same, diff)
    suggest(s, d, same, diff)


if __name__ == "__main__":
    main()
