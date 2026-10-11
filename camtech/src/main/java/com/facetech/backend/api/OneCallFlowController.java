package com.facetech.backend.api;

import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.verification.FaceEnrollmentService;
import com.facetech.backend.verification.LivenessCheckService;
import com.facetech.backend.verification.OneCallFlowSupport;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.List;

/**
 * The selfie-only flows, each one multipart call (like face authentication): the liveness selfies plus the
 * frames of a challenge from {@code POST /v2/liveness-challenges} with the matching {@code flow}.
 * <ul>
 *   <li>{@code POST /v2/liveness-checks}: liveness check, a real person is in front of the camera.</li>
 *   <li>{@code POST /v2/face-enrollments}: face registration for {@code subjectRef}, no document.</li>
 * </ul>
 */
@RestController
public class OneCallFlowController {

    private final LivenessCheckService livenessChecks;
    private final FaceEnrollmentService faceEnrollments;

    public OneCallFlowController(LivenessCheckService livenessChecks, FaceEnrollmentService faceEnrollments) {
        this.livenessChecks = livenessChecks;
        this.faceEnrollments = faceEnrollments;
    }

    /** Same shape as the face authentication response. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record OneCallResponse(String sessionId, String decision, String reasonCode, String message,
                                  String resultToken, Instant resultTokenExpiresAt) {
        static OneCallResponse of(OneCallFlowSupport.Result r) {
            return new OneCallResponse(r.session().getPublicId(), r.decision().name(), r.reasonCode(), r.message(),
                    r.resultToken(), r.resultTokenExpiresAt());
        }
    }

    @PostMapping("/v2/liveness-checks")
    public OneCallResponse livenessCheck(@RequestParam(value = "subjectRef", required = false) String subjectRef,
                                         @RequestParam("normal") MultipartFile normal,
                                         @RequestParam(value = "closer", required = false) MultipartFile closer,
                                         @RequestParam(value = "deviceAntispoofScore", required = false) Double deviceAntispoofScore,
                                         @RequestParam(value = "challengeId", required = false) String challengeId,
                                         @RequestParam(value = "challengeFrames", required = false) List<MultipartFile> challengeFrames,
                                         HttpServletRequest request) {
        return OneCallResponse.of(livenessChecks.check(RequestContext.get().subjectRefFor(subjectRef),
                ApiSupport.bytes(normal, "normal"), ApiSupport.optionalBytes(closer, "closer"), deviceAntispoofScore,
                challengeId, ApiSupport.frames(challengeFrames), ApiSupport.deviceInfo(request)));
    }

    @PostMapping("/v2/face-enrollments")
    public OneCallResponse faceEnrollment(@RequestParam(value = "subjectRef", required = false) String subjectRef,
                                          @RequestParam("normal") MultipartFile normal,
                                          @RequestParam(value = "closer", required = false) MultipartFile closer,
                                          @RequestParam(value = "deviceAntispoofScore", required = false) Double deviceAntispoofScore,
                                          @RequestParam(value = "challengeId", required = false) String challengeId,
                                          @RequestParam(value = "challengeFrames", required = false) List<MultipartFile> challengeFrames,
                                          HttpServletRequest request) {
        return OneCallResponse.of(faceEnrollments.enroll(RequestContext.get().subjectRefFor(subjectRef),
                ApiSupport.bytes(normal, "normal"), ApiSupport.optionalBytes(closer, "closer"), deviceAntispoofScore,
                challengeId, ApiSupport.frames(challengeFrames), ApiSupport.deviceInfo(request)));
    }
}
