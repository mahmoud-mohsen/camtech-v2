package com.facetech.backend.admin;

import com.facetech.backend.domain.BackofficeUser;
import com.facetech.backend.domain.Codes;
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

/** Enforces {@link AdminAccess} on the admin controllers. */
@Slf4j
@Configuration
public class AdminRoleInterceptor implements HandlerInterceptor, WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/v2/admin/**").excludePathPatterns("/v2/admin/auth/**");
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod hm)) {
            return true;
        }
        BackofficeUser user = RequestContext.get().getAdminUser();
        if (user == null) {
            throw new FaceMatchException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Sign in again");
        }
        AdminAccess access = hm.getMethodAnnotation(AdminAccess.class);
        if (access == null) {
            access = hm.getBeanType().getAnnotation(AdminAccess.class);
        }
        Codes.AdminRole required = access != null ? access.value()
                : "GET".equalsIgnoreCase(request.getMethod()) ? Codes.AdminRole.VIEWER : Codes.AdminRole.ADMIN;
        if (rank(user.getRole()) < rank(required)) {
            log.warn("Back-office access denied: userId={} role={} requiredRole={} {} {}", user.getId(), user.getRole(),
                    required, request.getMethod(), request.getRequestURI());
            throw new FaceMatchException(HttpStatus.FORBIDDEN, "FORBIDDEN",
                    "Your role (" + user.getRole() + ") cannot do this. It needs " + required + ".");
        }
        return true;
    }

    static int rank(Codes.AdminRole role) {
        return switch (role) {
            case VIEWER -> 0;
            case REVIEWER -> 1;
            case ADMIN -> 2;
        };
    }
}
