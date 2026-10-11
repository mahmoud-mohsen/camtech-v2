package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminAuthService;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.TenantSession;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.CamtechProperties;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.repository.TenantSessionRepository;
import com.facetech.backend.repository.TenantUserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/**
 * Tenant portal sign-in: BCrypt passwords, opaque bearer tokens (stored hashed), lockout after repeated
 * failures. Session length and lockout follow the back-office settings (camtech.backoffice.*).
 */
@Slf4j
@Service
public class TenantAuthService {

    private final TenantUserRepository userRepository;
    private final TenantSessionRepository sessionRepository;
    private final CamtechProperties.Backoffice settings;
    private final AuditService audit;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public TenantAuthService(TenantUserRepository userRepository, TenantSessionRepository sessionRepository,
                             CamtechProperties properties, AuditService audit) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.settings = properties.getBackoffice();
        this.audit = audit;
    }

    public record Login(String token, Instant expiresAt, TenantUser user) {
    }

    /** Checks the password; the caller then checks the tenant is active and calls {@link #openSession}. */
    @Transactional(noRollbackFor = FaceMatchException.class)
    public TenantUser verify(String username, String password) {
        TenantUser user = username == null ? null : userRepository.findByUsernameIgnoreCase(username.trim()).orElse(null);
        Instant now = Instant.now();
        if (user == null || user.getStatus() != Codes.ActiveStatus.ACTIVE) {
            log.warn("Tenant login failed: username={} reason={}", username,
                    user == null ? "unknown user" : "user " + user.getStatus());
            throw invalidLogin();
        }
        RequestContext.get().setTenantId(user.getTenantId());
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            log.warn("Tenant login rejected: userId={} username={} reason=locked until {}",
                    user.getId(), user.getUsername(), user.getLockedUntil());
            throw new FaceMatchException(HttpStatus.LOCKED, "ACCOUNT_LOCKED",
                    "Too many failed sign-ins. Try again after " + user.getLockedUntil());
        }
        if (password == null || !encoder.matches(password, user.getPasswordHash())) {
            user.setFailedLogins(user.getFailedLogins() + 1);
            int failedAttempts = user.getFailedLogins();
            if (user.getFailedLogins() >= settings.getMaxFailedLogins()) {
                user.setLockedUntil(now.plus(settings.getLockMinutes(), ChronoUnit.MINUTES));
                user.setFailedLogins(0);
            }
            audit.recordAlways("TENANT_LOGIN_FAILED", "tenant_user", user.getUsername(), Map.of("reason", "wrong password"));
            log.warn("Tenant login failed: userId={} username={} reason=wrong password failedAttempts={}",
                    user.getId(), user.getUsername(), failedAttempts);
            throw invalidLogin();
        }
        return user;
    }

    @Transactional
    public Login openSession(TenantUser verified) {
        TenantUser user = userRepository.findById(verified.getId()).orElseThrow();
        Instant now = Instant.now();
        user.setFailedLogins(0);
        user.setLockedUntil(null);
        user.setLastLoginAt(now);
        String token = Secrets.token(32);
        TenantSession s = new TenantSession();
        s.setUserId(user.getId());
        s.setTokenHash(Secrets.sha256Hex(token));
        s.setExpiresAt(now.plus(settings.getSessionHours(), ChronoUnit.HOURS));
        s.setLastSeenAt(now);
        s.setIpAddress(RequestContext.get().getIpAddress());
        sessionRepository.save(s);
        audit.record("TENANT_LOGIN", "tenant_user", user.getUsername(), null);
        log.info("Tenant login succeeded: tenantId={} userId={} username={} role={} sessionId={} expiresAt={}",
                user.getTenantId(), user.getId(), user.getUsername(), user.getRole(), s.getId(), s.getExpiresAt());
        return new Login(token, s.getExpiresAt(), user);
    }

    /** Resolves a bearer token and slides its expiry; null when the token is unknown, revoked or expired. */
    @Transactional
    public TenantUser authenticate(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        Instant now = Instant.now();
        TenantSession s = sessionRepository.findByTokenHash(Secrets.sha256Hex(token)).orElse(null);
        if (s == null || s.isRevoked() || s.getExpiresAt().isBefore(now)) {
            if (s != null) {
                log.info("Tenant session rejected: sessionId={} userId={} reason={}", s.getId(), s.getUserId(),
                        s.isRevoked() ? "revoked" : "expired at " + s.getExpiresAt());
            }
            return null;
        }
        TenantUser user = userRepository.findById(s.getUserId()).orElse(null);
        if (user == null || user.getStatus() != Codes.ActiveStatus.ACTIVE) {
            log.warn("Tenant session rejected: sessionId={} userId={} reason={}", s.getId(), s.getUserId(),
                    user == null ? "user missing" : "user " + user.getStatus());
            return null;
        }
        if (now.isAfter(s.getLastSeenAt().plus(1, ChronoUnit.MINUTES))) {
            s.setLastSeenAt(now);
            s.setExpiresAt(now.plus(settings.getSessionHours(), ChronoUnit.HOURS));
        }
        return user;
    }

    @Transactional
    public void logout(String token) {
        if (token != null) {
            sessionRepository.findByTokenHash(Secrets.sha256Hex(token)).ifPresent(s -> {
                s.setRevoked(true);
                log.info("Tenant logout: sessionId={} userId={}", s.getId(), s.getUserId());
            });
        }
    }

    @Transactional
    public void changePassword(TenantUser current, String currentPassword, String newPassword) {
        TenantUser user = userRepository.findById(current.getId()).orElseThrow();
        if (currentPassword == null || !encoder.matches(currentPassword, user.getPasswordHash())) {
            log.warn("Tenant password change rejected: userId={} reason=wrong current password", user.getId());
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "WRONG_PASSWORD", "The current password is not correct");
        }
        AdminAuthService.validatePassword(newPassword);
        if (encoder.matches(newPassword, user.getPasswordHash())) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", "Choose a password you have not used here");
        }
        user.setPasswordHash(encoder.encode(newPassword));
        user.setMustChangePassword(false);
        audit.record("TENANT_PASSWORD_CHANGED", "tenant_user", user.getUsername(), null);
        log.info("Tenant password changed: userId={} username={}", user.getId(), user.getUsername());
    }

    private static FaceMatchException invalidLogin() {
        return new FaceMatchException(HttpStatus.UNAUTHORIZED, "INVALID_LOGIN", "The username or password is not correct");
    }
}
