package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.RefFlowDef;
import com.facetech.backend.domain.ReviewAction;
import com.facetech.backend.domain.ReviewCase;
import com.facetech.backend.domain.StepMedia;
import com.facetech.backend.domain.VerificationCheck;
import com.facetech.backend.domain.VerificationDecision;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.CamtechProperties;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.OutboxService;
import com.facetech.backend.platform.ReasonCatalog;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.RefFlowDefRepository;
import com.facetech.backend.repository.RefFlowStepDefRepository;
import com.facetech.backend.repository.ReviewActionRepository;
import com.facetech.backend.repository.ReviewCaseRepository;
import com.facetech.backend.repository.StepMediaRepository;
import com.facetech.backend.repository.VerificationCheckRepository;
import com.facetech.backend.repository.VerificationDecisionRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.repository.VerificationStepRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Persistence building blocks shared by the verification flows. Callers own
 * the transaction; nothing here starts one.
 */
@Service
@Slf4j
public class SessionSupport {

    private final VerificationSessionRepository sessionRepository;
    private final VerificationStepRepository stepRepository;
    private final VerificationCheckRepository checkRepository;
    private final StepMediaRepository stepMediaRepository;
    private final VerificationDecisionRepository decisionRepository;
    private final ReviewCaseRepository reviewCaseRepository;
    private final ReviewActionRepository reviewActionRepository;
    private final FaceTemplateRepository templateRepository;
    private final RefFlowDefRepository flowRepository;
    private final RefFlowStepDefRepository flowStepRepository;
    private final ConfigService config;
    private final EntitlementService entitlements;
    private final OutboxService outbox;
    private final ReasonCatalog reasons;
    private final CamtechProperties properties;
    private final ObjectMapper objectMapper;

    public SessionSupport(VerificationSessionRepository sessionRepository, VerificationStepRepository stepRepository,
                          VerificationCheckRepository checkRepository, StepMediaRepository stepMediaRepository,
                          VerificationDecisionRepository decisionRepository, ReviewCaseRepository reviewCaseRepository,
                          ReviewActionRepository reviewActionRepository, FaceTemplateRepository templateRepository,
                          RefFlowDefRepository flowRepository, RefFlowStepDefRepository flowStepRepository,
                          ConfigService config, EntitlementService entitlements, OutboxService outbox,
                          ReasonCatalog reasons, CamtechProperties properties, ObjectMapper objectMapper) {
        this.sessionRepository = sessionRepository;
        this.stepRepository = stepRepository;
        this.checkRepository = checkRepository;
        this.stepMediaRepository = stepMediaRepository;
        this.decisionRepository = decisionRepository;
        this.reviewCaseRepository = reviewCaseRepository;
        this.reviewActionRepository = reviewActionRepository;
        this.templateRepository = templateRepository;
        this.flowRepository = flowRepository;
        this.flowStepRepository = flowStepRepository;
        this.config = config;
        this.entitlements = entitlements;
        this.outbox = outbox;
        this.reasons = reasons;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    // ---------------------------------------------------------------- loading

    /** Loads a session of {@code flowCode} for the caller, checking the session token and app ownership. */
    public VerificationSession load(String publicId, String flowCode) {
        VerificationSession s = sessionRepository.findByPublicId(publicId)
                .filter(x -> flowCode == null || flowCode.equals(x.getFlowCode()))
                .orElseThrow(SessionSupport::notFound);
        RequestContext ctx = RequestContext.get();
        if (ctx.isCredentialed() && ctx.getClientApp() != null && !ctx.getClientApp().getId().equals(s.getClientAppId())) {
            log.warn("Session {} requested by client app {} but belongs to client app {}: reported as not found",
                    publicId, ctx.getClientApp().getId(), s.getClientAppId());
            throw notFound();
        }
        String bearer = ctx.getBearerToken();
        if (bearer != null) {
            if (!Secrets.sameHash(Secrets.sha256Hex(bearer), s.getTokenHash())) {
                log.debug("Session {}: session token does not match", publicId);
                throw new FaceMatchException(HttpStatus.UNAUTHORIZED, "SESSION_TOKEN_INVALID",
                        "The session token is missing or not valid for this verification");
            }
        } else if (properties.getSecurity().isRequireSessionToken()) {
            throw new FaceMatchException(HttpStatus.UNAUTHORIZED, "SESSION_TOKEN_INVALID",
                    "Send the session token as \"Authorization: Bearer <sessionToken>\"");
        }
        return s;
    }

    /** True when the session's TTL passed while it was still open (the caller then marks it expired). */
    public boolean isExpired(VerificationSession s) {
        return s.getStatus().isOpen() && s.getExpiresAt().isBefore(Instant.now());
    }

    public void expire(VerificationSession s) {
        log.info("Session {} ({}) expired: stage={} expiresAt={}", s.getPublicId(), s.getFlowCode(), s.getStage(), s.getExpiresAt());
        s.setStatus(Codes.SessionStatus.EXPIRED);
        s.setCompletedAt(Instant.now());
        outbox.publish("SESSION", s.getPublicId(), Codes.EVENT_SESSION_EXPIRED, eventData(s));
    }

    public static FaceMatchException notFound() {
        return new FaceMatchException(HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "Verification not found. Please start again.");
    }

    public static FaceMatchException expired() {
        return new FaceMatchException(HttpStatus.GONE, "SESSION_EXPIRED", "This session has expired. Please start again.");
    }

    // ---------------------------------------------------------------- steps

    /** Max attempts for a step: config_param override, else the flow step definition, else 1. */
    public int maxAttempts(String flowCode, String stepCode, ConfigKey override, ConfigService.Scope scope) {
        int fromFlow = flowRepository.findByCode(flowCode)
                .flatMap(f -> flowStepRepository.findByFlowIdAndStepCode(f.getId(), stepCode))
                .map(d -> d.getMaxAttempts()).orElse(1);
        int max = override != null ? config.getInt(override, scope, fromFlow) : fromFlow;
        log.debug("Max attempts for {}/{}: {} (flow definition {}, override key {})", flowCode, stepCode, max, fromFlow, override);
        return max;
    }

    /**
     * Whether the max attempts of a flow step definition is used (by {@link #maxAttempts} callers). Every other step
     * runs once per session, so its max attempts has no effect. Keep in step with the callers of maxAttempts.
     */
    public static boolean usesStepMaxAttempts(String flowCode, String stepCode) {
        return Codes.FLOW_SELFIE_ID.equals(flowCode) && (Codes.LIVENESS.equals(stepCode) || Codes.DOC_CAPTURE.equals(stepCode));
    }

    public boolean flowHasStep(String flowCode, String stepCode) {
        return flowRepository.findByCode(flowCode).map(RefFlowDef::getId)
                .flatMap(id -> flowStepRepository.findByFlowIdAndStepCode(id, stepCode)).isPresent();
    }

    /** Reason codes of failures on camtech's side; those attempts are not counted against the user. */
    public static final Set<String> SYSTEM_FAILURES = Set.of(
            "FACE_SERVICE_UNAVAILABLE", "FACE_SERVICE_ERROR", "STORAGE_ERROR", "EMBEDDING_MISMATCH", "INTERNAL_ERROR");

    public static boolean isSystemFailure(FaceMatchException e) {
        return SYSTEM_FAILURES.contains(e.getCode()) || e.getStatus().is5xxServerError();
    }

    /** Attempts that count towards the limit (system failures excluded). */
    public int attemptsUsed(VerificationSession s, String stepCode) {
        return (int) stepRepository.findBySessionIdOrderByIdAsc(s.getId()).stream()
                .filter(st -> st.getStepCode().equals(stepCode))
                .filter(st -> st.getReasonCode() == null || !SYSTEM_FAILURES.contains(st.getReasonCode()))
                .count();
    }

    /** Number shown on the next attempt row: every try is numbered, system failures included. */
    public int nextAttemptNo(VerificationSession s, String stepCode) {
        return (int) stepRepository.countBySessionIdAndStepCode(s.getId(), stepCode) + 1;
    }

    public VerificationStep startStep(VerificationSession s, String stepCode, int attemptNo) {
        VerificationStep step = new VerificationStep();
        step.setTenantId(s.getTenantId());
        step.setSessionId(s.getId());
        step.setStepCode(stepCode);
        step.setAttemptNo(attemptNo);
        step.setStatus(Codes.StepStatus.IN_PROGRESS);
        step.setStartedAt(Instant.now());
        return stepRepository.save(step);
    }

    public VerificationStep step(Long stepId) {
        return stepRepository.findById(stepId).orElseThrow();
    }

    public void finishStep(VerificationStep step, Codes.StepStatus status, String reasonCode, String fallbackMessage) {
        step.setStatus(status);
        step.setReasonCode(reasonCode);
        if (reasonCode != null) {
            String msg = reasons.message(reasonCode, "en");
            step.setReasonMessage(truncate(msg != null ? msg : fallbackMessage, 500));
        }
        step.setEndedAt(Instant.now());
    }

    public void saveChecks(VerificationStep step, List<CheckDraft> drafts) {
        for (CheckDraft d : drafts) {
            VerificationCheck c = new VerificationCheck();
            c.setTenantId(step.getTenantId());
            c.setStepId(step.getId());
            c.setCheckCode(d.code());
            c.setScore(d.score() != null && Double.isFinite(d.score())
                    ? BigDecimal.valueOf(d.score()).setScale(6, RoundingMode.HALF_UP) : null);
            c.setThresholdUsed(d.thresholdUsed());
            c.setOutcome(d.outcome());
            c.setDetails(json(d.details()));
            checkRepository.save(c);
        }
    }

    public void attachMedia(VerificationStep step, MediaFile media, String role) {
        StepMedia sm = new StepMedia();
        sm.setTenantId(step.getTenantId());
        sm.setStepId(step.getId());
        sm.setMediaId(media.getId());
        sm.setRole(role);
        stepMediaRepository.save(sm);
    }

    // ---------------------------------------------------------------- decision

    /**
     * Records the final decision. REVIEW opens a review case when manual
     * review is enabled; otherwise it becomes REJECTED. APPROVED registers the
     * session's face templates for the party when the session asked for it ({@code enrollFace}).
     */
    public VerificationDecision decide(VerificationSession s, Codes.Decision decision, String reason, Double similarity,
                                       String reviewReason) {
        if (decision == Codes.Decision.REVIEW
                && !entitlements.isEnabled(Codes.FeatureType.FEATURE, Codes.FEATURE_MANUAL_REVIEW)) {
            log.info("Session {}: REVIEW turned into REJECTED because manual review is not enabled", s.getPublicId());
            decision = Codes.Decision.REJECTED;
            reason = reason + " (manual review is not enabled)";
        }
        Instant now = Instant.now();
        VerificationDecision d = new VerificationDecision();
        d.setTenantId(s.getTenantId());
        d.setSessionId(s.getId());
        d.setDecision(decision);
        d.setDecidedBy(Codes.DecidedBy.SYSTEM);
        d.setReason(truncate(reason, 1000));
        d.setFinalSimilarity(similarity != null ? BigDecimal.valueOf(similarity).setScale(6, RoundingMode.HALF_UP) : null);
        d.setDecidedAt(now);
        decisionRepository.save(d);

        s.setStatus(Codes.SessionStatus.COMPLETED);
        s.setDecision(decision);
        s.setCompletedAt(now);
        log.info("Session {} ({}) decided {}: {} (similarity={})", s.getPublicId(), s.getFlowCode(), decision,
                d.getReason(), d.getFinalSimilarity());

        if (decision == Codes.Decision.APPROVED) {
            enrollTemplates(s);
        }
        outbox.publish("SESSION", s.getPublicId(), Codes.EVENT_SESSION_COMPLETED, eventData(s));
        if (decision == Codes.Decision.REVIEW) {
            ReviewCase rc = new ReviewCase();
            rc.setTenantId(s.getTenantId());
            rc.setSessionId(s.getId());
            rc.setStatus(Codes.ReviewStatus.OPEN);
            rc.setReason(truncate(reviewReason != null ? reviewReason : reason, 200));
            rc.setFinalSimilarity(d.getFinalSimilarity());
            reviewCaseRepository.save(rc);
            ReviewAction a = new ReviewAction();
            a.setTenantId(s.getTenantId());
            a.setReviewCaseId(rc.getId());
            a.setAction(Codes.ReviewActionType.OPENED);
            a.setActor("system");
            a.setNote(rc.getReason());
            reviewActionRepository.save(a);
            Map<String, Object> data = eventData(s);
            data.put("reviewCaseId", rc.getId());
            // the event goes to the tenant: the similarity score in the reason stays internal
            data.put("reason", rc.getReason() == null ? null
                    : rc.getReason().replaceAll("\\s*\\((?:similarity|score)[^)]*\\)", "").trim());
            outbox.publish("REVIEW_CASE", String.valueOf(rc.getId()), Codes.EVENT_REVIEW_OPENED, data);
            log.info("Session {}: review case {} opened ({})", s.getPublicId(), rc.getId(), rc.getReason());
        }
        return d;
    }

    public VerificationDecision decisionOf(VerificationSession s) {
        return decisionRepository.findBySessionId(s.getId()).orElse(null);
    }

    /** Ends a session without a decision (e.g. liveness attempts used up). */
    public void fail(VerificationSession s, String reasonCode) {
        log.info("Session {} ({}) failed without a decision: {} (stage={})", s.getPublicId(), s.getFlowCode(), reasonCode, s.getStage());
        s.setStatus(Codes.SessionStatus.FAILED);
        s.setCompletedAt(Instant.now());
        Map<String, Object> data = eventData(s);
        data.put("reasonCode", reasonCode);
        outbox.publish("SESSION", s.getPublicId(), Codes.EVENT_SESSION_COMPLETED, data);
    }

    /** Registers the session's face templates for its party; does nothing unless the session asked for it. */
    public void enrollTemplates(VerificationSession s) {
        if (!s.isEnrollFace()) {
            log.debug("Session {} ({}): no face registration asked for, templates stay with the session",
                    s.getPublicId(), s.getFlowCode());
            return;
        }
        if (s.getPartyId() == null) {
            log.warn("Session {} ({}): face registration asked for but the session has no person", s.getPublicId(),
                    s.getFlowCode());
            return;
        }
        int enrolled = 0;
        for (FaceTemplate t : templateRepository.findBySessionId(s.getId())) {
            if (t.getStatus() == Codes.TemplateStatus.SESSION) {
                t.setStatus(Codes.TemplateStatus.ENROLLED);
                t.setPartyId(s.getPartyId());
                enrolled++;
            }
        }
        log.info("Session {} ({}): {} face templates registered for party {}", s.getPublicId(), s.getFlowCode(), enrolled,
                s.getPartyId());
    }

    public Map<String, Object> eventData(VerificationSession s) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sessionId", s.getPublicId());
        data.put("flow", s.getFlowCode());
        data.put("status", s.getStatus().name());
        data.put("decision", s.getDecision() != null ? s.getDecision().name() : null);
        data.put("subjectRef", s.getSubjectRef());
        data.put("documentType", s.getDocumentType());
        return data;
    }

    // ---------------------------------------------------------------- helpers

    public String json(Map<String, ?> map) {
        if (map == null || map.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            log.warn("Could not serialize check details (keys {}): {}", map.keySet(), e.toString());
            return null;
        }
    }

    public static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
