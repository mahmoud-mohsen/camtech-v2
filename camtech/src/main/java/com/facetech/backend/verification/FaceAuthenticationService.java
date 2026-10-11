package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.VerificationDecision;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EmbeddingCodec;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.ResultTokenService;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Face authentication for a returning person: liveness selfies (the closer one optional) matched
 * against the face registered by an earlier face registration or selfie ID verification
 * (FACE_TEMPLATE_MATCH). One call, one attempt, always ends with a decision.
 */
@Service
@Slf4j
public class FaceAuthenticationService {

    public static final String FLOW = Codes.FLOW_FACE_AUTH;

    private final VerificationSessionRepository sessionRepository;
    private final FaceTemplateRepository templateRepository;
    private final SessionSupport support;
    private final LivenessEngine liveness;
    private final LivenessChallengeService challenges;
    private final ConfigService config;
    private final EntitlementService entitlements;
    private final SessionMedia sessionMedia;
    private final PartyService parties;
    private final DeviceService devices;
    private final AuditService audit;
    private final ResultTokenService resultTokens;
    private final TransactionTemplate tx;

    public FaceAuthenticationService(VerificationSessionRepository sessionRepository,
                                     FaceTemplateRepository templateRepository, SessionSupport support,
                                     LivenessEngine liveness, LivenessChallengeService challenges,
                                     ConfigService config, EntitlementService entitlements,
                                     SessionMedia sessionMedia, PartyService parties, DeviceService devices,
                                     AuditService audit, ResultTokenService resultTokens,
                                     PlatformTransactionManager txManager) {
        this.sessionRepository = sessionRepository;
        this.templateRepository = templateRepository;
        this.support = support;
        this.liveness = liveness;
        this.challenges = challenges;
        this.config = config;
        this.entitlements = entitlements;
        this.sessionMedia = sessionMedia;
        this.parties = parties;
        this.devices = devices;
        this.audit = audit;
        this.resultTokens = resultTokens;
        this.tx = new TransactionTemplate(txManager);
    }

    public record Result(VerificationSession session, Codes.Decision decision, Double similarity, String reasonCode,
                         String message, String resultToken, Instant resultTokenExpiresAt) {
    }

    private record Prep(Long sessionId, String publicId, Instant created, Long stepId, List<FaceTemplate> enrolled) {
    }

    public Result authenticate(String subjectRef, byte[] normal, byte[] closer, Double deviceAntiSpoofScore,
                               DeviceService.DeviceInfo device) {
        return authenticate(subjectRef, normal, closer, deviceAntiSpoofScore, null, List.of(), device);
    }

    /** A new active-liveness challenge for a face authentication of {@code subjectRef}. */
    public LivenessChallengeService.Issued issueChallenge(String subjectRef) {
        return issueChallenge(subjectRef, null);
    }

    /** As above, drawn from the actions the client supports (null = the original three). */
    public LivenessChallengeService.Issued issueChallenge(String subjectRef, List<String> supportedActions) {
        if (subjectRef == null || subjectRef.isBlank()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "subjectRef is required");
        }
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        LivenessChallengeService.Issued issued = challenges.issue(null, subjectRef, ConfigService.Scope.of(FLOW),
                supportedActions);
        log.info("Face authentication challenge {} issued: actions={} expiresAt={}",
                issued.challengeId(), issued.actions(), issued.expiresAt());
        log.debug("Face authentication challenge {} subjectRef={}", issued.challengeId(), subjectRef);
        return issued;
    }

    /** Face authentication with an optional active challenge (issued for this subjectRef). */
    public Result authenticate(String subjectRef, byte[] normal, byte[] closer, Double deviceAntiSpoofScore,
                               String challengeId, List<byte[]> challengeFrames,
                               DeviceService.DeviceInfo device) {
        if (subjectRef == null || subjectRef.isBlank()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "subjectRef is required");
        }
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        Party party = parties.findByExternalRef(subjectRef).orElse(null);
        if (party == null) {
            log.debug("Face authentication: no person on file for subjectRef {}", subjectRef);
            throw noEnrolledFace();
        }
        List<FaceTemplate> enrolled = templateRepository.findByPartyIdAndStatusAndRole(
                party.getId(), Codes.TemplateStatus.ENROLLED, Codes.TemplateRole.SELFIE);
        if (enrolled.isEmpty()) {
            log.debug("Face authentication: person {} has no enrolled selfie template", party.getPublicId());
            throw noEnrolledFace();
        }
        ConfigService.Scope scope = ConfigService.Scope.of(FLOW);
        // Before the quota is used: a missing, used or expired challenge costs nothing.
        LivenessChallengeService.Resolution resolution = challenges.resolve(challengeId, null, subjectRef, scope);
        entitlements.consume(Codes.FeatureType.FLOW, FLOW);

        Prep p = tx.execute(st -> {
            RequestContext ctx = RequestContext.get();
            VerificationSession s = new VerificationSession();
            s.setTenantId(ctx.getTenantId());
            s.setPublicId(UUID.randomUUID().toString());
            s.setFlowCode(FLOW);
            s.setPartyId(party.getId());
            s.setClientAppId(ctx.getClientApp().getId());
            s.setChannel(ctx.getClientApp().getChannel());
            s.setSubjectRef(subjectRef);
            s.setStatus(Codes.SessionStatus.IN_PROGRESS);
            s.setStage(Codes.Stage.CREATED);
            s.setLivenessMode(resolution.mode());
            s.setIpAddress(ctx.getIpAddress());
            s.setUserAgent(ctx.getUserAgent());
            s.setExpiresAt(Instant.now().plusSeconds(
                    config.getInt(ConfigKey.SESSION_TTL_MINUTES, scope, 15) * 60L));
            s.setDeviceId(devices.upsert(ctx.getClientApp(), device));
            sessionRepository.save(s);
            VerificationStep step = support.startStep(s, Codes.LIVENESS, 1);
            return new Prep(s.getId(), s.getPublicId(), s.getCreatedAt(), step.getId(), enrolled);
        });
        log.info("Face authentication {} started: person={} tenant={} enrolledTemplates={} mode={} challenge={} actions={}",
                p.publicId(), party.getPublicId(), RequestContext.get().getTenantId(), enrolled.size(), resolution.mode(),
                challengeId, resolution.actions());
        log.debug("Face authentication {}: subjectRef={} normal={} bytes, closer={} bytes, {} challenge frames",
                p.publicId(), subjectRef, normal == null ? 0 : normal.length, closer == null ? 0 : closer.length,
                challengeFrames == null ? 0 : challengeFrames.size());

        List<CheckDraft> checks = new ArrayList<>();
        LivenessEngine.Outcome out;
        try {
            out = liveness.evaluate(normal, closer, deviceAntiSpoofScore, resolution, challengeFrames, scope, checks);
        } catch (FaceMatchException e) {
            log.info("Face authentication {} liveness failed: {} -> REJECTED", p.publicId(), e.getCode());
            SessionMedia.Uploads failed = sessionMedia.upload(FLOW, p.created(), p.publicId(), 1, normal, closer,
                    null, Codes.MediaCategory.FAILED_ATTEMPT_MEDIA);
            return tx.execute(st -> {
                VerificationSession s = sessionRepository.findById(p.sessionId()).orElseThrow();
                VerificationStep step = support.step(p.stepId());
                support.finishStep(step, Codes.StepStatus.FAILED, e.getCode(), e.getMessage());
                support.saveChecks(step, checks);
                sessionMedia.save(step, failed, Codes.MediaCategory.FAILED_ATTEMPT_MEDIA);
                s.setStage(Codes.Stage.LIVENESS_FAILED);
                support.decide(s, Codes.Decision.REJECTED, "Liveness failed: " + e.getCode(), null, null);
                audit.record("FACE_AUTH_REJECTED", "verification_session", s.getPublicId(), Map.of("reasonCode", e.getCode()));
                return finish(s, Codes.Decision.REJECTED, null, e.getCode(), e.getMessage());
            });
        }

        double threshold = config.getDouble(ConfigKey.FACE_TEMPLATE_MATCH_SIMILARITY, scope);
        double best = -2;
        Long bestTemplate = null;
        int compared = 0;
        for (FaceTemplate t : p.enrolled()) {
            if (t.getDimension() != out.normal().embedding().size()) {
                log.debug("Face authentication {}: template {} skipped (dimension {} vs {}, model {})", p.publicId(),
                        t.getId(), t.getDimension(), out.normal().embedding().size(), t.getModelVersion());
                continue;
            }
            compared++;
            List<Double> stored = EmbeddingCodec.decode(t.getVector());
            double sim = EmbeddingCodec.cosine(out.normal().embedding(), stored);
            if (out.closer() != null) {
                sim = Math.max(sim, EmbeddingCodec.cosine(out.closer().embedding(), stored));
            }
            if (sim > best) {
                best = sim;
                bestTemplate = t.getId();
            }
        }
        final double similarity = best;
        final Long matchedTemplate = bestTemplate;
        boolean match = matchedTemplate != null && similarity >= threshold;
        log.debug("Face authentication {}: compared {} of {} templates, best={} template={} threshold={}",
                p.publicId(), compared, p.enrolled().size(),
                matchedTemplate != null ? String.format(java.util.Locale.ROOT, "%.3f", similarity) : null,
                matchedTemplate, LivenessEngine.fmt(threshold));
        if (matchedTemplate == null) {
            log.warn("Face authentication {}: no enrolled template has the current model's dimension {}",
                    p.publicId(), out.normal().embedding().size());
        }

        Codes.MediaCategory category = match ? Codes.MediaCategory.VERIFIED_MEDIA : Codes.MediaCategory.FAILED_ATTEMPT_MEDIA;
        SessionMedia.Uploads uploads = sessionMedia.upload(FLOW, p.created(), p.publicId(), 1, normal, closer, null,
                category);
        return tx.execute(st -> {
            VerificationSession s = sessionRepository.findById(p.sessionId()).orElseThrow();
            VerificationStep step = support.step(p.stepId());
            sessionMedia.save(step, uploads, category);
            support.finishStep(step, Codes.StepStatus.PASSED, null, null);
            support.saveChecks(step, checks);
            s.setStage(Codes.Stage.LIVENESS_PASSED);
            VerificationStep m = support.startStep(s, Codes.FACE_TEMPLATE_MATCH, 1);
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("templateId", matchedTemplate);
            details.put("templatesCompared", p.enrolled().size());
            support.saveChecks(m, List.of(new CheckDraft("SELFIE_VS_ENROLLED_FACE",
                    matchedTemplate != null ? similarity : null, LivenessEngine.fmt(threshold),
                    match ? Codes.CheckOutcome.PASS : Codes.CheckOutcome.FAIL, details)));
            support.finishStep(m, match ? Codes.StepStatus.PASSED : Codes.StepStatus.FAILED, match ? null : "FACE_MISMATCH", null);
            s.setStage(match ? Codes.Stage.VERIFIED_MATCH : Codes.Stage.VERIFIED_NO_MATCH);
            Codes.Decision decision = match ? Codes.Decision.APPROVED : Codes.Decision.REJECTED;
            support.decide(s, decision, match ? "Face matches the enrolled face" : "Face does not match the enrolled face",
                    matchedTemplate != null ? similarity : null, null);
            audit.record(match ? "FACE_AUTH_APPROVED" : "FACE_AUTH_REJECTED", "verification_session", s.getPublicId(), null);
            log.info("Face authentication {} result: {} (similarity={} threshold={} reasonCode={})", s.getPublicId(), decision,
                    matchedTemplate != null ? String.format(java.util.Locale.ROOT, "%.3f", similarity) : null,
                    LivenessEngine.fmt(threshold), match ? null : "FACE_MISMATCH");
            return finish(s, decision, matchedTemplate != null ? similarity : null, match ? null : "FACE_MISMATCH",
                    match ? "Face recognised." : "The face does not match the registered face.");
        });
    }

    private Result finish(VerificationSession s, Codes.Decision decision, Double similarity, String reasonCode, String message) {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", s.getSubjectRef());
        claims.put("sid", s.getPublicId());
        claims.put("flow", FLOW);
        claims.put("decision", decision.name());
        ResultTokenService.Issued token = resultTokens.issue(claims);
        VerificationDecision d = support.decisionOf(s);
        if (d != null) {
            d.setResultTokenJti(token.jti());
        }
        return new Result(s, decision, similarity, reasonCode, message, token.token(), token.expiresAt());
    }

    private static FaceMatchException noEnrolledFace() {
        return new FaceMatchException(HttpStatus.NOT_FOUND, "NO_ENROLLED_FACE",
                "No registered face was found for this person. Register the face first.");
    }
}
