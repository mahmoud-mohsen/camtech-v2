package com.facetech.backend.tenant;

import com.facetech.backend.domain.Actor;
import com.facetech.backend.domain.Tenant;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.platform.web.ErrorWriter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Tenant portal authentication for /v2/tenant/**: a bearer token from POST /v2/tenant/auth/login.
 * The tenant is the signed-in user's tenant; every /v2/tenant endpoint reads it only from RequestContext.
 * A user who must change their password can only reach the auth endpoints until they do.
 */
@Slf4j
@Component
@Order(SecurityProperties.DEFAULT_FILTER_ORDER + 20)
public class TenantPortalFilter extends OncePerRequestFilter {

    static final String PREFIX = "/v2/tenant/";

    private final TenantAuthService authService;
    private final TenantService tenantService;
    private final ObjectMapper objectMapper;

    public TenantPortalFilter(TenantAuthService authService, TenantService tenantService, ObjectMapper objectMapper) {
        this.authService = authService;
        this.tenantService = tenantService;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = path(request);
        return "OPTIONS".equalsIgnoreCase(request.getMethod()) || !path.startsWith(PREFIX)
                || path.equals(PREFIX + "auth/login");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        TenantUser user = authService.authenticate(RequestContext.get().getBearerToken());
        if (user == null) {
            ErrorWriter.write(response, objectMapper, 401, "UNAUTHORIZED", "Sign in again");
            return;
        }
        Tenant tenant = tenantService.findById(user.getTenantId()).orElse(null);
        if (tenant == null || !"ACTIVE".equals(tenant.getStatus())) {
            log.warn("Tenant portal call refused: tenantId={} userId={} reason=tenant {} {} {}", user.getTenantId(),
                    user.getId(), tenant == null ? "missing" : tenant.getStatus(), request.getMethod(), path(request));
            ErrorWriter.write(response, objectMapper, 403, "TENANT_SUSPENDED", "This tenant is suspended");
            return;
        }
        if (user.isMustChangePassword() && !path(request).startsWith(PREFIX + "auth/")) {
            ErrorWriter.write(response, objectMapper, 403, "PASSWORD_CHANGE_REQUIRED", "Change your password to continue");
            return;
        }
        RequestContext ctx = RequestContext.get();
        ctx.setTenantId(tenant.getId());
        ctx.setPortalTenantCode(tenant.getCode());
        ctx.setTenantUser(user);
        Actor.set(user.getUsername());
        chain.doFilter(request, response);
    }

    private static String path(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }
}
