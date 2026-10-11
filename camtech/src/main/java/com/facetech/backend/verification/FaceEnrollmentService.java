package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.FaceTemplateRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Face registration (FACE_ENROLLMENT) without a document: liveness selfies, then the face is registered for
 * the person ({@code subjectRef}, required) so face authentication can recognise them later. One call, one
 * attempt, always ends with a decision.
 * <ul>
 *   <li>A person who already has a registered face gets 409 FACE_ALREADY_ENROLLED (nothing is replaced: the
 *       existing face may come from an ID verification, which is stronger; erase the person to start over).</li>
 *   <li>With duplicate search on, a face that already belongs to another person goes to REVIEW
 *       (DUPLICATE_IDENTITY) and is registered only if a reviewer approves it.</li>
 * </ul>
 * The flow is always ACTIVE (a challenge is required), since no document confirms who the person is.
 */
@Service
@Slf4j
public class FaceEnrollmentService {

    public static final String FLOW = Codes.FLOW_FACE_ENROLLMENT;

    private final OneCallFlowSupport flows;
    private final SessionSupport support;
    private final LivenessEngine liveness;
    private final LivenessChallengeService challenges;
    private final DuplicateFaceSearch duplicates;
    private final EntitlementService entitlements;
    private final PartyService parties;
    private final FaceTemplateRepository templateRepository;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public FaceEnrollmentService(OneCallFlowSupport flows, SessionSupport support, LivenessEngine liveness,
                                 LivenessChallengeService challenges, DuplicateFaceSearch duplicates,
                                 EntitlementService entitlements, PartyService parties,
                                 FaceTemplateRepository templateRepository, AuditService audit,
                                 PlatformTransactionManager txManager) {
        this.flows = flows;
        this.support = support;
        this.liveness = liveness;
        this.challenges = challenges;
        this.duplicates = duplicates;
        this.entitlements = entitlements;
        this.parties = parties;
        this.templateRepository = templateRepository;
        this.audit = audit;
        this.tx = new TransactionTemplate(txManager);
    }

    /** A new active-liveness challenge for registering the face of {@code subjectRef}. */
    public LivenessChallengeService.Issued issueChallenge(String subjectRef, List<String> supportedActions) {
        String subject = requireSubject(subjectRef);
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        requireNotEnrolled(subject);
        LivenessChallengeService.Issued issued = challenges.issue(null, subject, ConfigService.Scope.of(FLOW), supportedActions);
        log.info("Face registration challenge {} issued: actions={} expiresAt={}", issued.challengeId(), issued.actions(),
                issued.expiresAt());
        log.debug("Face registration challenge {} subjectRef={}", issued.challengeId(), subject);
        return issued;
    }

    public OneCallFlowSupport.Result enroll(String subjectRef, byte[] normal, byte[] closer, Double deviceAntiSpoofScore,
                                            String challengeId, List<byte[]> challengeFrames,
                                            DeviceService.DeviceInfo device) {
        String subject = requireSubject(subjectRef);
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        requireNotEnrolled(subject);
        ConfigService.Scope scope = ConfigService.Scope.of(FLOW);
        // Before the quota is used: a missing, used or expired challenge costs nothing.
        LivenessChallengeService.Resolution resolution = challenges.resolve(challengeId, null, subject, scope);
        entitlements.consume(Codes.FeatureType.FLOW, FLOW);

        OneCallFlowSupport.Opened o = tx.execute(st -> flows.open(FLOW, parties.findOrCreatePerson(subject).getId(), subject,
                resolution.mode(), true, device));
        log.info("Face registration {} started: tenant={} mode={} challenge={} actions={}", o.publicId(),
                RequestContext.get().getTenantId(), resolution.mode(), challengeId, resolution.actions());
        log.debug("Face registration {}: subjectRef={} normal={} bytes, closer={} bytes, {} challenge frames",
                o.publicId(), subject, normal == null ? 0 : normal.length, closer == null ? 0 : closer.length,
                challengeFrames == null ? 0 : challengeFrames.size());

        List<CheckDraft> checks = new ArrayList<>();
        LivenessEngine.Outcome out;
        try {
            out = liveness.evaluate(normal, closer, deviceAntiSpoofScore, resolution, challengeFrames, scope, checks);
        } catch (FaceMatchException e) {
            log.info("Face registration {} liveness failed: {} -> REJECTED", o.publicId(), e.getCode());
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
                audit.record("FACE_ENROLLMENT_REJECTED", "verification_session", s.getPublicId(),
                        Map.of("reasonCode", e.getCode()));
                return flows.finish(s, Codes.Decision.REJECTED, e.getCode(), e.getMessage());
            });
        }

        Long partyId = tx.execute(st -> flows.session(o).getPartyId());
        DuplicateFaceSearch.Result dedup = duplicates.search(FLOW, scope, out.normal().embedding(), Set.of(partyId),
                o.publicId());

        SessionMedia.Uploads uploads = flows.uploadMedia(o, normal, closer, challengeFrames,
                Codes.MediaCategory.VERIFIED_MEDIA);
        return tx.execute(st -> {
            VerificationSession s = flows.session(o);
            VerificationStep step = support.step(o.stepId());
            MediaFile[] stored = flows.storeMedia(step, uploads, Codes.MediaCategory.VERIFIED_MEDIA);
            support.finishStep(step, Codes.StepStatus.PASSED, null, null);
            support.saveChecks(step, checks);
            flows.saveSelfieTemplate(s, stored[0], "normal", out.normal());
            if (out.closer() != null) {
                flows.saveSelfieTemplate(s, stored[1], "closer", out.closer());
            }
            s.setSelfieGrayscale(out.grayscale());
            s.setStage(Codes.Stage.LIVENESS_PASSED);

            boolean duplicate = dedup != null && dedup.duplicate();
            if (dedup != null) {
                VerificationStep d = support.startStep(s, Codes.DEDUP_SEARCH, 1);
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("bestOtherPartyId", dedup.otherPartyId());
                details.put("candidates", dedup.candidates());
                support.saveChecks(d, List.of(new CheckDraft("DEDUP_1N", dedup.bestSimilarity(), dedup.threshold(),
                        duplicate ? Codes.CheckOutcome.REVIEW : Codes.CheckOutcome.PASS, details)));
                support.finishStep(d, duplicate ? Codes.StepStatus.REVIEW : Codes.StepStatus.PASSED,
                        duplicate ? "DUPLICATE_IDENTITY" : null, null);
            }
            if (duplicate) {
                s.setStage(Codes.Stage.VERIFIED_REVIEW);
                String reviewReason = "Face matches another registered person (similarity "
                        + String.format(Locale.ROOT, "%.2f", dedup.bestSimilarity()) + ")";
                Codes.Decision decision = support.decide(s, Codes.Decision.REVIEW, "Duplicate identity", null, reviewReason)
                        .getDecision();
                audit.record("FACE_ENROLLMENT_" + decision.name(), "verification_session", s.getPublicId(),
                        Map.of("reasonCode", "DUPLICATE_IDENTITY"));
                log.info("Face registration {} result: {} (face matches another registered person)", s.getPublicId(), decision);
                return flows.finish(s, decision, "DUPLICATE_IDENTITY",
                        decision == Codes.Decision.REVIEW ? "Your registration is being reviewed." : "The face could not be registered.");
            }
            s.setStage(Codes.Stage.VERIFIED_MATCH);
            support.decide(s, Codes.Decision.APPROVED, "Face registered", null, null);
            audit.record("FACE_ENROLLMENT_APPROVED", "verification_session", s.getPublicId(), null);
            log.info("Face registration {} result: APPROVED ({} templates)", s.getPublicId(),
                    templateRepository.findBySessionId(s.getId()).size());
            return flows.finish(s, Codes.Decision.APPROVED, null, "Face registered.");
        });
    }

    private static String requireSubject(String subjectRef) {
        if (subjectRef == null || subjectRef.isBlank()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "subjectRef is required");
        }
        return subjectRef.trim();
    }

    /** Throws 409 FACE_ALREADY_ENROLLED when the person already has a registered face. */
    private void requireNotEnrolled(String subjectRef) {
        Party party = parties.findByExternalRef(subjectRef).orElse(null);
        if (party != null && !templateRepository.findByPartyIdAndStatusAndRole(
                party.getId(), Codes.TemplateStatus.ENROLLED, Codes.TemplateRole.SELFIE).isEmpty()) {
            log.debug("Face registration refused: person {} already has a registered face", party.getPublicId());
            throw new FaceMatchException(HttpStatus.CONFLICT, "FACE_ALREADY_ENROLLED",
                    "A face is already registered for this person.");
        }
    }
}
