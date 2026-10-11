package com.facetech.backend.api;

import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.verification.SelfieVerificationService;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.servlet.http.HttpServletRequest;
import com.facetech.backend.platform.RequestContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.List;

/**
 * Selfie ID verification for mobile and web apps: start, liveness selfies,
 * identity document, then the result. Every response says what the app
 * should do next ({@code nextStep}: LIVENESS, DOCUMENT or DONE).
 * See docs/integration-guide.md.
 */
@Slf4j
@RestController
@RequestMapping("/v2/selfie-verifications")
public class SelfieVerificationController {

    private final SelfieVerificationService service;

    public SelfieVerificationController(SelfieVerificationService service) {
        this.service = service;
    }

    /**
     * {@code enrollFace}: register the face when approved (needs FACE_ENROLLMENT); false = verify only;
     * omitted = register when the app may.
     */
    public record StartRequest(String subjectRef, String documentType, Boolean enrollFace) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record StartResponse(String sessionId, String sessionToken, String flow, String status,
                                Instant expiresAt, String nextStep, boolean enrollFace) {
    }

    public record LivenessResponse(String sessionId, String step, String result, String status,
                                   int attemptsRemaining, String nextStep) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record DocumentResponse(String sessionId, String step, String result, String status, String decision,
                                   int attemptsRemaining, String nextStep, String reasonCode, String message) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record StateResponse(String sessionId, String flow, String status, String decision, String documentType,
                                Instant expiresAt, String nextStep, List<SelfieVerificationService.StepView> steps) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ResultResponse(String sessionId, String status, String decision, Instant decidedAt,
                                 String resultToken, Instant resultTokenExpiresAt) {
    }

    @PostMapping
    public ResponseEntity<StartResponse> start(@RequestBody(required = false) StartRequest body,
                                               HttpServletRequest request) {
        SelfieVerificationService.Created created = service.create(new SelfieVerificationService.CreateRequest(
                RequestContext.get().subjectRefFor(body != null ? body.subjectRef() : null),
                body != null ? body.documentType() : null,
                ApiSupport.deviceInfo(request),
                body != null ? body.enrollFace() : null));
        VerificationSession s = created.session();
        return ResponseEntity.status(HttpStatus.CREATED).body(new StartResponse(s.getPublicId(), created.sessionToken(),
                s.getFlowCode(), s.getStatus().name(), s.getExpiresAt(), "LIVENESS", s.isEnrollFace()));
    }

    @PostMapping("/{sessionId}/liveness")
    public LivenessResponse liveness(@PathVariable String sessionId,
                                     @RequestParam("normal") MultipartFile normal,
                                     @RequestParam(value = "closer", required = false) MultipartFile closer,
                                     @RequestParam(value = "deviceAntispoofScore", required = false) Double deviceAntispoofScore,
                                     @RequestParam(value = "challengeId", required = false) String challengeId,
                                     @RequestParam(value = "challengeFrames", required = false) List<MultipartFile> challengeFrames) {
        SelfieVerificationService.LivenessResult r = service.submitLiveness(sessionId,
                ApiSupport.bytes(normal, "normal"), ApiSupport.optionalBytes(closer, "closer"), deviceAntispoofScore,
                challengeId, ApiSupport.frames(challengeFrames));
        return new LivenessResponse(sessionId, "LIVENESS", "PASSED", r.session().getStatus().name(),
                r.attemptsRemaining(), "DOCUMENT");
    }

    @PostMapping("/{sessionId}/document")
    public DocumentResponse document(@PathVariable String sessionId,
                                     @RequestParam("documentType") String documentType,
                                     @RequestParam("document") MultipartFile document,
                                     @RequestParam(value = "documentBack", required = false) MultipartFile documentBack,
                                     @RequestParam(value = "documentNumber", required = false) String documentNumber,
                                     @RequestParam(value = "expiryDate", required = false) String expiryDate,
                                     @RequestParam(value = "mrzLine2", required = false) String mrzLine2,
                                     @RequestParam(value = "fullName", required = false) String fullName,
                                     @RequestParam(value = "dateOfBirth", required = false) String dateOfBirth,
                                     @RequestParam(value = "issuingCountry", required = false) String issuingCountry) {
        log.debug("Document upload for session {}: documentType={} client-supplied fields: documentNumber={} "
                        + "expiryDate={} mrzLine2={} fullName={} dateOfBirth={} issuingCountry={}", sessionId, documentType,
                documentNumber != null, expiryDate != null, mrzLine2 != null, fullName != null, dateOfBirth != null,
                issuingCountry != null);
        SelfieVerificationService.DocumentResult r = service.submitDocument(sessionId,
                new SelfieVerificationService.DocumentInput(documentType, ApiSupport.bytes(document, "document"),
                        documentNumber, expiryDate, mrzLine2, fullName, dateOfBirth, issuingCountry,
                        documentBack == null || documentBack.isEmpty() ? null : ApiSupport.bytes(documentBack, "documentBack")));
        VerificationSession s = r.session();
        return new DocumentResponse(sessionId, "DOCUMENT", r.band().name(), s.getStatus().name(),
                s.getDecision() != null ? s.getDecision().name() : null, r.attemptsRemaining(),
                SelfieVerificationService.nextStep(s), r.reasonCode(), r.message());
    }

    @GetMapping("/{sessionId}")
    public StateResponse state(@PathVariable String sessionId) {
        SelfieVerificationService.SessionView v = service.view(sessionId);
        VerificationSession s = v.session();
        return new StateResponse(s.getPublicId(), s.getFlowCode(), s.getStatus().name(),
                s.getDecision() != null ? s.getDecision().name() : null, s.getDocumentType(), s.getExpiresAt(),
                v.nextStep(), v.steps());
    }

    @GetMapping("/{sessionId}/result")
    public ResultResponse result(@PathVariable String sessionId) {
        SelfieVerificationService.ResultView r = service.result(sessionId);
        VerificationSession s = r.session();
        return new ResultResponse(s.getPublicId(), s.getStatus().name(),
                r.decision() != null ? r.decision().getDecision().name() : null,
                r.decision() != null ? r.decision().getDecidedAt() : null,
                r.resultToken(), r.resultTokenExpiresAt());
    }

    @PostMapping("/{sessionId}/cancel")
    public StateResponse cancel(@PathVariable String sessionId) {
        service.cancel(sessionId);
        return state(sessionId);
    }
}
