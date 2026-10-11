package com.facetech.backend.verification;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ChallengeVerifierTest {

    private static final ChallengeVerifier.Thresholds T = new ChallengeVerifier.Thresholds(18, 0.20, 0.15, 0.5, 15, 1.10, 1, 1.10);

    /** A frame of the same person with this yaw and eye openness. */
    private static ChallengeVerifier.Frame f(int i, double yaw, double ear) {
        return new ChallengeVerifier.Frame(i, null, 1, yaw, ear, 0.8, 0.0, 0.80, null);
    }

    private static List<ChallengeVerifier.Frame> frames(double[][] yawEar) {
        List<ChallengeVerifier.Frame> out = new ArrayList<>();
        for (int i = 0; i < yawEar.length; i++) {
            out.add(f(i, yawEar[i][0], yawEar[i][1]));
        }
        return out;
    }

    @Test
    void turnLeftThenBlinkPasses() {
        var r = ChallengeVerifier.verify(List.of("TURN_LEFT", "BLINK"),
                frames(new double[][]{{0, 0.3}, {25, 0.3}, {2, 0.3}, {1, 0.08}, {0, 0.3}}), T);
        assertThat(r.passed()).isTrue();
        assertThat(r.details().get("doneAt")).isEqualTo(List.of(1, 4));
    }

    @Test
    void turningTheWrongWayFails() {
        var r = ChallengeVerifier.verify(List.of("TURN_LEFT"), frames(new double[][]{{0, 0.3}, {-30, 0.3}, {0, 0.3}}), T);
        assertThat(r.reasonCode()).isEqualTo("CHALLENGE_FAILED");
        assertThat(r.failedAction()).isEqualTo("TURN_LEFT");
    }

    @Test
    void actionsMustHappenInTheRequestedOrder() {
        // right turn happens before the left turn, but the challenge asks left first
        var r = ChallengeVerifier.verify(List.of("TURN_LEFT", "TURN_RIGHT"),
                frames(new double[][]{{0, 0.3}, {-25, 0.3}, {0, 0.3}, {25, 0.3}, {0, 0.3}}), T);
        assertThat(r.passed()).isFalse();
        assertThat(r.failedAction()).isEqualTo("TURN_RIGHT");
    }

    @Test
    void aSmallTurnIsNotEnough() {
        var r = ChallengeVerifier.verify(List.of("TURN_RIGHT"), frames(new double[][]{{0, 0.3}, {-10, 0.3}, {0, 0.3}}), T);
        assertThat(r.passed()).isFalse();
    }

    @Test
    void blinkNeedsOpenClosedOpen() {
        var closedOnly = ChallengeVerifier.verify(List.of("BLINK"), frames(new double[][]{{0, 0.08}, {0, 0.08}, {0, 0.08}}), T);
        assertThat(closedOnly.passed()).as("eyes never open: a photo with closed eyes").isFalse();
        var neverReopened = ChallengeVerifier.verify(List.of("BLINK"), frames(new double[][]{{0, 0.3}, {0, 0.3}, {0, 0.08}}), T);
        assertThat(neverReopened.passed()).isFalse();
        var halfClosed = ChallengeVerifier.verify(List.of("BLINK"), frames(new double[][]{{0, 0.3}, {0, 0.18}, {0, 0.3}}), T);
        assertThat(halfClosed.passed()).as("0.18 is neither open nor closed").isFalse();
        var blink = ChallengeVerifier.verify(List.of("BLINK"), frames(new double[][]{{0, 0.3}, {0, 0.1}, {0, 0.29}}), T);
        assertThat(blink.passed()).isTrue();
    }

    @Test
    void anotherPersonOrASecondFaceFails() {
        List<ChallengeVerifier.Frame> swapped = new ArrayList<>(frames(new double[][]{{0, 0.3}, {25, 0.3}, {0, 0.3}}));
        swapped.set(1, new ChallengeVerifier.Frame(1, null, 1, 25.0, 0.3, 0.2, null, null, null));
        assertThat(ChallengeVerifier.verify(List.of("TURN_LEFT"), swapped, T).reasonCode()).isEqualTo("FACE_CHANGED");

        List<ChallengeVerifier.Frame> twoFaces = new ArrayList<>(frames(new double[][]{{0, 0.3}, {25, 0.3}, {0, 0.3}}));
        twoFaces.set(2, new ChallengeVerifier.Frame(2, null, 2, 0.0, 0.3, 0.8, null, null, null));
        assertThat(ChallengeVerifier.verify(List.of("TURN_LEFT"), twoFaces, T).reasonCode()).isEqualTo("MULTIPLE_FACES");
    }

    @Test
    void tooFewUsableFramesFail() {
        List<ChallengeVerifier.Frame> frames = List.of(f(0, 25, 0.3),
                new ChallengeVerifier.Frame(1, "NO_FACE", 0, null, null, null, null, null, null));
        var r = ChallengeVerifier.verify(List.of("TURN_LEFT", "BLINK"), frames, T);
        assertThat(r.reasonCode()).isEqualTo("CHALLENGE_FAILED");
    }

    @Test
    void framesWithoutAFaceAreSkippedNotFatal() {
        List<ChallengeVerifier.Frame> frames = List.of(f(0, 0, 0.3), new ChallengeVerifier.Frame(1, "NO_FACE", 0, null, null, null, null, null, null),
                f(2, 30, 0.3), f(3, 0, 0.3));
        assertThat(ChallengeVerifier.verify(List.of("TURN_LEFT"), frames, T).passed()).isTrue();
    }

    // ================================================================ look up / look down / smile / face not visible

    /** A frame of the same person, looking straight, with this head pitch (+ = up) and mouth ratio. */
    private static ChallengeVerifier.Frame p(int i, double pitch, double mouth) {
        return new ChallengeVerifier.Frame(i, null, 1, 0.0, 0.3, 0.8, pitch, mouth, null);
    }

    private static ChallengeVerifier.Frame noFace(int i) {
        return new ChallengeVerifier.Frame(i, "NO_FACE", 0, null, null, null, null, null, null);
    }

    @Test
    void lookUpAndLookDownPass() {
        var r = ChallengeVerifier.verify(List.of("LOOK_UP", "LOOK_DOWN"),
                List.of(p(0, 0, 0.8), p(1, 20, 0.8), p(2, 1, 0.8), p(3, -19, 0.8), p(4, 0, 0.8)), T);
        assertThat(r.passed()).isTrue();
        assertThat(r.details().get("doneAt")).isEqualTo(List.of(1, 3));
    }

    @Test
    void lookingTheWrongWayOrTooLittleFails() {
        var wrongWay = ChallengeVerifier.verify(List.of("LOOK_UP"), List.of(p(0, 0, 0.8), p(1, -25, 0.8), p(2, 0, 0.8)), T);
        assertThat(wrongWay.reasonCode()).isEqualTo("CHALLENGE_FAILED");
        assertThat(wrongWay.failedAction()).isEqualTo("LOOK_UP");
        var downWrongWay = ChallengeVerifier.verify(List.of("LOOK_DOWN"), List.of(p(0, 0, 0.8), p(1, 25, 0.8), p(2, 0, 0.8)), T);
        assertThat(downWrongWay.failedAction()).isEqualTo("LOOK_DOWN");
        var tooLittle = ChallengeVerifier.verify(List.of("LOOK_UP"), List.of(p(0, 0, 0.8), p(1, 10, 0.8), p(2, 0, 0.8)), T);
        assertThat(tooLittle.passed()).isFalse();
        var noPitch = ChallengeVerifier.verify(List.of("LOOK_UP"),
                List.of(f(0, 0, 0.3), new ChallengeVerifier.Frame(1, null, 1, 0.0, 0.3, 0.8, null, null, null), f(2, 0, 0.3)), T);
        assertThat(noPitch.passed()).as("an old face service without head pitch cannot confirm a look").isFalse();
    }

    @Test
    void smileIsMeasuredAgainstTheOpeningNeutralFrame() {
        var smile = ChallengeVerifier.verify(List.of("SMILE"), List.of(p(0, 0, 0.80), p(1, 0, 0.95), p(2, 0, 0.80)), T);
        assertThat(smile.passed()).isTrue();
        var tooSmall = ChallengeVerifier.verify(List.of("SMILE"), List.of(p(0, 0, 0.80), p(1, 0, 0.85), p(2, 0, 0.80)), T);
        assertThat(tooSmall.passed()).as("0.85 is under 0.80 x 1.10").isFalse();
        var narrower = ChallengeVerifier.verify(List.of("SMILE"), List.of(p(0, 0, 0.80), p(1, 0, 0.60), p(2, 0, 0.80)), T);
        assertThat(narrower.failedAction()).isEqualTo("SMILE");
    }

    @Test
    void smileAfterAnotherActionStillUsesTheFirstFrameAsBaseline() {
        var r = ChallengeVerifier.verify(List.of("LOOK_DOWN", "SMILE"),
                List.of(p(0, 0, 0.80), p(1, -20, 0.80), p(2, 0, 0.82), p(3, 0, 0.92), p(4, 0, 0.80)), T);
        assertThat(r.passed()).isTrue();
        assertThat(r.details().get("doneAt")).isEqualTo(List.of(1, 3));
    }

    @Test
    void moreFacelessFramesThanAllowedFailWithFaceNotVisible() {
        List<ChallengeVerifier.Frame> oneMissing = List.of(p(0, 0, 0.8), noFace(1), p(2, 20, 0.8), p(3, 0, 0.8));
        assertThat(ChallengeVerifier.verify(List.of("LOOK_UP"), oneMissing, T).passed()).as("one is tolerated").isTrue();

        List<ChallengeVerifier.Frame> twoMissing = List.of(p(0, 0, 0.8), noFace(1), p(2, 20, 0.8),
                new ChallengeVerifier.Frame(3, "DETECTION_ERROR", 0, null, null, null, null, null, null), p(4, 0, 0.8));
        var r = ChallengeVerifier.verify(List.of("LOOK_UP"), twoMissing, T);
        assertThat(r.reasonCode()).isEqualTo("FACE_NOT_VISIBLE");
        assertThat(r.details()).containsEntry("facelessFrames", 2).containsEntry("facelessIndexes", List.of(1, 3));

        var strict = new ChallengeVerifier.Thresholds(18, 0.20, 0.15, 0.5, 15, 1.10, 0, 1.10);
        assertThat(ChallengeVerifier.verify(List.of("LOOK_UP"), oneMissing, strict).reasonCode()).isEqualTo("FACE_NOT_VISIBLE");
    }

    // ================================================================ move closer

    /** A frame of the same person, looking straight, whose face covers this share of the image. */
    private static ChallengeVerifier.Frame area(int i, double faceAreaRatio) {
        return new ChallengeVerifier.Frame(i, null, 1, 0.0, 0.3, 0.8, 0.0, 0.8, faceAreaRatio);
    }

    @Test
    void moveCloserIsMeasuredAgainstTheOpeningNeutralFrame() {
        var closer = ChallengeVerifier.verify(List.of("MOVE_CLOSER"), List.of(area(0, 0.10), area(1, 0.14), area(2, 0.10)), T);
        assertThat(closer.passed()).isTrue();
        assertThat(closer.details().get("doneAt")).isEqualTo(List.of(1));
        var tooLittle = ChallengeVerifier.verify(List.of("MOVE_CLOSER"), List.of(area(0, 0.10), area(1, 0.105), area(2, 0.10)), T);
        assertThat(tooLittle.failedAction()).as("1.05x is under 1.10x").isEqualTo("MOVE_CLOSER");
        var away = ChallengeVerifier.verify(List.of("MOVE_CLOSER"), List.of(area(0, 0.10), area(1, 0.06), area(2, 0.10)), T);
        assertThat(away.passed()).as("moving away is not moving closer").isFalse();
        var unmeasured = ChallengeVerifier.verify(List.of("MOVE_CLOSER"), List.of(f(0, 0, 0.3), f(1, 0, 0.3), f(2, 0, 0.3)), T);
        assertThat(unmeasured.passed()).as("no face area, nothing to compare").isFalse();
    }

    @Test
    void moveCloserAfterAnotherActionInOrder() {
        List<ChallengeVerifier.Frame> frames = List.of(area(0, 0.10),
                new ChallengeVerifier.Frame(1, null, 1, 25.0, 0.3, 0.8, 0.0, 0.8, 0.10), area(2, 0.10), area(3, 0.13), area(4, 0.10));
        var r = ChallengeVerifier.verify(List.of("TURN_LEFT", "MOVE_CLOSER"), frames, T);
        assertThat(r.passed()).isTrue();
        assertThat(r.details().get("doneAt")).isEqualTo(List.of(1, 3));
        var wrongOrder = ChallengeVerifier.verify(List.of("MOVE_CLOSER", "TURN_LEFT"), List.of(area(0, 0.10),
                new ChallengeVerifier.Frame(1, null, 1, 25.0, 0.3, 0.8, 0.0, 0.8, 0.10), area(2, 0.13), area(3, 0.10)), T);
        assertThat(wrongOrder.failedAction()).isEqualTo("TURN_LEFT");
    }
}
