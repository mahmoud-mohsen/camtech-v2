package com.facetech.backend.controller;

import com.facetech.backend.api.ApiSupport;
import com.facetech.backend.dto.FaceTechDtos;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.verification.SelfieVerificationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Legacy Face Tech endpoints, kept with exactly the same request and
 * response so the released mobile app keeps working. They run the selfie
 * ID verification flow; new integrations use /v2/selfie-verifications.
 *
 *   POST /face-tech/sessions                      -> start, returns session_id
 *   POST /face-tech/sessions/{id}/liveness        -> normal + closer selfies
 *   POST /face-tech/sessions/{id}/verify          -> Emirates ID front or passport photo page
 *                                                    (+ OCR'd number / expiry / passport MRZ line 2)
 *
 * @deprecated use {@link com.facetech.backend.api.SelfieVerificationController}
 */
@Deprecated
@RestController
@RequestMapping("/face-tech/sessions")
public class FaceTechController {

    private final SelfieVerificationService service;

    public FaceTechController(SelfieVerificationService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<FaceTechDtos.SessionResponse> create(HttpServletRequest request) {
        SelfieVerificationService.Created created = service.create(
                new SelfieVerificationService.CreateRequest(null, null, ApiSupport.deviceInfo(request)));
        return ResponseEntity.status(HttpStatus.CREATED).body(new FaceTechDtos.SessionResponse(
                created.session().getPublicId(),
                SelfieVerificationService.legacyStatus(created.session()),
                ApiSupport.utc(created.session().getExpiresAt())));
    }

    @PostMapping("/{sessionId}/liveness")
    public ResponseEntity<FaceTechDtos.LivenessResponse> liveness(
            @PathVariable String sessionId,
            @RequestParam("normal") MultipartFile normal,
            @RequestParam("closer") MultipartFile closer,
            @RequestParam(value = "device_antispoof_score", required = false) Double deviceAntiSpoofScore) {
        SelfieVerificationService.LivenessResult r = service.submitLiveness(sessionId,
                ApiSupport.bytes(normal, "normal"), ApiSupport.bytes(closer, "closer"), deviceAntiSpoofScore);
        return ResponseEntity.ok(new FaceTechDtos.LivenessResponse(sessionId,
                SelfieVerificationService.legacyStatus(r.session()), r.samePersonSimilarity(), r.closerAreaGain()));
    }

    /**
     * {@code document} is the Emirates ID front or the passport photo page;
     * {@code id_front} is still accepted for the Emirates ID (older clients).
     */
    @PostMapping("/{sessionId}/verify")
    public ResponseEntity<FaceTechDtos.VerifyResponse> verify(
            @PathVariable String sessionId,
            @RequestParam(value = "document_type", defaultValue = "EMIRATES_ID") String documentType,
            @RequestParam(value = "document", required = false) MultipartFile document,
            @RequestParam(value = "id_front", required = false) MultipartFile idFront,
            @RequestParam(value = "id_number", required = false) String documentNumber,
            @RequestParam(value = "id_expiry", required = false) String expiry,
            @RequestParam(value = "mrz_line2", required = false) String mrzLine2) {
        MultipartFile image = document != null ? document : idFront;
        if (image == null || image.isEmpty()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "DOCUMENT_REQUIRED",
                    "Upload the document image (field 'document').");
        }
        String type = documentType.trim().toUpperCase();
        if (!type.equals("EMIRATES_ID") && !type.equals("PASSPORT")) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "BAD_DOCUMENT_TYPE",
                    "document_type must be EMIRATES_ID or PASSPORT");
        }
        SelfieVerificationService.DocumentResult r = service.submitDocument(sessionId,
                new SelfieVerificationService.DocumentInput(type, ApiSupport.bytes(image, "document"),
                        documentNumber, expiry, mrzLine2, null, null, null, null));
        return ResponseEntity.ok(new FaceTechDtos.VerifyResponse(
                sessionId, r.band().name(), r.band() == com.facetech.backend.service.FaceMatchScoring.Decision.MATCH,
                r.similarity(), r.score(), r.message(), r.attemptsRemaining(), r.grayscaleHarmonized(), r.modelVersion()));
    }
}
