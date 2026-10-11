package com.facetech.backend.admin;

import com.facetech.backend.domain.Actor;
import com.facetech.backend.domain.BackofficeUser;
import com.facetech.backend.platform.RequestContext;
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
 * Back-office authentication for /v2/admin/**: a bearer token from
 * POST /v2/admin/auth/login. A user who must change their password can only
 * reach the auth endpoints until they do.
 */
@Slf4j
@Component
@Order(SecurityProperties.DEFAULT_FILTER_ORDER + 20)
public class AdminAuthFilter extends OncePerRequestFilter {

    private static final String PREFIX = "/v2/admin/";

    private final AdminAuthService authService;
    private final ObjectMapper objectMapper;

    public AdminAuthFilter(AdminAuthService authService, ObjectMapper objectMapper) {
        this.authService = authService;
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
        BackofficeUser user = authService.authenticate(RequestContext.get().getBearerToken());
        if (user == null) {
            log.info("Back-office request without a valid session: {} {}", request.getMethod(), path(request));
            ErrorWriter.write(response, objectMapper, 401, "UNAUTHORIZED", "Sign in again");
            return;
        }
        if (user.isMustChangePassword() && !path(request).startsWith(PREFIX + "auth/")) {
            log.warn("Back-office request blocked until password change: userId={} {} {}",
                    user.getId(), request.getMethod(), path(request));
            ErrorWriter.write(response, objectMapper, 403, "PASSWORD_CHANGE_REQUIRED", "Change your password to continue");
            return;
        }
        RequestContext.get().setAdminUser(user);
        Actor.set(user.getUsername());
        chain.doFilter(request, response);
    }

    private static String path(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }
}
