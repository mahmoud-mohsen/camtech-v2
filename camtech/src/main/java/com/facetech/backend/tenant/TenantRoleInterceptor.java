package com.facetech.backend.tenant;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.Set;

/** Enforces {@link TenantAccess} on the tenant portal controllers. */
@Slf4j
@Configuration
public class TenantRoleInterceptor implements HandlerInterceptor, WebMvcConfigurer {

    private static final Codes.TenantRole[] ANY = Codes.TenantRole.values();
    private static final Codes.TenantRole[] WRITE_DEFAULT = {Codes.TenantRole.DEVELOPER};

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/v2/tenant/**").excludePathPatterns("/v2/tenant/auth/**");
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod hm)) {
            return true;
        }
        TenantUser user = RequestContext.get().getTenantUser();
        if (user == null) {
            throw new FaceMatchException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Sign in again");
        }
        TenantAccess access = hm.getMethodAnnotation(TenantAccess.class);
        if (access == null) {
            access = hm.getBeanType().getAnnotation(TenantAccess.class);
        }
        Codes.TenantRole[] allowed = access != null ? access.value()
                : "GET".equalsIgnoreCase(request.getMethod()) ? ANY : WRITE_DEFAULT;
        if (!allows(user.getRole(), allowed)) {
            log.warn("Tenant access denied: tenantId={} userId={} role={} allowed={} {} {}", user.getTenantId(),
                    user.getId(), user.getRole(), Arrays.toString(allowed), request.getMethod(), request.getRequestURI());
            throw new FaceMatchException(HttpStatus.FORBIDDEN, "FORBIDDEN",
                    "Your role (" + user.getRole() + ") cannot do this");
        }
        return true;
    }

    static boolean allows(Codes.TenantRole role, Codes.TenantRole[] allowed) {
        return role == Codes.TenantRole.OWNER || Set.of(allowed).contains(role);
    }
}
