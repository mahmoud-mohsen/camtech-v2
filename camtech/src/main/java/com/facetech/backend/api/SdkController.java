package com.facetech.backend.api;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.BrandingService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.SdkTokenService;
import com.facetech.backend.platform.TenantService;
import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.concurrent.TimeUnit;

/** What the web SDK needs besides the flows: an SDK token (asked for by the app's backend) and the tenant's branding. */
@RestController
public class SdkController {

    private final SdkTokenService sdkTokens;
    private final BrandingService branding;
    private final TenantService tenantService;

    public SdkController(SdkTokenService sdkTokens, BrandingService branding, TenantService tenantService) {
        this.sdkTokens = sdkTokens;
        this.branding = branding;
        this.tenantService = tenantService;
    }

    public record SdkTokenRequest(String subjectRef, Integer ttlMinutes) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record SdkTokenResponse(String sdkToken, Instant expiresAt, String tenantCode, String clientAppCode,
                                   String subjectRef) {
    }

    /**
     * Called by the app's backend with its client credentials, never from a browser. The token lets the
     * SDK run the end-user flows for this app; with subjectRef it only works for that user.
     */
    @PostMapping("/v2/sdk-tokens")
    public ResponseEntity<SdkTokenResponse> create(@RequestBody(required = false) SdkTokenRequest body) {
        RequestContext ctx = RequestContext.get();
        if (!ctx.isCredentialed() || ctx.isSdkToken()) {
            throw new FaceMatchException(HttpStatus.UNAUTHORIZED, "CLIENT_AUTH_REQUIRED",
                    "Ask for SDK tokens from your backend with X-Client-Id and X-Client-Secret");
        }
        String subjectRef = body != null && body.subjectRef() != null && !body.subjectRef().isBlank()
                ? body.subjectRef().trim() : null;
        if (subjectRef != null && subjectRef.length() > 200) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "subjectRef is limited to 200 characters");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(issue(ctx.getClientApp(), subjectRef, body != null ? body.ttlMinutes() : null));
    }

    /** The calling app's tenant branding (defaults when the tenant has none). */
    @GetMapping("/v2/branding")
    public ResponseEntity<BrandingService.BrandingView> branding() {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(60, TimeUnit.SECONDS).cachePrivate())
                .body(branding.get(RequestContext.get().getTenantId()));
    }

    private SdkTokenResponse issue(ClientApp app, String subjectRef, Integer ttlMinutes) {
        SdkTokenService.Issued issued = sdkTokens.issue(app, subjectRef, ttlMinutes);
        return new SdkTokenResponse(issued.token(), issued.expiresAt(), tenantService.code(app.getTenantId()),
                app.getCode(), subjectRef);
    }
}
