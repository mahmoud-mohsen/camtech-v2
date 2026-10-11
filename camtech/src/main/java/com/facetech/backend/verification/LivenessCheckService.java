package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.RequestContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Liveness check (LIVENESS_CHECK): proves a real person is in front of the camera. Liveness selfies
 * only, no document and no face registered. One call, one attempt, always ends with a decision:
 * APPROVED (liveness passed) or REJECTED. {@code subjectRef} is optional; when given it is kept with the
 * session and put in the result token.
 */
@Service
@Slf4j
public class LivenessCheckService {

    public static final String FLOW = Codes.FLOW_LIVENESS_CHECK;

    private final OneCallFlowSupport flows;
    private final SessionSupport support;
    private final LivenessEngine liveness;
    private final LivenessChallengeService challenges;
    private final EntitlementService entitlements;
    private final PartyService parties;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public LivenessCheckService(OneCallFlowSupport flows, SessionSupport support, LivenessEngine liveness,
                                LivenessChallengeService challenges, EntitlementService entitlements,
                                PartyService parties, AuditService audit, PlatformTransactionManager txManager) {
        this.flows = flows;
        this.support = support;
        this.liveness = liveness;
        this.challenges = challenges;
        this.entitlements = entitlements;
        this.parties = parties;
        this.audit = audit;
        this.tx = new TransactionTemplate(txManager);
    }

    /** A new active-liveness challenge for a liveness check ({@code subjectRef} may be null). */
    public LivenessChallengeService.Issued issueChallenge(String subjectRef, List<String> supportedActions) {
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        LivenessChallengeService.Issued issued = challenges.issue(null, blankToNull(subjectRef),
                ConfigService.Scope.of(FLOW), supportedActions);
        log.info("Liveness check challenge {} issued: actions={} expiresAt={}", issued.challengeId(),
                issued.actions(), issued.expiresAt());
        return issued;
    }

    public OneCallFlowSupport.Result check(String subjectRef, byte[] normal, byte[] closer, Double deviceAntiSpoofScore,
                                           String challengeId, List<byte[]> challengeFrames,
                                           DeviceService.DeviceInfo device) {
        String subject = blankToNull(subjectRef);
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        ConfigService.Scope scope = ConfigService.Scope.of(FLOW);
        // Before the quota is used: a missing, used or expired challenge costs nothing.
        LivenessChallengeService.Resolution resolution = challenges.resolve(challengeId, null, subject, scope);
        entitlements.consume(Codes.FeatureType.FLOW, FLOW);

        OneCallFlowSupport.Opened o = tx.execute(st -> flows.open(FLOW,
                parties.findByExternalRef(subject).map(Party::getId).orElse(null), subject, resolution.mode(), false, device));
        log.info("Liveness check {} started: tenant={} mode={} challenge={} actions={}", o.publicId(),
                RequestContext.get().getTenantId(), resolution.mode(), challengeId, resolution.actions());
        log.debug("Liveness check {}: subjectRef={} normal={} bytes, closer={} bytes, {} challenge frames",
                o.publicId(), subject, normal == null ? 0 : normal.length, closer == null ? 0 : closer.length,
                challengeFrames == null ? 0 : challengeFrames.size());

        List<CheckDraft> checks = new ArrayList<>();
        try {
            liveness.evaluate(normal, closer, deviceAntiSpoofScore, resolution, challengeFrames, scope, checks);
        } catch (FaceMatchException e) {
            log.info("Liveness check {} liveness failed: {} -> REJECTED", o.publicId(), e.getCode());
            SessionMedia.Uploads failed = flows.uploadMedia(o, normal, closer, challengeFrames,
                    Codes.MediaCategory.FAILED_ATTEMPT_MEDIA);
            return tx.execute(st -> {
                VerificationSession s = flows.session(o);
                VerificationStep step = support.step(o.stepId());
                support.finishStep(step, Codes.StepStatus.FAILED, e.getCode(), e.getMessage());
                support.saveChecks(step, checks);
                flows.storeMedia(step, failed, Codes.MediaCategory.FAILED_ATTEMPT_MEDIA);
                s.setStage(Codes.Stage.LIVENESS_FAILED);
                support.decide(s, Codes.Decision.REJECTED, "Liveness failed: " + e.getCode(), null, null);
                audit.record("LIVENESS_CHECK_REJECTED", "verification_session", s.getPublicId(),
                        Map.of("reasonCode", e.getCode()));
                return flows.finish(s, Codes.Decision.REJECTED, e.getCode(), e.getMessage());
            });
        }

        SessionMedia.Uploads uploads = flows.uploadMedia(o, normal, closer, challengeFrames,
                Codes.MediaCategory.VERIFIED_MEDIA);
        return tx.execute(st -> {
            VerificationSession s = flows.session(o);
            VerificationStep step = support.step(o.stepId());
            flows.storeMedia(step, uploads, Codes.MediaCategory.VERIFIED_MEDIA);
            support.finishStep(step, Codes.StepStatus.PASSED, null, null);
            support.saveChecks(step, checks);
            s.setStage(Codes.Stage.LIVENESS_PASSED);
            support.decide(s, Codes.Decision.APPROVED, "Liveness passed", null, null);
            audit.record("LIVENESS_CHECK_APPROVED", "verification_session", s.getPublicId(), null);
            log.info("Liveness check {} result: APPROVED", s.getPublicId());
            return flows.finish(s, Codes.Decision.APPROVED, null, "Liveness confirmed.");
        });
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
