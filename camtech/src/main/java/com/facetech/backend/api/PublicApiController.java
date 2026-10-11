package com.facetech.backend.api;

import com.facetech.backend.domain.RefReasonCode;
import com.facetech.backend.platform.CapabilitiesService;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.ResultTokenService;
import com.facetech.backend.repository.RefReasonCodeRepository;
import com.facetech.backend.verification.FaceAuthenticationService;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Capabilities, face authentication, messages and the result-token public key. */
@RestController
public class PublicApiController {

    private final CapabilitiesService capabilities;
    private final FaceAuthenticationService faceAuthentication;
    private final RefReasonCodeRepository reasonCodes;
    private final ResultTokenService resultTokens;

    public PublicApiController(CapabilitiesService capabilities, FaceAuthenticationService faceAuthentication,
                               RefReasonCodeRepository reasonCodes, ResultTokenService resultTokens) {
        this.capabilities = capabilities;
        this.faceAuthentication = faceAuthentication;
        this.reasonCodes = reasonCodes;
        this.resultTokens = resultTokens;
    }

    /** What the calling app may use. Send If-None-Match with the last ETag to get 304 when nothing changed. */
    @GetMapping("/v2/capabilities")
    public ResponseEntity<Map<String, Object>> capabilities(
            @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch) {
        Map<String, Object> caps = capabilities.forApp(RequestContext.get().getClientApp());
        String etag = capabilities.etag(caps);
        if (etag.equals(ifNoneMatch)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag).build();
        }
        return ResponseEntity.ok().eTag(etag).cacheControl(CacheControl.noCache()).body(caps);
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record FaceAuthResponse(String sessionId, String decision, String reasonCode, String message,
                                   String resultToken, Instant resultTokenExpiresAt) {
    }

    @PostMapping("/v2/face-authentications")
    public FaceAuthResponse faceAuthentication(@RequestParam(value = "subjectRef", required = false) String subjectRef,
                                               @RequestParam("normal") MultipartFile normal,
                                               @RequestParam(value = "closer", required = false) MultipartFile closer,
                                               @RequestParam(value = "deviceAntispoofScore", required = false) Double deviceAntispoofScore,
                                               @RequestParam(value = "challengeId", required = false) String challengeId,
                                               @RequestParam(value = "challengeFrames", required = false) List<MultipartFile> challengeFrames,
                                               HttpServletRequest request) {
        String subject = RequestContext.get().subjectRefFor(subjectRef);
        if (subject == null || subject.isBlank()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "subjectRef is required");
        }
        FaceAuthenticationService.Result r = faceAuthentication.authenticate(subject,
                ApiSupport.bytes(normal, "normal"), ApiSupport.optionalBytes(closer, "closer"), deviceAntispoofScore,
                challengeId, ApiSupport.frames(challengeFrames),
                ApiSupport.deviceInfo(request));
        return new FaceAuthResponse(r.session().getPublicId(), r.decision().name(), r.reasonCode(), r.message(),
                r.resultToken(), r.resultTokenExpiresAt());
    }

    public record ReasonMessage(String code, String category, String message) {
    }

    /** Every reason code with its message in the requested language (Accept-Language: ar for Arabic). */
    @GetMapping("/v2/reason-codes")
    public ResponseEntity<List<ReasonMessage>> reasonCodes() {
        boolean arabic = "ar".equals(RequestContext.get().getLang());
        List<ReasonMessage> out = reasonCodes.findAllByOrderByCategoryAscCodeAsc().stream()
                .map((RefReasonCode r) -> new ReasonMessage(r.getCode(), r.getCategory(),
                        arabic && r.getMessageAr() != null ? r.getMessageAr() : r.getMessageEn()))
                .toList();
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS)).body(out);
    }

    /** Public key(s) for checking result tokens. */
    @GetMapping("/v2/.well-known/jwks.json")
    public ResponseEntity<Map<String, Object>> jwks() {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS)).body(resultTokens.jwks());
    }
}
