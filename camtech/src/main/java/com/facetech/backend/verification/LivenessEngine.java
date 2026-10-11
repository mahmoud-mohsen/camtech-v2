package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EmbeddingCodec;
import com.facetech.backend.service.FaceEmbeddingClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Server-side liveness on the normal selfie and, when the client sends one, a
 * closer selfie: the device anti-spoof score, image quality, the same person in
 * both, and the face really moving closer (newer clients do "move closer" as the
 * MOVE_CLOSER challenge instead, or not at all in PASSIVE mode). The client's own
 * "liveness passed" is never trusted. Every check is added to {@code checks}, including the one that
 * failed, so the caller can store them.
 */
@Component
@Slf4j
public class LivenessEngine {

    /** Quality issues that reject the "normal" selfie. */
    private static final Set<String> NORMAL_BLOCKING = Set.of(
            "MULTIPLE_FACES", "FACE_TOO_SMALL", "BLURRY", "TOO_DARK", "TOO_BRIGHT", "HEAD_TURNED", "HEAD_TILTED");
    /** The close-up is naturally large and often slightly tilted. */
    private static final Set<String> CLOSER_BLOCKING = Set.of(
            "MULTIPLE_FACES", "BLURRY", "TOO_DARK", "TOO_BRIGHT", "HEAD_TURNED");

    static final Map<String, String> ISSUE_MESSAGES = Map.of(
            "MULTIPLE_FACES", "Only one face should be visible in the camera.",
            "FACE_TOO_SMALL", "Move closer so your face fills the guide.",
            "BLURRY", "The photo is blurry. Hold the phone steady and try again.",
            "TOO_DARK", "It is too dark. Move to a brighter place and try again.",
            "TOO_BRIGHT", "There is too much light on your face. Avoid strong light and try again.",
            "HEAD_TURNED", "Look straight at the camera.",
            "HEAD_TILTED", "Keep your head level and look straight at the camera.");

    private final FaceEmbeddingClient faceClient;
    private final ConfigService config;

    public LivenessEngine(FaceEmbeddingClient faceClient, ConfigService config) {
        this.faceClient = faceClient;
        this.config = config;
    }

    /** {@code closer}, {@code samePersonSimilarity} and {@code closerAreaGain} are null when no closer selfie was sent. */
    public record Outcome(FaceEmbeddingClient.EmbedResult normal, FaceEmbeddingClient.EmbedResult closer,
                          Double samePersonSimilarity, Double closerAreaGain) {
        public boolean grayscale() {
            return normal.grayscale() || (closer != null && closer.grayscale());
        }
    }

    /** The selfie checks; without a closer selfie its three checks are recorded as SKIPPED. */
    public Outcome evaluate(byte[] normalImage, byte[] closerImage, Double deviceAntiSpoofScore,
                            ConfigService.Scope scope, List<CheckDraft> checks) {
        return evaluate(normalImage, closerImage, deviceAntiSpoofScore, false, scope, checks);
    }

    /** {@code closerByChallenge}: the MOVE_CLOSER challenge stands in for a missing closer selfie (nothing recorded). */
    private Outcome evaluate(byte[] normalImage, byte[] closerImage, Double deviceAntiSpoofScore, boolean closerByChallenge,
                             ConfigService.Scope scope, List<CheckDraft> checks) {
        double minAntiSpoof = config.getDouble(ConfigKey.LIVENESS_MIN_DEVICE_ANTISPOOF, scope);
        log.debug("Liveness inputs: normal={} bytes, closer={} bytes, deviceAntiSpoof={} (min {})",
                normalImage == null ? 0 : normalImage.length, closerImage == null ? 0 : closerImage.length,
                deviceAntiSpoofScore, fmt(minAntiSpoof));
        if (deviceAntiSpoofScore == null) {
            if (config.getBoolean(ConfigKey.LIVENESS_DEVICE_ANTISPOOF_REQUIRED, scope)) {
                checks.add(new CheckDraft("DEVICE_ANTISPOOF", null, fmt(minAntiSpoof), Codes.CheckOutcome.FAIL,
                        Map.of("reason", "missing")));
                throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                        "device_antispoof_score is required");
            }
            log.debug("Device anti-spoof score not sent and not required: check skipped");
            checks.add(new CheckDraft("DEVICE_ANTISPOOF", null, null, Codes.CheckOutcome.SKIPPED, null));
        } else {
            boolean ok = deviceAntiSpoofScore >= minAntiSpoof;
            checks.add(CheckDraft.of("DEVICE_ANTISPOOF", deviceAntiSpoofScore, fmt(minAntiSpoof), ok));
            if (!ok) {
                throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, "SPOOF_SUSPECTED",
                        "Liveness check failed: please use your real face, not a photo or a screen.");
            }
        }

        long t0 = System.nanoTime();
        FaceEmbeddingClient.EmbedResult normal = faceClient.embed(normalImage, "normal.jpg", FaceEmbeddingClient.ROLE_SELFIE);
        log.debug("Face service embed (normal selfie) took {} ms", (System.nanoTime() - t0) / 1_000_000);
        requireQuality("IMAGE_QUALITY_NORMAL", normal, NORMAL_BLOCKING, checks);
        if (closerImage == null) {
            log.debug("No closer selfie sent ({})", closerByChallenge ? "the MOVE_CLOSER challenge covers it" : "checks skipped");
            if (!closerByChallenge) {
                for (String code : List.of("IMAGE_QUALITY_CLOSER", "SAME_PERSON_NORMAL_CLOSER", "CLOSER_AREA_GAIN")) {
                    checks.add(new CheckDraft(code, null, null, Codes.CheckOutcome.SKIPPED, Map.of("reason", "no closer selfie")));
                }
            }
            return new Outcome(normal, null, null, null);
        }
        t0 = System.nanoTime();
        FaceEmbeddingClient.EmbedResult closer = faceClient.embed(closerImage, "closer.jpg", FaceEmbeddingClient.ROLE_SELFIE);
        log.debug("Face service embed (closer selfie) took {} ms", (System.nanoTime() - t0) / 1_000_000);
        requireQuality("IMAGE_QUALITY_CLOSER", closer, CLOSER_BLOCKING, checks);

        if (normal.embedding().size() != closer.embedding().size()) {
            throw new FaceMatchException(HttpStatus.INTERNAL_SERVER_ERROR, "EMBEDDING_MISMATCH",
                    "Embeddings from different models cannot be compared. Please start again.");
        }
        double samePerson = EmbeddingCodec.cosine(normal.embedding(), closer.embedding());
        double areaGain = normal.faceAreaRatio() > 0 ? closer.faceAreaRatio() / normal.faceAreaRatio() : 0.0;

        double minSame = config.getDouble(ConfigKey.LIVENESS_MIN_SAME_PERSON_SIMILARITY, scope);
        double minGain = config.getDouble(ConfigKey.LIVENESS_MIN_CLOSER_AREA_GAIN, scope);
        log.debug("Liveness selfies: samePerson={} (min {}), areaGain={} (min {}), faceArea normal={} closer={}",
                fmt3(samePerson), fmt(minSame), fmt3(areaGain), fmt(minGain),
                fmt3(normal.faceAreaRatio()), fmt3(closer.faceAreaRatio()));
        boolean sameOk = samePerson >= minSame;
        checks.add(CheckDraft.of("SAME_PERSON_NORMAL_CLOSER", samePerson, fmt(minSame), sameOk));
        if (!sameOk) {
            throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, "FACE_CHANGED",
                    "The face changed between the two steps. Please complete the check yourself, without switching people.");
        }
        boolean gainOk = areaGain >= minGain;
        checks.add(CheckDraft.of("CLOSER_AREA_GAIN", areaGain, fmt(minGain), gainOk));
        if (!gainOk) {
            throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, "NOT_CLOSER",
                    "We could not confirm that you moved closer. Please try again.");
        }
        return new Outcome(normal, closer, samePerson, areaGain);
    }

    /** Challenges that need face landmarks (eye openness, head pitch, mouth) from the face service. MOVE_CLOSER does not. */
    private static final Set<String> LANDMARK_ACTIONS = Set.of("BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE");

    /**
     * Full liveness: the selfie checks above, then passive anti-spoofing on every image and, when the
     * resolution has challenge actions, the active challenge shown by {@code challengeFrames}. The passive
     * check is required (fails when the model is unavailable) when the resolution says so (PASSIVE mode, or
     * ACTIVE without a challenge from an older client) or liveness.passive_required is set.
     */
    public Outcome evaluate(byte[] normalImage, byte[] closerImage, Double deviceAntiSpoofScore,
                            LivenessChallengeService.Resolution resolution, List<byte[]> challengeFrames,
                            ConfigService.Scope scope, List<CheckDraft> checks) {
        if (resolution.challengeSkipped()) {
            checks.add(new CheckDraft("ACTIVE_CHALLENGE", null, null, Codes.CheckOutcome.SKIPPED,
                    Map.of("reason", "client without challenge support")));
        }
        List<String> challengeActions = resolution.actions();
        boolean closerByChallenge = challengeActions != null && challengeActions.contains("MOVE_CLOSER");
        Outcome out = evaluate(normalImage, closerImage, deviceAntiSpoofScore, closerByChallenge, scope, checks);
        boolean hasCloser = closerImage != null;
        List<byte[]> frames = new ArrayList<>();
        if (hasCloser) {
            frames.add(closerImage);
        }
        if (challengeActions != null && challengeFrames != null) {
            frames.addAll(challengeFrames);
        }
        boolean landmarks = challengeActions != null && challengeActions.stream().anyMatch(LANDMARK_ACTIONS::contains);
        log.debug("Liveness measure: mode={} challenge={} challengeFrames={} landmarks={} passiveRequiredByMode={}",
                resolution.mode(), challengeActions, challengeFrames == null ? 0 : challengeFrames.size(), landmarks,
                resolution.passiveRequired());
        long t0 = System.nanoTime();
        FaceEmbeddingClient.LivenessMeasure m = faceClient.liveness(normalImage, frames, landmarks);
        log.debug("Face service liveness measure of {} frames took {} ms", frames.size(), (System.nanoTime() - t0) / 1_000_000);
        passive(m, hasCloser, resolution.passiveRequired(), scope, checks);
        if (challengeActions != null) {
            active(m, hasCloser ? 1 : 0, challengeActions, scope, checks);
        }
        return out;
    }

    /** {@code hasCloser}: the first measured frame is the closer selfie. */
    private void passive(FaceEmbeddingClient.LivenessMeasure m, boolean hasCloser, boolean requiredByMode,
                         ConfigService.Scope scope, List<CheckDraft> checks) {
        double min = config.getDouble(ConfigKey.LIVENESS_PASSIVE_MIN_SCORE, scope);
        if (m == null || !m.passiveAvailable() || m.referenceAntispoof() == null
                || (hasCloser && (m.frames().isEmpty() || m.frames().get(0).antispoof() == null))) {
            boolean required = requiredByMode || config.getBoolean(ConfigKey.LIVENESS_PASSIVE_REQUIRED, scope);
            log.warn("Passive anti-spoof model unavailable (measureReturned={}, passiveAvailable={}, required={})",
                    m != null, m != null && m.passiveAvailable(), required);
            if (required) {
                checks.add(new CheckDraft("PASSIVE_ANTISPOOF", null, fmt(min), Codes.CheckOutcome.FAIL,
                        Map.of("reason", "model unavailable")));
                throw unavailable();
            }
            checks.add(new CheckDraft("PASSIVE_ANTISPOOF", null, null, Codes.CheckOutcome.SKIPPED,
                    Map.of("reason", "model unavailable")));
            return;
        }
        // The selfies decide; challenge frames (often turned or mid-blink) only count through their median,
        // so one odd frame cannot fail a real person, while a replayed screen fails across the board.
        Double closer = hasCloser ? m.frames().get(0).antispoof() : null;
        double selfies = closer != null ? (m.referenceAntispoof() + closer) / 2 : m.referenceAntispoof();
        List<Double> challenge = m.frames().stream().skip(hasCloser ? 1 : 0).map(FaceEmbeddingClient.FrameMeasure::antispoof)
                .filter(java.util.Objects::nonNull).sorted().toList();
        Double median = challenge.isEmpty() ? null : challenge.get(challenge.size() / 2);
        double score = median == null ? selfies : Math.min(selfies, median);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("normal", m.referenceAntispoof());
        details.put("closer", closer);
        details.put("challengeMedian", median);
        details.put("model", m.passiveModel());
        boolean ok = score >= min;
        log.debug("Passive anti-spoof: score={} (min {}) normal={} closer={} challengeMedian={} model={} -> {}",
                fmt3(score), fmt(min), m.referenceAntispoof(), closer, median,
                m.passiveModel(), ok ? "PASS" : "FAIL");
        checks.add(new CheckDraft("PASSIVE_ANTISPOOF", score, fmt(min), ok ? Codes.CheckOutcome.PASS : Codes.CheckOutcome.FAIL,
                details));
        if (!ok) {
            throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, "SPOOF_SUSPECTED",
                    "Liveness check failed: please use your real face, not a photo or a screen.");
        }
    }

    /** {@code skip}: measured frames before the challenge frames (1 when the closer selfie was measured first). */
    private void active(FaceEmbeddingClient.LivenessMeasure m, int skip, List<String> actions, ConfigService.Scope scope,
                        List<CheckDraft> checks) {
        if (m == null) {
            log.warn("Face service returned no liveness measure: active challenge {} cannot be verified", actions);
            checks.add(new CheckDraft("ACTIVE_CHALLENGE", null, null, Codes.CheckOutcome.FAIL,
                    Map.of("reason", "face service cannot measure challenges")));
            throw unavailable();
        }
        List<ChallengeVerifier.Frame> frames = m.frames().stream().skip(skip)
                .map(f -> new ChallengeVerifier.Frame(f.index() - skip, f.error(), f.faceCount(), f.yaw(), f.ear(), f.similarity(),
                        f.headPitch(), f.mouthRatio(), f.faceAreaRatio()))
                .toList();
        ChallengeVerifier.Thresholds t = new ChallengeVerifier.Thresholds(
                config.getDouble(ConfigKey.LIVENESS_TURN_MIN_YAW, scope),
                config.getDouble(ConfigKey.LIVENESS_EYES_OPEN_MIN, scope),
                config.getDouble(ConfigKey.LIVENESS_EYES_CLOSED_MAX, scope),
                config.getDouble(ConfigKey.LIVENESS_MIN_SAME_PERSON_SIMILARITY, scope),
                config.getDouble(ConfigKey.LIVENESS_LOOK_MIN_PITCH, scope),
                config.getDouble(ConfigKey.LIVENESS_SMILE_MIN_GAIN, scope),
                config.getInt(ConfigKey.LIVENESS_MAX_FACELESS_FRAMES, scope, 1),
                config.getDouble(ConfigKey.LIVENESS_MIN_CLOSER_AREA_GAIN, scope));
        ChallengeVerifier.Result r = ChallengeVerifier.verify(actions, frames, t);
        Map<String, Object> details = new LinkedHashMap<>(r.details());
        details.put("yaw", frames.stream().map(f -> f.yaw() == null ? null : Math.round(f.yaw() * 10) / 10.0).toList());
        details.put("ear", frames.stream().map(f -> f.ear() == null ? null : Math.round(f.ear() * 1000) / 1000.0).toList());
        details.put("pitch", frames.stream().map(f -> f.pitch() == null ? null : Math.round(f.pitch() * 10) / 10.0).toList());
        details.put("mouth", frames.stream().map(f -> f.mouthRatio() == null ? null : Math.round(f.mouthRatio() * 1000) / 1000.0).toList());
        details.put("faceArea", frames.stream().map(f -> f.faceAreaRatio() == null ? null : Math.round(f.faceAreaRatio() * 1000) / 1000.0).toList());
        if (r.failedAction() != null) {
            details.put("failedAction", r.failedAction());
        }
        if (log.isDebugEnabled()) {
            log.debug("Active challenge {}: result={} failedAction={} thresholds turnMinYaw={} eyesOpenMin={} eyesClosedMax={} "
                            + "minSimilarity={} lookMinPitch={} smileMinGain={} maxFacelessFrames={} closerMinGain={}",
                    actions, r.passed() ? "PASS" : r.reasonCode(), r.failedAction(), fmt(t.turnMinYaw()),
                    fmt(t.eyesOpenMin()), fmt(t.eyesClosedMax()), fmt(t.minSimilarity()), fmt(t.lookMinPitch()),
                    fmt(t.smileMinGain()), t.maxFacelessFrames(), fmt(t.closerMinGain()));
            log.debug("Active challenge frames: errors={} faceCounts={} yaw={} pitch={} ear={} mouth={} similarity={} details={}",
                    frames.stream().map(ChallengeVerifier.Frame::error).toList(),
                    frames.stream().map(ChallengeVerifier.Frame::faceCount).toList(),
                    details.get("yaw"), details.get("pitch"), details.get("ear"), details.get("mouth"),
                    frames.stream().map(f -> f.similarity() == null ? null : Math.round(f.similarity() * 1000) / 1000.0).toList(),
                    r.details());
        }
        checks.add(new CheckDraft("ACTIVE_CHALLENGE", null, String.join(",", actions),
                r.passed() ? Codes.CheckOutcome.PASS : Codes.CheckOutcome.FAIL, details));
        if (!r.passed()) {
            String code = r.reasonCode();
            String message = switch (code) {
                case "MULTIPLE_FACES" -> ISSUE_MESSAGES.get("MULTIPLE_FACES");
                case "FACE_CHANGED" -> "The face changed between the two steps. Please complete the check yourself, without switching people.";
                case "FACE_NOT_VISIBLE" -> "We lost sight of your face during the check. Keep your face in the frame and try again.";
                default -> "We could not see you follow the instructions. Please try again and follow each step on the screen.";
            };
            throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
        }
    }

    private static FaceMatchException unavailable() {
        return new FaceMatchException(HttpStatus.SERVICE_UNAVAILABLE, "LIVENESS_UNAVAILABLE",
                "The liveness check is temporarily unavailable. Please try again in a few minutes.");
    }

    private static void requireQuality(String checkCode, FaceEmbeddingClient.EmbedResult result, Set<String> blocking,
                                       List<CheckDraft> checks) {
        String blocked = result.issues().stream().filter(blocking::contains).findFirst().orElse(null);
        log.debug("{}: issues={} blocking={} faceCount={} detScore={} faceAreaRatio={} grayscale={} model={}",
                checkCode, result.issues(), blocked, result.faceCount(), fmt3(result.detScore()),
                fmt3(result.faceAreaRatio()), result.grayscale(), result.modelVersion());
        Map<String, Object> details = Map.of(
                "issues", result.issues(),
                "faceCount", result.faceCount(),
                "detScore", result.detScore(),
                "faceAreaRatio", result.faceAreaRatio(),
                "grayscale", result.grayscale());
        checks.add(new CheckDraft(checkCode, result.detScore(), null,
                blocked == null ? Codes.CheckOutcome.PASS : Codes.CheckOutcome.FAIL, details));
        if (blocked != null) {
            throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, blocked,
                    ISSUE_MESSAGES.getOrDefault(blocked, "The photo quality is too low. Please try again."));
        }
    }

    static String fmt(double v) {
        return String.format(Locale.ROOT, "%.2f", v);
    }

    private static String fmt3(double v) {
        return String.format(Locale.ROOT, "%.3f", v);
    }
}
