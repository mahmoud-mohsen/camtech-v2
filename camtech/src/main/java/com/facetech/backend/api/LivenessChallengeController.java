package com.facetech.backend.api;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.verification.FaceAuthenticationService;
import com.facetech.backend.verification.FaceEnrollmentService;
import com.facetech.backend.verification.LivenessCheckService;
import com.facetech.backend.verification.LivenessChallengeService;
import com.facetech.backend.verification.SelfieVerificationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/**
 * Active liveness: a random challenge (turn the head, look up or down, blink, smile) asked for just
 * before the selfies. The frames the user records while doing it are sent with the
 * liveness upload ({@code challengeId} + {@code challengeFrames}) and checked on the server.
 */
@RestController
public class LivenessChallengeController {

    private final SelfieVerificationService selfie;
    private final FaceAuthenticationService faceAuth;
    private final LivenessCheckService livenessCheck;
    private final FaceEnrollmentService faceEnrollment;

    public LivenessChallengeController(SelfieVerificationService selfie, FaceAuthenticationService faceAuth,
                                       LivenessCheckService livenessCheck, FaceEnrollmentService faceEnrollment) {
        this.selfie = selfie;
        this.faceAuth = faceAuth;
        this.livenessCheck = livenessCheck;
        this.faceEnrollment = faceEnrollment;
    }

    /**
     * {@code sessionId} for a selfie ID verification; otherwise {@code flow} (FACE_AUTHENTICATION when omitted,
     * FACE_ENROLLMENT, LIVENESS_CHECK) with the {@code subjectRef} (optional for LIVENESS_CHECK).
     * {@code supportedActions}: the challenges the client can show; omitted = TURN_LEFT, TURN_RIGHT, BLINK.
     */
    public record ChallengeRequest(String sessionId, String subjectRef, String flow, List<String> supportedActions) {
    }

    public record ChallengeResponse(String challengeId, List<String> actions, Instant expiresAt) {
    }

    @PostMapping("/v2/liveness-challenges")
    public ResponseEntity<ChallengeResponse> create(@RequestBody(required = false) ChallengeRequest body) {
        String sessionId = body != null && body.sessionId() != null && !body.sessionId().isBlank() ? body.sessionId().trim() : null;
        List<String> supported = body != null ? body.supportedActions() : null;
        LivenessChallengeService.Issued issued;
        if (sessionId != null) {
            issued = selfie.issueChallenge(sessionId, supported);
        } else {
            String subject = RequestContext.get().subjectRefFor(body != null ? body.subjectRef() : null);
            String flow = body != null && body.flow() != null && !body.flow().isBlank()
                    ? body.flow().trim().toUpperCase(java.util.Locale.ROOT) : Codes.FLOW_FACE_AUTH;
            issued = switch (flow) {
                case Codes.FLOW_FACE_AUTH -> faceAuth.issueChallenge(subject, supported);
                case Codes.FLOW_FACE_ENROLLMENT -> faceEnrollment.issueChallenge(subject, supported);
                case Codes.FLOW_LIVENESS_CHECK -> livenessCheck.issueChallenge(subject, supported);
                default -> throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                        "flow must be FACE_AUTHENTICATION, FACE_ENROLLMENT or LIVENESS_CHECK (or send sessionId)");
            };
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new ChallengeResponse(issued.challengeId(), issued.actions(), issued.expiresAt()));
    }
}
