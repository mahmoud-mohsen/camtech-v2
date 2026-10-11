package com.facetech.backend.verification;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Decides whether the frames recorded during an active-liveness challenge show
 * the requested actions, in the requested order, by the same single person.
 *
 * <p>Measurements come from the face service: yaw in degrees, positive when the
 * nose points to the right of the (unmirrored) image, which is the person
 * turning to their own left; head pitch in degrees, positive when the person
 * looks up (chin up); eye aspect ratio (open about 0.25-0.35, closed below about
 * 0.2); mouth ratio (mouth width over the distance between the eyes, which grows
 * with a smile); face area ratio (face box over image area, which grows as the
 * person moves closer); similarity to the first selfie. Frames are in capture order.
 */
public final class ChallengeVerifier {

    private ChallengeVerifier() {
    }

    /** One challenge frame as measured by the face service; {@code error} set when no face was found. */
    public record Frame(int index, String error, int faceCount, Double yaw, Double ear, Double similarity,
                        Double pitch, Double mouthRatio, Double faceAreaRatio) {
        boolean usable() {
            return error == null && faceCount >= 1;
        }

        boolean faceless() {
            return error != null || faceCount == 0;
        }
    }

    public record Thresholds(double turnMinYaw, double eyesOpenMin, double eyesClosedMax, double minSimilarity,
                             double lookMinPitch, double smileMinGain, int maxFacelessFrames, double closerMinGain) {
    }

    /** {@code reasonCode} null = passed. {@code details} is stored with the check. */
    public record Result(String reasonCode, String failedAction, Map<String, Object> details) {
        public boolean passed() {
            return reasonCode == null;
        }
    }

    public static Result verify(List<String> actions, List<Frame> frames, Thresholds t) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("actions", actions);
        details.put("frames", frames.size());

        // Identity and single-face checks on every frame with a face.
        for (Frame f : frames) {
            if (f.error() == null && f.faceCount() > 1) {
                details.put("frame", f.index());
                return new Result("MULTIPLE_FACES", null, details);
            }
            if (f.usable() && f.similarity() != null && f.similarity() < t.minSimilarity()) {
                details.put("frame", f.index());
                details.put("similarity", round(f.similarity()));
                return new Result("FACE_CHANGED", null, details);
            }
        }
        // A face that leaves the frame cannot be followed: more than a stray faceless frame fails the attempt.
        List<Integer> faceless = frames.stream().filter(Frame::faceless).map(Frame::index).toList();
        if (faceless.size() > t.maxFacelessFrames()) {
            details.put("facelessFrames", faceless.size());
            details.put("facelessIndexes", faceless);
            return new Result("FACE_NOT_VISIBLE", null, details);
        }
        long usable = frames.stream().filter(Frame::usable).count();
        if (usable < actions.size() + 1L) {
            details.put("usableFrames", usable);
            return new Result("CHALLENGE_FAILED", actions.isEmpty() ? null : actions.get(0), details);
        }

        List<Integer> doneAt = new ArrayList<>();
        int cursor = 0;
        for (String action : actions) {
            int at = switch (action) {
                case "TURN_LEFT" -> findYaw(frames, cursor, t.turnMinYaw(), true);
                case "TURN_RIGHT" -> findYaw(frames, cursor, t.turnMinYaw(), false);
                case "BLINK" -> findBlink(frames, cursor, t);
                case "LOOK_UP" -> findPitch(frames, cursor, t.lookMinPitch(), true);
                case "LOOK_DOWN" -> findPitch(frames, cursor, t.lookMinPitch(), false);
                case "SMILE" -> findSmile(frames, cursor, t.smileMinGain());
                case "MOVE_CLOSER" -> findCloser(frames, cursor, t.closerMinGain());
                default -> -1;
            };
            if (at < 0) {
                details.put("doneAt", doneAt);
                return new Result("CHALLENGE_FAILED", action, details);
            }
            doneAt.add(frames.get(at).index());
            cursor = at + 1;
        }
        details.put("doneAt", doneAt);
        return new Result(null, null, details);
    }

    /** First usable frame from {@code from} turned at least {@code minYaw} to the requested side. */
    private static int findYaw(List<Frame> frames, int from, double minYaw, boolean left) {
        for (int i = from; i < frames.size(); i++) {
            Frame f = frames.get(i);
            if (f.usable() && f.yaw() != null && (left ? f.yaw() >= minYaw : f.yaw() <= -minYaw)) {
                return i;
            }
        }
        return -1;
    }

    /** First usable frame from {@code from} tilted at least {@code minPitch} up (or down). */
    private static int findPitch(List<Frame> frames, int from, double minPitch, boolean up) {
        for (int i = from; i < frames.size(); i++) {
            Frame f = frames.get(i);
            if (f.usable() && f.pitch() != null && (up ? f.pitch() >= minPitch : f.pitch() <= -minPitch)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * First usable frame from {@code from} whose mouth is at least {@code minGain} times as wide as in the
     * opening neutral frame (the first usable frame with a mouth measurement).
     */
    private static int findSmile(List<Frame> frames, int from, double minGain) {
        Double baseline = frames.stream().filter(f -> f.usable() && f.mouthRatio() != null).map(Frame::mouthRatio)
                .findFirst().orElse(null);
        if (baseline == null || baseline <= 0) {
            return -1;
        }
        for (int i = from; i < frames.size(); i++) {
            Frame f = frames.get(i);
            if (f.usable() && f.mouthRatio() != null && f.mouthRatio() >= baseline * minGain) {
                return i;
            }
        }
        return -1;
    }

    /**
     * First usable frame from {@code from} whose face area is at least {@code minGain} times the area in the
     * opening neutral frame (the first usable frame with an area).
     */
    private static int findCloser(List<Frame> frames, int from, double minGain) {
        Double baseline = frames.stream().filter(f -> f.usable() && f.faceAreaRatio() != null).map(Frame::faceAreaRatio)
                .findFirst().orElse(null);
        if (baseline == null || baseline <= 0) {
            return -1;
        }
        for (int i = from; i < frames.size(); i++) {
            Frame f = frames.get(i);
            if (f.usable() && f.faceAreaRatio() != null && f.faceAreaRatio() >= baseline * minGain) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Open, then closed, then open again. The opening frame may be the frame that
     * finished the previous action. Returns the index of the reopened frame.
     */
    private static int findBlink(List<Frame> frames, int from, Thresholds t) {
        int start = Math.max(0, from - 1);
        boolean sawOpen = false;
        int closedAt = -1;
        for (int i = start; i < frames.size(); i++) {
            Frame f = frames.get(i);
            if (!f.usable() || f.ear() == null) {
                continue;
            }
            if (closedAt < 0) {
                if (f.ear() >= t.eyesOpenMin()) {
                    sawOpen = true;
                } else if (sawOpen && f.ear() <= t.eyesClosedMax() && i >= from) {
                    closedAt = i;
                }
            } else if (f.ear() >= t.eyesOpenMin()) {
                return i;
            }
        }
        return -1;
    }

    private static double round(double v) {
        return Math.round(v * 10000) / 10000.0;
    }
}
