package com.facetech.backend.admin;

import com.facetech.backend.domain.BackofficeSession;
import com.facetech.backend.domain.BackofficeUser;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.CamtechProperties;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.repository.BackofficeSessionRepository;
import com.facetech.backend.repository.BackofficeUserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/** Back-office sign-in: BCrypt passwords, opaque bearer tokens (stored hashed), lockout after repeated failures. */
@Service
@Slf4j
public class AdminAuthService implements ApplicationRunner {

    private final BackofficeUserRepository userRepository;
    private final BackofficeSessionRepository sessionRepository;
    private final CamtechProperties.Backoffice settings;
    private final AuditService audit;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AdminAuthService(BackofficeUserRepository userRepository, BackofficeSessionRepository sessionRepository,
                            CamtechProperties properties, AuditService audit) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.settings = properties.getBackoffice();
        this.audit = audit;
    }

    public record Login(String token, Instant expiresAt, BackofficeUser user) {
    }

    /** Creates the first "admin" user on an empty database. */
    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (userRepository.count() > 0) {
            return;
        }
        String password = settings.getAdminPassword();
        boolean generated = password == null || password.isBlank();
        if (generated) {
            password = Secrets.password(16);
        }
        BackofficeUser admin = new BackofficeUser();
        admin.setUsername("admin");
        admin.setDisplayName("Administrator");
        admin.setPasswordHash(encoder.encode(password));
        admin.setRole(Codes.AdminRole.ADMIN);
        admin.setStatus(Codes.ActiveStatus.ACTIVE);
        admin.setMustChangePassword(true);
        userRepository.save(admin);
        if (generated) {
            log.warn("Created back-office user 'admin' with a generated password: {} (change it at first sign-in, "
                    + "or set CAMTECH_BACKOFFICE_ADMIN_PASSWORD before the first start)", password);
        } else {
            log.info("Created back-office user 'admin' with the configured password");
        }
    }

    @Transactional(noRollbackFor = FaceMatchException.class)
    public Login login(String username, String password) {
        BackofficeUser user = username == null ? null : userRepository.findByUsernameIgnoreCase(username.trim()).orElse(null);
        Instant now = Instant.now();
        if (user == null || user.getStatus() != Codes.ActiveStatus.ACTIVE) {
            audit.recordAlways("ADMIN_LOGIN_FAILED", "backoffice_user", username, Map.of("reason", "unknown or disabled"));
            log.warn("Back-office login failed: username={} reason={}", username,
                    user == null ? "unknown user" : "user " + user.getStatus());
            throw invalidLogin();
        }
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            log.warn("Back-office login rejected: userId={} username={} reason=locked until {}",
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
            audit.recordAlways("ADMIN_LOGIN_FAILED", "backoffice_user", user.getUsername(), Map.of("reason", "wrong password"));
            log.warn("Back-office login failed: userId={} username={} reason=wrong password failedAttempts={}",
                    user.getId(), user.getUsername(), failedAttempts);
            if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
                log.warn("Back-office user locked: userId={} username={} until={}",
                        user.getId(), user.getUsername(), user.getLockedUntil());
            }
            throw invalidLogin();
        }
        user.setFailedLogins(0);
        user.setLockedUntil(null);
        user.setLastLoginAt(now);
        String token = Secrets.token(32);
        BackofficeSession s = new BackofficeSession();
        s.setUserId(user.getId());
        s.setTokenHash(Secrets.sha256Hex(token));
        s.setExpiresAt(now.plus(settings.getSessionHours(), ChronoUnit.HOURS));
        s.setLastSeenAt(now);
        s.setIpAddress(RequestContext.get().getIpAddress());
        sessionRepository.save(s);
        RequestContext.get().setAdminUser(user);
        audit.record("ADMIN_LOGIN", "backoffice_user", user.getUsername(), null);
        log.info("Back-office login succeeded: userId={} username={} role={} sessionId={} expiresAt={}",
                user.getId(), user.getUsername(), user.getRole(), s.getId(), s.getExpiresAt());
        return new Login(token, s.getExpiresAt(), user);
    }

    /** Resolves a bearer token and slides its expiry. */
    @Transactional
    public BackofficeUser authenticate(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        Instant now = Instant.now();
        BackofficeSession s = sessionRepository.findByTokenHash(Secrets.sha256Hex(token)).orElse(null);
        if (s == null || s.isRevoked() || s.getExpiresAt().isBefore(now)) {
            if (s == null) {
                log.debug("Back-office token not recognised");
            } else {
                log.info("Back-office session rejected: sessionId={} userId={} reason={}", s.getId(), s.getUserId(),
                        s.isRevoked() ? "revoked" : "expired at " + s.getExpiresAt());
            }
            return null;
        }
        BackofficeUser user = userRepository.findById(s.getUserId()).orElse(null);
        if (user == null || user.getStatus() != Codes.ActiveStatus.ACTIVE) {
            log.warn("Back-office session rejected: sessionId={} userId={} reason={}", s.getId(), s.getUserId(),
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
                log.info("Back-office logout: sessionId={} userId={}", s.getId(), s.getUserId());
            });
        }
    }

    @Transactional
    public void changePassword(BackofficeUser current, String currentPassword, String newPassword) {
        BackofficeUser user = userRepository.findById(current.getId()).orElseThrow();
        if (currentPassword == null || !encoder.matches(currentPassword, user.getPasswordHash())) {
            log.warn("Back-office password change rejected: userId={} username={} reason=wrong current password",
                    user.getId(), user.getUsername());
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "WRONG_PASSWORD", "The current password is not correct");
        }
        validatePassword(newPassword);
        if (encoder.matches(newPassword, user.getPasswordHash())) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", "Choose a password you have not used here");
        }
        user.setPasswordHash(encoder.encode(newPassword));
        user.setMustChangePassword(false);
        audit.record("ADMIN_PASSWORD_CHANGED", "backoffice_user", user.getUsername(), null);
        log.info("Back-office password changed: userId={} username={}", user.getId(), user.getUsername());
    }

    public String hash(String password) {
        return encoder.encode(password);
    }

    public static void validatePassword(String password) {
        if (password == null || password.length() < 10
                || !password.chars().anyMatch(Character::isLetter) || !password.chars().anyMatch(Character::isDigit)) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD",
                    "Use at least 10 characters with letters and numbers");
        }
    }

    private static FaceMatchException invalidLogin() {
        return new FaceMatchException(HttpStatus.UNAUTHORIZED, "INVALID_LOGIN", "The username or password is not correct");
    }
}
