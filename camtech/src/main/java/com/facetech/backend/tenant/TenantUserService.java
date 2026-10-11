package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminAuthService;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.repository.TenantSessionRepository;
import com.facetech.backend.repository.TenantUserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Tenant portal users, managed by the tenant's owners (/v2/tenant/users) and by camtech operators
 * (/v2/admin/tenants/{id}/users, for the first owner and lock-outs). A tenant always keeps one active OWNER.
 */
@Slf4j
@Service
public class TenantUserService {

    static final int GENERATED_PASSWORD_LENGTH = 16;

    private final TenantUserRepository userRepository;
    private final TenantSessionRepository sessionRepository;
    private final AuditService audit;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public TenantUserService(TenantUserRepository userRepository, TenantSessionRepository sessionRepository,
                             AuditService audit) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.audit = audit;
    }

    public record UserView(Long id, String username, String displayName, String email, String role, String status,
                           boolean mustChangePassword, Instant lastLoginAt, Instant createdAt) {
        public static UserView of(TenantUser u) {
            return new UserView(u.getId(), u.getUsername(), u.getDisplayName(), u.getEmail(), u.getRole().name(),
                    u.getStatus().name(), u.isMustChangePassword(), u.getLastLoginAt(), u.getCreatedAt());
        }
    }

    /** password: blank = generate one. */
    public record CreateUser(String username, String displayName, String email, String role, String password) {
    }

    public record UpdateUser(String displayName, String email, String role, String status) {
    }

    /** password: blank = generate one. */
    public record ResetPassword(String password) {
    }

    /** The password is returned once, so it can be shared with the user; it is never readable again. */
    public record CreatedUser(UserView user, String password) {
    }

    @Transactional(readOnly = true)
    public List<UserView> list(Long tenantId) {
        return userRepository.findByTenantIdOrderByUsernameAsc(tenantId).stream().map(UserView::of).toList();
    }

    @Transactional
    public CreatedUser create(Long tenantId, CreateUser body) {
        if (body == null) {
            throw invalid("Send the user");
        }
        String username = body.username() != null ? body.username().trim() : "";
        if (!username.matches("[A-Za-z0-9._@-]{3,100}")) {
            throw invalid("Username: 3-100 letters, numbers, dot, dash, underscore or @");
        }
        if (userRepository.findByUsernameIgnoreCase(username).isPresent()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "This username is already used");
        }
        String password = passwordOrGenerated(body.password());
        TenantUser u = new TenantUser();
        u.setTenantId(tenantId);
        u.setUsername(username);
        u.setDisplayName(blankToDefault(body.displayName(), username));
        u.setEmail(blankToNull(body.email()));
        u.setRole(role(body.role()));
        u.setStatus(Codes.ActiveStatus.ACTIVE);
        u.setPasswordHash(encoder.encode(password));
        u.setMustChangePassword(true);
        userRepository.save(u);
        audit.record("TENANT_USER_CREATED", "tenant_user", u.getUsername(), Map.of("role", u.getRole().name()));
        log.info("Tenant user created: tenantId={} userId={} username={} role={}", tenantId, u.getId(),
                u.getUsername(), u.getRole());
        return new CreatedUser(UserView.of(u), password);
    }

    /** currentUserId: the tenant user making the change (null for camtech operators). */
    @Transactional
    public UserView update(Long tenantId, Long id, UpdateUser body, Long currentUserId) {
        TenantUser u = user(tenantId, id);
        Codes.TenantRole newRole = body.role() != null ? role(body.role()) : u.getRole();
        Codes.ActiveStatus newStatus = body.status() != null ? status(body.status()) : u.getStatus();
        if (u.getId().equals(currentUserId) && (newRole != Codes.TenantRole.OWNER || newStatus != Codes.ActiveStatus.ACTIVE)) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "SELF_LOCKOUT", "You cannot remove your own owner access");
        }
        boolean losesOwner = u.getRole() == Codes.TenantRole.OWNER && u.getStatus() == Codes.ActiveStatus.ACTIVE
                && (newRole != Codes.TenantRole.OWNER || newStatus != Codes.ActiveStatus.ACTIVE);
        if (losesOwner && userRepository.countByTenantIdAndRoleAndStatus(tenantId, Codes.TenantRole.OWNER,
                Codes.ActiveStatus.ACTIVE) <= 1) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "LAST_OWNER", "The tenant needs at least one active owner");
        }
        log.info("Tenant user updated: tenantId={} userId={} username={} role {}->{} status {}->{}",
                tenantId, u.getId(), u.getUsername(), u.getRole(), newRole, u.getStatus(), newStatus);
        if (body.displayName() != null) {
            u.setDisplayName(blankToDefault(body.displayName(), u.getUsername()));
        }
        if (body.email() != null) {
            u.setEmail(blankToNull(body.email()));
        }
        u.setRole(newRole);
        u.setStatus(newStatus);
        if (newStatus == Codes.ActiveStatus.DISABLED) {
            sessionRepository.revokeAllForUser(u.getId());
        }
        audit.record("TENANT_USER_UPDATED", "tenant_user", u.getUsername(),
                Map.of("role", newRole.name(), "status", newStatus.name()));
        return UserView.of(u);
    }

    /** Sets a new password the user must change at next sign-in, signs them out everywhere and unlocks the account. */
    @Transactional
    public String resetPassword(Long tenantId, Long id, String password) {
        TenantUser u = user(tenantId, id);
        String value = passwordOrGenerated(password);
        u.setPasswordHash(encoder.encode(value));
        u.setMustChangePassword(true);
        u.setFailedLogins(0);
        u.setLockedUntil(null);
        sessionRepository.revokeAllForUser(u.getId());
        audit.record("TENANT_PASSWORD_RESET", "tenant_user", u.getUsername(), null);
        log.info("Tenant user password reset: tenantId={} userId={} username={} (sessions revoked)",
                tenantId, u.getId(), u.getUsername());
        return value;
    }

    private TenantUser user(Long tenantId, Long id) {
        return userRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "User not found"));
    }

    private static String passwordOrGenerated(String password) {
        String value = blankToNull(password);
        if (value == null) {
            return Secrets.password(GENERATED_PASSWORD_LENGTH);
        }
        AdminAuthService.validatePassword(value);
        return value;
    }

    private static Codes.TenantRole role(String raw) {
        try {
            return Codes.TenantRole.valueOf(raw);
        } catch (Exception e) {
            throw invalid("Role must be OWNER, DEVELOPER, REVIEWER or VIEWER");
        }
    }

    private static Codes.ActiveStatus status(String raw) {
        try {
            return Codes.ActiveStatus.valueOf(raw);
        } catch (Exception e) {
            throw invalid("Status must be ACTIVE or DISABLED");
        }
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String blankToDefault(String s, String fallback) {
        return s == null || s.isBlank() ? fallback : s.trim();
    }
}
