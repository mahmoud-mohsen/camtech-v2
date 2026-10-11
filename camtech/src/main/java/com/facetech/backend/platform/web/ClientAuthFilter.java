package com.facetech.backend.platform.web;

import com.facetech.backend.domain.Actor;
import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.CamtechProperties;
import com.facetech.backend.platform.ClientAuthService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.SdkTokenService;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Identifies the calling app for every public endpoint (v2 and legacy), in this order:
 * X-Client-Id / X-Client-Secret (server-side callers); X-Sdk-Token (browsers and apps,
 * a short-lived token the app's backend got from POST /v2/sdk-tokens); the session
 * token alone on /v2/selfie-verifications/{id}/** (a verification the app's backend
 * started). Otherwise the configured default app is used, unless
 * camtech.security.require-client-credentials is true. Web apps with allowed origins
 * only accept requests from those origins.
 */
@Component
@Order(SecurityProperties.DEFAULT_FILTER_ORDER + 20)
@Slf4j
public class ClientAuthFilter extends OncePerRequestFilter {

    private static final Pattern SESSION_PATH = Pattern.compile("^/v2/selfie-verifications/([^/]+)(/.*)?$");
    /** What an SDK token may call: the end-user flows only, never records of other users or legacy endpoints. */
    private static final Pattern SDK_PATHS = Pattern.compile("^/v2/(capabilities|branding|reason-codes"
            + "|selfie-verifications(/.*)?|face-authentications|face-enrollments|liveness-checks|liveness-challenges"
            + "|documents/scan|documents/scan-only)$");

    private final ClientAuthService clientAuthService;
    private final SdkTokenService sdkTokens;
    private final VerificationSessionRepository sessionRepository;
    private final TenantService tenantService;
    private final CamtechProperties properties;
    private final ObjectMapper objectMapper;

    public ClientAuthFilter(ClientAuthService clientAuthService, SdkTokenService sdkTokens,
                            VerificationSessionRepository sessionRepository, TenantService tenantService,
                            CamtechProperties properties,
                            ObjectMapper objectMapper) {
        this.clientAuthService = clientAuthService;
        this.sdkTokens = sdkTokens;
        this.sessionRepository = sessionRepository;
        this.tenantService = tenantService;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return "OPTIONS".equalsIgnoreCase(request.getMethod())
                || path.startsWith("/v2/admin/")
                || path.startsWith("/v2/tenant/")
                || path.startsWith("/v2/.well-known/")
                || path.equals("/health")
                || path.equals("/api/v1/documents/health")
                || path.startsWith("/actuator")
                || path.equals("/error");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String keyId = request.getHeader("X-Client-Id");
        String secret = request.getHeader("X-Client-Secret");
        String sdkToken = request.getHeader("X-Sdk-Token");
        RequestContext ctx = RequestContext.get();
        ClientApp app;
        boolean credentialed;
        String method;
        try {
            if (keyId != null && !keyId.isBlank() && secret != null && !secret.isBlank()) {
                method = "client-credentials";
                app = clientAuthService.authenticate(keyId.trim(), secret.trim());
                credentialed = true;
            } else if (sdkToken != null && !sdkToken.isBlank()) {
                method = "sdk-token";
                if (!SDK_PATHS.matcher(path(request)).matches()) {
                    log.warn("Rejected SDK token on {}: SDK_TOKEN_NOT_ALLOWED ip={}", path(request), ctx.getIpAddress());
                    ErrorWriter.write(response, objectMapper, 403, "SDK_TOKEN_NOT_ALLOWED",
                            "SDK tokens can only be used for the end-user flows");
                    return;
                }
                SdkTokenService.Claims claims = sdkTokens.verify(sdkToken);
                app = clientAuthService.activeApp(claims.clientAppId())
                        .filter(a -> a.getTenantId().equals(claims.tenantId()))
                        .orElseThrow(() -> new FaceMatchException(HttpStatus.UNAUTHORIZED, "SDK_TOKEN_INVALID",
                                "The SDK token is not valid"));
                credentialed = true;
                ctx.setSdkToken(true);
                ctx.setSdkSubjectRef(claims.subjectRef());
            } else if ((app = sessionApp(path(request), ctx.getBearerToken())) != null) {
                // The session token alone identifies a verification the app's backend started.
                method = "session-token";
                credentialed = false;
            } else if (properties.getSecurity().isRequireClientCredentials()) {
                log.warn("Rejected call to {}: CLIENT_AUTH_REQUIRED (no client credentials or SDK token) ip={}",
                        path(request), ctx.getIpAddress());
                ErrorWriter.write(response, objectMapper, 401, "CLIENT_AUTH_REQUIRED",
                        "Send X-Client-Id and X-Client-Secret, or an SDK token");
                return;
            } else {
                method = "default-app";
                app = clientAuthService.defaultApp(properties.getSecurity().getDefaultClientApp());
                credentialed = false;
            }
        } catch (FaceMatchException e) {
            log.warn("Rejected client auth on {}: {} ({}) clientId={} ip={}", path(request), e.getCode(), e.getMessage(),
                    keyId != null && !keyId.isBlank() ? keyId.trim() : "-", ctx.getIpAddress());
            ErrorWriter.write(response, objectMapper, e.getStatus().value(), e.getCode(), e.getMessage());
            return;
        }

        if (!tenantService.isActive(app.getTenantId())) {
            log.warn("Rejected call to {} from app {}: TENANT_SUSPENDED (tenant {}) ip={}", path(request), app.getCode(),
                    app.getTenantId(), ctx.getIpAddress());
            ErrorWriter.write(response, objectMapper, 403, "TENANT_SUSPENDED", "This service is not available for this account");
            return;
        }

        String origin = request.getHeader("Origin");
        if (app.getChannel() == Codes.Channel.WEB && origin != null && !originAllowed(app, origin)) {
            log.warn("Rejected call to {} from app {}: ORIGIN_NOT_ALLOWED origin={} ip={}", path(request), app.getCode(),
                    origin, ctx.getIpAddress());
            ErrorWriter.write(response, objectMapper, 403, "ORIGIN_NOT_ALLOWED", "Requests from this website are not allowed");
            return;
        }
        log.debug("Client authenticated: app={} tenant={} via {}", app.getCode(), app.getTenantId(), method);

        ctx.setClientApp(app);
        ctx.setCredentialed(credentialed);
        ctx.setTenantId(app.getTenantId());
        Actor.set(app.getCode());
        chain.doFilter(request, response);
    }

    /** The app of the selfie verification addressed by {@code path}, when {@code bearer} is its session token. */
    private ClientApp sessionApp(String path, String bearer) {
        if (bearer == null || bearer.isBlank()) {
            return null;
        }
        Matcher m = SESSION_PATH.matcher(path);
        if (!m.matches()) {
            return null;
        }
        return sessionRepository.findByPublicId(m.group(1))
                .filter(s -> Secrets.sameHash(Secrets.sha256Hex(bearer), s.getTokenHash()))
                .flatMap(s -> clientAuthService.activeApp(s.getClientAppId()))
                .orElse(null);
    }

    private static String path(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }

    private static boolean originAllowed(ClientApp app, String origin) {
        String allowed = app.getAllowedOrigins();
        if (allowed == null || allowed.isBlank()) {
            return true;
        }
        return Arrays.stream(allowed.split(","))
                .map(String::trim)
                .anyMatch(o -> o.equals("*") || o.equalsIgnoreCase(origin));
    }
}
