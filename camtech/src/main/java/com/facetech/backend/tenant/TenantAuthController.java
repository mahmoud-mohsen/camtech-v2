package com.facetech.backend.tenant;

import com.facetech.backend.domain.Actor;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.Tenant;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Tenant portal sign-in, the signed-in account, and the tenant's own users (owners only). */
@Slf4j
@RestController
@RequestMapping("/v2/tenant")
public class TenantAuthController {

    private final TenantAuthService authService;
    private final TenantUserService users;
    private final TenantService tenantService;

    public TenantAuthController(TenantAuthService authService, TenantUserService users, TenantService tenantService) {
        this.authService = authService;
        this.users = users;
        this.tenantService = tenantService;
    }

    public record TenantRef(String code, String name) {
    }

    public record Me(TenantUserService.UserView user, TenantRef tenant) {
    }

    public record LoginRequest(String username, String password) {
    }

    public record LoginResponse(String token, Instant expiresAt, TenantUserService.UserView user, TenantRef tenant) {
    }

    public record ChangePasswordRequest(String currentPassword, String newPassword) {
    }

    // ---------------------------------------------------------------- auth

    @PostMapping("/auth/login")
    public LoginResponse login(@RequestBody LoginRequest body) {
        TenantUser user = authService.verify(body != null ? body.username() : null, body != null ? body.password() : null);
        Tenant tenant = tenantService.findById(user.getTenantId()).orElseThrow();
        if (!"ACTIVE".equals(tenant.getStatus())) {
            log.warn("Tenant login refused: tenantCode={} status={} userId={}", tenant.getCode(), tenant.getStatus(), user.getId());
            throw new FaceMatchException(HttpStatus.FORBIDDEN, "TENANT_SUSPENDED", "This tenant is suspended");
        }
        RequestContext.get().setPortalTenantCode(tenant.getCode());
        Actor.set(user.getUsername());
        TenantAuthService.Login login = authService.openSession(user);
        return new LoginResponse(login.token(), login.expiresAt(), TenantUserService.UserView.of(login.user()), ref(tenant));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<Void> logout() {
        authService.logout(RequestContext.get().getBearerToken());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/auth/me")
    public Me me() {
        return new Me(TenantUserService.UserView.of(currentUser()), ref(tenantService.currentTenant()));
    }

    @PostMapping("/auth/change-password")
    public ResponseEntity<Void> changePassword(@RequestBody ChangePasswordRequest body) {
        authService.changePassword(currentUser(), body.currentPassword(), body.newPassword());
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- users

    @GetMapping("/users")
    @TenantAccess(Codes.TenantRole.OWNER)
    public List<TenantUserService.UserView> list() {
        return users.list(tenantId());
    }

    @PostMapping("/users")
    @TenantAccess(Codes.TenantRole.OWNER)
    public ResponseEntity<TenantUserService.CreatedUser> create(@RequestBody TenantUserService.CreateUser body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(users.create(tenantId(), body));
    }

    @PutMapping("/users/{id}")
    @TenantAccess(Codes.TenantRole.OWNER)
    public TenantUserService.UserView update(@PathVariable Long id, @RequestBody TenantUserService.UpdateUser body) {
        return users.update(tenantId(), id, body, currentUser().getId());
    }

    @PostMapping("/users/{id}/reset-password")
    @TenantAccess(Codes.TenantRole.OWNER)
    public Map<String, String> resetPassword(@PathVariable Long id,
                                             @RequestBody(required = false) TenantUserService.ResetPassword body) {
        return Map.of("password", users.resetPassword(tenantId(), id, body != null ? body.password() : null));
    }

    private static TenantUser currentUser() {
        return RequestContext.get().getTenantUser();
    }

    private static Long tenantId() {
        return RequestContext.get().getTenantId();
    }

    private static TenantRef ref(Tenant t) {
        return new TenantRef(t.getCode(), t.getName());
    }
}
