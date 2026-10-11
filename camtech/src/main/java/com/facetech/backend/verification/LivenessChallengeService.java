package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.LivenessChallenge;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.LivenessSettingsService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.LivenessChallengeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Random;
import java.util.UUID;

/**
 * Active-liveness challenges. camtech draws the actions at random, so a recorded
 * video cannot know them in advance; each challenge is bound to the app and to one
 * verification (or, for the one-call flows, to one flow and user), works once, and
 * expires after a few minutes.
 */
@Service
@Slf4j
public class LivenessChallengeService {

    private static final SecureRandom RANDOM = new SecureRandom();

    /** What a client that does not send supportedActions can show (released apps). */
    public static final List<String> DEFAULT_SUPPORTED_ACTIONS = List.of("TURN_LEFT", "TURN_RIGHT", "BLINK");

    private final LivenessChallengeRepository repository;
    private final ConfigService config;
    private final LivenessSettingsService settings;

    public LivenessChallengeService(LivenessChallengeRepository repository, ConfigService config,
                                    LivenessSettingsService settings) {
        this.repository = repository;
        this.config = config;
        this.settings = settings;
    }

    public record Issued(String challengeId, List<String> actions, Instant expiresAt) {
    }

    /**
     * How one liveness upload is checked. {@code actions} null = no challenge to verify;
     * {@code challengeSkipped} = ACTIVE mode, but an older client sent none and that is allowed.
     */
    public record Resolution(Codes.LivenessMode mode, List<String> actions, boolean passiveRequired,
                             boolean challengeSkipped) {
    }

    /**
     * Issues a challenge for a selfie verification ({@code sessionId}) or a one-call flow (face authentication,
     * face registration, liveness check: {@code subjectRef}, which a liveness check may leave null).
     * The challenge is bound to {@code scope.flowCode()}.
     */
    @Transactional
    public Issued issue(Long sessionId, String subjectRef, ConfigService.Scope scope) {
        return issue(sessionId, subjectRef, scope, null);
    }

    /**
     * As above; {@code supportedActions} = what the client can show (null = {@link #DEFAULT_SUPPORTED_ACTIONS}).
     * The tenant's challengeCount actions are drawn from its selection that the client supports.
     */
    @Transactional
    public Issued issue(Long sessionId, String subjectRef, ConfigService.Scope scope, List<String> supportedActions) {
        RequestContext ctx = RequestContext.get();
        LivenessSettingsService.LivenessSettings s = settings.effective(ctx.getTenantId(), scope.flowCode());
        if (s.passive()) {
            log.debug("Challenge refused: flow {} uses passive liveness", scope.flowCode());
            throw new FaceMatchException(HttpStatus.CONFLICT, "CHALLENGE_NOT_USED",
                    "This flow uses passive liveness: send the selfies without a challenge");
        }
        List<String> supported = supportedActions == null ? DEFAULT_SUPPORTED_ACTIONS
                : supportedActions.stream().filter(java.util.Objects::nonNull).map(a -> a.trim().toUpperCase()).toList();
        List<String> actions = draw(s.actions(), supported, s.challengeCount(), RANDOM);
        if (actions == null) {
            log.info("Challenge refused: the app supports {} but flow {} needs {} of {}", supported, scope.flowCode(),
                    s.challengeCount(), s.actions());
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "CHALLENGE_REQUIRED",
                    "Please update the app and try again.");
        }

        LivenessChallenge c = new LivenessChallenge();
        c.setTenantId(ctx.getTenantId());
        c.setPublicId(UUID.randomUUID().toString());
        c.setClientAppId(ctx.getClientApp().getId());
        c.setSessionId(sessionId);
        c.setSubjectRef(subjectRef);
        c.setFlowCode(scope.flowCode());
        c.setActions(String.join(",", actions));
        c.setStatus(Codes.ChallengeStatus.ISSUED);
        c.setExpiresAt(Instant.now().plusSeconds(config.getInt(ConfigKey.LIVENESS_CHALLENGE_TTL_SECONDS, scope, 180)));
        repository.save(c);
        log.debug("Challenge {} issued for {} ({}): actions={} (selection={}, supported={}, count={}), expires {}",
                c.getPublicId(), scope.flowCode(), sessionId != null ? "session" : "one call", actions,
                s.actions(), supported, s.challengeCount(), c.getExpiresAt());
        return new Issued(c.getPublicId(), actions, c.getExpiresAt());
    }

    /**
     * {@code count} different actions of {@code selection} that the client {@code supported}, in random order;
     * null when fewer than {@code count} remain. {@code count} equal to what remains = all of them.
     */
    static List<String> draw(List<String> selection, Collection<String> supported, int count, Random random) {
        List<String> pool = new ArrayList<>(selection.stream().filter(supported::contains).distinct().toList());
        if (count < 1 || pool.size() < count) {
            return null;
        }
        Collections.shuffle(pool, random);
        return List.copyOf(pool.subList(0, count));
    }
    /**
     * Marks the challenge used and returns its actions. Called in the transaction that
     * starts a liveness attempt, so a challenge can never back two attempts.
     */
    @Transactional
    public List<String> consume(String challengeId, Long sessionId, String subjectRef, String flowCode) {
        RequestContext ctx = RequestContext.get();
        LivenessChallenge c = repository.findByPublicId(challengeId == null ? "" : challengeId.trim())
                .filter(x -> x.getTenantId().equals(ctx.getTenantId()))
                .filter(x -> x.getClientAppId().equals(ctx.getClientApp().getId()))
                .filter(x -> sessionId != null ? sessionId.equals(x.getSessionId())
                        : x.getSessionId() == null && sameFlow(x, flowCode) && Objects.equals(subjectRef, x.getSubjectRef()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.CONFLICT, "CHALLENGE_INVALID",
                        "This liveness check is no longer valid. Please try again."));
        if (c.getStatus() != Codes.ChallengeStatus.ISSUED) {
            log.debug("Challenge {} rejected: status is {}", c.getPublicId(), c.getStatus());
            throw new FaceMatchException(HttpStatus.CONFLICT, "CHALLENGE_INVALID",
                    "This liveness check is no longer valid. Please try again.");
        }
        if (c.getExpiresAt().isBefore(Instant.now())) {
            log.debug("Challenge {} rejected: expired at {}", c.getPublicId(), c.getExpiresAt());
            throw new FaceMatchException(HttpStatus.CONFLICT, "CHALLENGE_EXPIRED",
                    "You took too long to complete the check. Please try again.");
        }
        c.setStatus(Codes.ChallengeStatus.USED);
        c.setUsedAt(Instant.now());
        repository.saveAndFlush(c);
        log.debug("Challenge {} consumed: actions={}", c.getPublicId(), c.getActions());
        return List.of(c.getActions().split(","));
    }

    /**
     * How this upload is checked. ACTIVE: the challenge's actions (the challenge is used up); without a
     * challenge 400 CHALLENGE_REQUIRED, unless liveness.allow_without_challenge applies (then no challenge,
     * but the passive anti-spoof check is required). PASSIVE: no challenge, passive check required.
     */
    public Resolution resolve(String challengeId, Long sessionId, String subjectRef, ConfigService.Scope scope) {
        LivenessSettingsService.LivenessSettings s = settings.effective(RequestContext.get().getTenantId(), scope.flowCode());
        boolean sent = challengeId != null && !challengeId.isBlank();
        if (s.passive()) {
            log.debug("Flow {} uses passive liveness: no challenge{}", scope.flowCode(), sent ? " (the one sent is ignored)" : "");
            return new Resolution(Codes.LivenessMode.PASSIVE, null, true, false);
        }
        if (sent) {
            return new Resolution(Codes.LivenessMode.ACTIVE, consume(challengeId, sessionId, subjectRef, scope.flowCode()),
                    false, false);
        }
        boolean allowed = config.getBoolean(ConfigKey.LIVENESS_ALLOW_WITHOUT_CHALLENGE, scope);
        log.debug("No liveness challenge sent in ACTIVE mode (allowed without challenge={})", allowed);
        if (!allowed) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "CHALLENGE_REQUIRED",
                    "Ask for a liveness challenge (POST /v2/liveness-challenges) and send its frames");
        }
        return new Resolution(Codes.LivenessMode.ACTIVE, null, true, true);
    }

    /** Rows from before 1.6.0 have no flow: the one-call ones were all face authentications. */
    private static boolean sameFlow(LivenessChallenge c, String flowCode) {
        return c.getFlowCode() != null ? c.getFlowCode().equals(flowCode) : Codes.FLOW_FACE_AUTH.equals(flowCode);
    }
}
