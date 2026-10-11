package com.facetech.backend.admin;

import com.facetech.backend.domain.BackofficeUser;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.repository.BackofficeSessionRepository;
import com.facetech.backend.repository.BackofficeUserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
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

/** Back-office sign-in, the signed-in account, and back-office user management. */
@Slf4j
@RestController
@RequestMapping("/v2/admin")
public class AdminAuthController {

    private final AdminAuthService authService;
    private final BackofficeUserRepository userRepository;
    private final BackofficeSessionRepository sessionRepository;
    private final AuditService audit;

    public AdminAuthController(AdminAuthService authService, BackofficeUserRepository userRepository,
                               BackofficeSessionRepository sessionRepository, AuditService audit) {
        this.authService = authService;
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.audit = audit;
    }

    public record UserView(Long id, String username, String displayName, String email, String role, String status,
                           boolean mustChangePassword, Instant lastLoginAt, Instant createdAt) {
        static UserView of(BackofficeUser u) {
            return new UserView(u.getId(), u.getUsername(), u.getDisplayName(), u.getEmail(), u.getRole().name(),
                    u.getStatus().name(), u.isMustChangePassword(), u.getLastLoginAt(), u.getCreatedAt());
        }
    }

    public record LoginRequest(String username, String password) {
    }

    public record LoginResponse(String token, Instant expiresAt, UserView user) {
    }

    public record ChangePasswordRequest(String currentPassword, String newPassword) {
    }

    public record CreateUserRequest(String username, String displayName, String email, String role) {
    }

    public record UpdateUserRequest(String displayName, String email, String role, String status) {
    }

    public record CreatedUser(UserView user, String temporaryPassword) {
    }

    // ---------------------------------------------------------------- auth

    @PostMapping("/auth/login")
    public LoginResponse login(@RequestBody LoginRequest body) {
        AdminAuthService.Login login = authService.login(body.username(), body.password());
        return new LoginResponse(login.token(), login.expiresAt(), UserView.of(login.user()));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<Void> logout() {
        authService.logout(RequestContext.get().getBearerToken());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/auth/me")
    public UserView me() {
        return UserView.of(RequestContext.get().getAdminUser());
    }

    @PostMapping("/auth/change-password")
    public ResponseEntity<Void> changePassword(@RequestBody ChangePasswordRequest body) {
        authService.changePassword(RequestContext.get().getAdminUser(), body.currentPassword(), body.newPassword());
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- users

    @GetMapping("/users")
    @AdminAccess(Codes.AdminRole.ADMIN)
    public List<UserView> users() {
        return userRepository.findAllByOrderByUsernameAsc().stream().map(UserView::of).toList();
    }

    @PostMapping("/users")
    @Transactional
    public ResponseEntity<CreatedUser> createUser(@RequestBody CreateUserRequest body) {
        String username = body.username() != null ? body.username().trim() : "";
        if (!username.matches("[A-Za-z0-9._@-]{3,100}")) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                    "Username: 3-100 letters, numbers, dot, dash, underscore or @");
        }
        if (userRepository.findByUsernameIgnoreCase(username).isPresent()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "This username is already used");
        }
        String temporary = Secrets.password(14);
        BackofficeUser u = new BackofficeUser();
        u.setUsername(username);
        u.setDisplayName(blankToDefault(body.displayName(), username));
        u.setEmail(blankToNull(body.email()));
        u.setRole(role(body.role()));
        u.setStatus(Codes.ActiveStatus.ACTIVE);
        u.setPasswordHash(authService.hash(temporary));
        u.setMustChangePassword(true);
        userRepository.save(u);
        audit.record("ADMIN_USER_CREATED", "backoffice_user", u.getUsername(), Map.of("role", u.getRole().name()));
        log.info("Back-office user created by adminUserId={}: userId={} username={} role={}",
                RequestContext.get().getAdminUser().getId(), u.getId(), u.getUsername(), u.getRole());
        return ResponseEntity.status(HttpStatus.CREATED).body(new CreatedUser(UserView.of(u), temporary));
    }

    @PutMapping("/users/{id}")
    @Transactional
    public UserView updateUser(@PathVariable Long id, @RequestBody UpdateUserRequest body) {
        BackofficeUser u = user(id);
        BackofficeUser me = RequestContext.get().getAdminUser();
        Codes.AdminRole newRole = body.role() != null ? role(body.role()) : u.getRole();
        Codes.ActiveStatus newStatus = body.status() != null ? Codes.ActiveStatus.valueOf(body.status()) : u.getStatus();
        if (u.getId().equals(me.getId()) && (newRole != Codes.AdminRole.ADMIN || newStatus != Codes.ActiveStatus.ACTIVE)) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "SELF_LOCKOUT", "You cannot remove your own admin access");
        }
        log.info("Back-office user updated by adminUserId={}: userId={} username={} role {}->{} status {}->{}",
                me.getId(), u.getId(), u.getUsername(), u.getRole(), newRole, u.getStatus(), newStatus);
        if (body.displayName() != null) {
            u.setDisplayName(blankToDefault(body.displayName(), u.getUsername()));
        }
        u.setEmail(blankToNull(body.email()));
        u.setRole(newRole);
        u.setStatus(newStatus);
        if (newStatus == Codes.ActiveStatus.DISABLED) {
            sessionRepository.revokeAllForUser(u.getId());
            log.info("Revoked all back-office sessions of disabled userId={}", u.getId());
        }
        audit.record("ADMIN_USER_UPDATED", "backoffice_user", u.getUsername(),
                Map.of("role", newRole.name(), "status", newStatus.name()));
        return UserView.of(u);
    }

    @PostMapping("/users/{id}/reset-password")
    @Transactional
    public Map<String, String> resetPassword(@PathVariable Long id) {
        BackofficeUser u = user(id);
        String temporary = Secrets.password(14);
        u.setPasswordHash(authService.hash(temporary));
        u.setMustChangePassword(true);
        u.setFailedLogins(0);
        u.setLockedUntil(null);
        sessionRepository.revokeAllForUser(u.getId());
        audit.record("ADMIN_PASSWORD_RESET", "backoffice_user", u.getUsername(), null);
        log.info("Back-office password reset by adminUserId={}: userId={} username={} (sessions revoked)",
                RequestContext.get().getAdminUser().getId(), u.getId(), u.getUsername());
        return Map.of("temporaryPassword", temporary);
    }

    private BackofficeUser user(Long id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "User not found"));
    }

    private static Codes.AdminRole role(String raw) {
        try {
            return Codes.AdminRole.valueOf(raw);
        } catch (Exception e) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Role must be ADMIN, REVIEWER or VIEWER");
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String blankToDefault(String s, String fallback) {
        return s == null || s.isBlank() ? fallback : s.trim();
    }
}
