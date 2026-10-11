"""Unit tests for the model-free parts of liveness: the anti-spoof face crop,
the softmax handling, the eye aspect ratio, the mouth ratio and the head
pitch from the 68 landmarks. Run with:

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import anti_spoof  # noqa: E402
from app.face_engine import eye_aspect_ratio, head_pitch, mouth_ratio  # noqa: E402


class CropBoxTest(unittest.TestCase):
    def test_box_is_scaled_around_the_centre(self):
        # 100x100 face centred at (500, 400) in a 1000x800 image, scale 2.7 -> 270x270
        x0, y0, x1, y1 = anti_spoof.crop_box(1000, 800, [450, 350, 550, 450], 2.7)
        self.assertAlmostEqual((x0 + x1) / 2, 500, delta=1)
        self.assertAlmostEqual((y0 + y1) / 2, 400, delta=1)
        self.assertAlmostEqual(x1 - x0, 270, delta=1)
        self.assertAlmostEqual(y1 - y0, 270, delta=1)

    def test_box_near_the_edge_is_shifted_inside(self):
        x0, y0, x1, y1 = anti_spoof.crop_box(640, 480, [0, 0, 100, 100], 2.7)
        self.assertEqual((x0, y0), (0, 0))
        self.assertAlmostEqual(x1, 270, delta=1)
        self.assertAlmostEqual(y1, 270, delta=1)

    def test_scale_shrinks_when_the_crop_cannot_fit(self):
        # 300px face in a 480px-high image: 4.0x does not fit, so the scale drops to (480-1)/300
        x0, y0, x1, y1 = anti_spoof.crop_box(640, 480, [170, 90, 470, 390], 4.0)
        self.assertGreaterEqual(x0, 0)
        self.assertGreaterEqual(y0, 0)
        self.assertLessEqual(x1, 639)
        self.assertLessEqual(y1, 479)
        self.assertAlmostEqual(y1 - y0, 479, delta=1)


class SoftmaxTest(unittest.TestCase):
    def test_probabilities_are_kept(self):
        p = anti_spoof.softmax_if_needed(np.array([[0.1, 0.7, 0.2]]))
        np.testing.assert_allclose(p, [0.1, 0.7, 0.2])

    def test_logits_are_normalised(self):
        p = anti_spoof.softmax_if_needed(np.array([[-1.0, 3.0, 0.5]]))
        self.assertAlmostEqual(float(p.sum()), 1.0, places=6)
        self.assertEqual(int(np.argmax(p)), 1)


def _face_with_eyes(openness: float) -> np.ndarray:
    """68 landmarks with both eyes 30px wide and `openness` * 30px tall."""
    pts = np.zeros((68, 3))
    for start, cx in ((36, 100.0), (42, 200.0)):
        h = openness * 30.0
        pts[start + 0, :2] = (cx - 15, 100)          # corner
        pts[start + 1, :2] = (cx - 5, 100 - h / 2)   # top
        pts[start + 2, :2] = (cx + 5, 100 - h / 2)   # top
        pts[start + 3, :2] = (cx + 15, 100)          # corner
        pts[start + 4, :2] = (cx + 5, 100 + h / 2)   # bottom
        pts[start + 5, :2] = (cx - 5, 100 + h / 2)   # bottom
    return pts


class EyeAspectRatioTest(unittest.TestCase):
    def test_open_eyes(self):
        self.assertAlmostEqual(eye_aspect_ratio(_face_with_eyes(0.3)), 0.3, places=3)

    def test_closed_eyes(self):
        self.assertLess(eye_aspect_ratio(_face_with_eyes(0.05)), 0.1)


def _face_with_mouth(mouth_width: float) -> np.ndarray:
    """68 landmarks with eye centres 100px apart and the mouth corners
    `mouth_width` px apart."""
    pts = _face_with_eyes(0.3)
    pts[48, :2] = (150 - mouth_width / 2, 180)
    pts[54, :2] = (150 + mouth_width / 2, 180)
    return pts


class MouthRatioTest(unittest.TestCase):
    def test_ratio_to_eye_distance(self):
        self.assertAlmostEqual(mouth_ratio(_face_with_mouth(80.0)), 0.8, places=6)

    def test_scale_free(self):
        self.assertAlmostEqual(mouth_ratio(_face_with_mouth(80.0) * 3.0), 0.8, places=6)

    def test_smile_is_wider(self):
        self.assertGreater(mouth_ratio(_face_with_mouth(95.0)), mouth_ratio(_face_with_mouth(80.0)) * 1.1)


def _mean_shape() -> np.ndarray:
    """Synthetic 3D face in image axes (x right, y down, z towards the
    camera), like insightface's meanshape_68: eyes at y=-0.3, the nose tip
    (30) at y=-0.14 sticking out to z=0.6, the chin (8) at y=0.58, the other
    points spread out so the fit is well posed."""
    rng = np.random.default_rng(7)
    pts = rng.uniform(-0.6, 0.6, size=(68, 3))
    pts[30] = (0.0, -0.14, 0.6)
    pts[8] = (0.0, 0.58, 0.39)
    pts[36:42] = (-0.3, -0.3, 0.25)
    pts[42:48] = (0.3, -0.3, 0.25)
    pts[36:48, 0] += np.tile(np.linspace(-0.08, 0.08, 6), 2)
    return pts


def _project(shape: np.ndarray, pitch_deg: float) -> np.ndarray:
    """Rotates the shape about the image x axis and projects it to pixels."""
    t = np.radians(pitch_deg)
    rx = np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])
    return (shape @ rx.T)[:, :2] * 200.0 + (320.0, 240.0)


def _nose_below_eyes(pts: np.ndarray) -> float:
    return float(pts[30, 1] - pts[36:48, 1].mean())


class HeadPitchTest(unittest.TestCase):
    def test_frontal_is_zero(self):
        shape = _mean_shape()
        self.assertAlmostEqual(head_pitch(_project(shape, 0.0), shape), 0.0, places=4)

    def test_chin_up_is_positive(self):
        shape = _mean_shape()
        frontal, up = _project(shape, 0.0), _project(shape, 20.0)
        # Chin up: the nose tip rises towards the eye line in the image.
        self.assertLess(_nose_below_eyes(up), _nose_below_eyes(frontal))
        self.assertAlmostEqual(head_pitch(up, shape), 20.0, places=4)

    def test_chin_down_is_negative(self):
        shape = _mean_shape()
        frontal, down = _project(shape, 0.0), _project(shape, -15.0)
        self.assertGreater(_nose_below_eyes(down), _nose_below_eyes(frontal))
        self.assertAlmostEqual(head_pitch(down, shape), -15.0, places=4)

    def test_landmark_depth_is_ignored(self):
        shape = _mean_shape()
        pts = np.hstack((_project(shape, 10.0), np.full((68, 1), 99.0)))
        self.assertAlmostEqual(head_pitch(pts, shape), 10.0, places=4)


if __name__ == "__main__":
    unittest.main()
