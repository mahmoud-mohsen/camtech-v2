package com.facetech.backend.platform.web;

import com.facetech.backend.domain.Actor;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * First filter: records tenant, client IP, user agent, language and bearer token; clears them afterwards.
 * Also gives every request an id (X-Request-Id, echoed back and put in the log MDC as {@code requestId})
 * and writes one access line per request: method, path, status, duration, caller.
 */
@Slf4j
@Component
// After Spring Security, so CORS headers are already on error responses written here.
@Order(SecurityProperties.DEFAULT_FILTER_ORDER + 10)
public class CamtechRequestFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID_HEADER = "X-Request-Id";
    public static final String MDC_REQUEST_ID = "requestId";
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");

    private final TenantService tenantService;

    public CamtechRequestFilter(TenantService tenantService) {
        this.tenantService = tenantService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = requestId(request);
        MDC.put(MDC_REQUEST_ID, requestId);
        response.setHeader(REQUEST_ID_HEADER, requestId);
        long started = System.nanoTime();
        RequestContext ctx = RequestContext.get();
        boolean quiet = isQuiet(request);
        try {
            ctx.setTenantId(tenantService.defaultTenantId());
            ctx.setIpAddress(clientIp(request));
            String ua = request.getHeader("User-Agent");
            ctx.setUserAgent(ua != null && ua.length() > 500 ? ua.substring(0, 500) : ua);
            String lang = request.getHeader("Accept-Language");
            ctx.setLang(lang != null && lang.trim().toLowerCase().startsWith("ar") ? "ar" : "en");
            String auth = request.getHeader("Authorization");
            if (auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) {
                ctx.setBearerToken(auth.substring(7).trim());
            }
            if (!quiet) {
                log.debug("--> {} {} ip={} lang={} ua={}", request.getMethod(), request.getRequestURI(),
                        ctx.getIpAddress(), ctx.getLang(), ctx.getUserAgent());
            }
            chain.doFilter(request, response);
        } finally {
            long ms = (System.nanoTime() - started) / 1_000_000;
            int status = response.getStatus();
            if (!quiet || status >= 400) {
                String line = "<-- {} {} status={} {}ms tenant={} caller={} ip={}";
                Object[] args = {request.getMethod(), request.getRequestURI(), status, ms, ctx.getTenantId(),
                        caller(ctx), ctx.getIpAddress()};
                if (status >= 500) {
                    log.error(line, args);
                } else if (status >= 400) {
                    log.warn(line, args);
                } else {
                    log.info(line, args);
                }
            }
            RequestContext.clear();
            Actor.clear();
            MDC.remove(MDC_REQUEST_ID);
        }
    }

    /** Health probes and CORS preflights would flood the log; they are only logged when they fail. */
    private static boolean isQuiet(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return "OPTIONS".equals(request.getMethod()) || path.startsWith("/actuator");
    }

    private static String requestId(HttpServletRequest request) {
        String given = request.getHeader(REQUEST_ID_HEADER);
        return given != null && SAFE_REQUEST_ID.matcher(given).matches() ? given : UUID.randomUUID().toString();
    }

    /** Who called, without secrets: client app code, back-office user id, portal tenant or anonymous. */
    private static String caller(RequestContext ctx) {
        if (ctx.getAdminUser() != null) {
            return "admin:" + ctx.getAdminUser().getId();
        }
        if (ctx.getTenantUser() != null) {
            return "portal:" + ctx.getPortalTenantCode() + ":" + ctx.getTenantUser().getId();
        }
        if (ctx.getPortalTenantCode() != null) {
            return "portal:" + ctx.getPortalTenantCode();
        }
        if (ctx.getClientApp() != null) {
            return (ctx.isSdkToken() ? "sdk:" : "app:") + ctx.getClientApp().getCode();
        }
        return "-";
    }

    static String clientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip != null && !ip.isBlank() && !"unknown".equalsIgnoreCase(ip)) {
            ip = ip.split(",")[0].trim();
        } else {
            ip = request.getHeader("X-Real-IP");
            if (ip == null || ip.isBlank() || "unknown".equalsIgnoreCase(ip)) {
                ip = request.getRemoteAddr();
            }
        }
        return ip != null && ip.length() > 45 ? ip.substring(0, 45) : ip;
    }
}
