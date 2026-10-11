package com.facetech.backend.platform;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.ClientCredential;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.ClientCredentialRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Checks X-Client-Id / X-Client-Secret against client_credential (BCrypt).
 * A successful check is remembered for five minutes so BCrypt does not run
 * on every request.
 */
@Service
@Slf4j
public class ClientAuthService {

    private static final long CACHE_MILLIS = 5 * 60_000;
    /** After this many wrong secrets for one key within FAILURE_WINDOW_MILLIS, the key is refused without BCrypt. */
    private static final int MAX_FAILURES = 10;
    private static final long FAILURE_WINDOW_MILLIS = 60_000;

    private final ClientCredentialRepository credentialRepository;
    private final ClientAppRepository clientAppRepository;
    private final TenantService tenantService;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final Map<String, Verified> verified = new ConcurrentHashMap<>();
    private final Map<String, Failures> failures = new ConcurrentHashMap<>();

    public ClientAuthService(ClientCredentialRepository credentialRepository,
                             ClientAppRepository clientAppRepository,
                             TenantService tenantService) {
        this.credentialRepository = credentialRepository;
        this.clientAppRepository = clientAppRepository;
        this.tenantService = tenantService;
    }

    @Transactional
    public ClientApp authenticate(String keyId, String secret) {
        String cacheKey = Secrets.sha256Hex(keyId + ":" + secret);
        Verified v = verified.get(cacheKey);
        long now = System.currentTimeMillis();
        ClientCredential cred = credentialRepository.findByKeyId(keyId)
                .filter(c -> c.getStatus() == Codes.CredentialStatus.ACTIVE)
                .filter(c -> c.getExpiresAt() == null || c.getExpiresAt().isAfter(Instant.now()))
                .orElse(null);
        if (cred == null) {
            // Also read on a cache hit, so a key revoked on another replica stops working right away.
            verified.remove(cacheKey);
            log.warn("Client credential {} rejected: unknown, revoked or expired key", keyId);
            throw invalid();
        }
        if (v != null && now - v.at < CACHE_MILLIS && v.clientAppId.equals(cred.getClientAppId())) {
            ClientApp app = clientAppRepository.findById(v.clientAppId).orElse(null);
            if (app != null && app.getStatus() == Codes.ActiveStatus.ACTIVE) {
                return app;
            }
        }
        Failures f = failures.get(keyId);
        if (f != null && f.count >= MAX_FAILURES && now - f.since < FAILURE_WINDOW_MILLIS) {
            log.warn("Client credential {} rejected: too many wrong secrets, retry after the window", keyId);
            throw new FaceMatchException(HttpStatus.TOO_MANY_REQUESTS, "CLIENT_AUTH_THROTTLED",
                    "Too many failed attempts with this key; try again in a minute");
        }
        if (!encoder.matches(secret, cred.getSecretHash())) {
            failures.compute(keyId, (k, old) -> old == null || now - old.since >= FAILURE_WINDOW_MILLIS
                    ? new Failures(1, now) : new Failures(old.count + 1, old.since));
            if (failures.size() > 10_000) {
                failures.entrySet().removeIf(e -> now - e.getValue().since >= FAILURE_WINDOW_MILLIS);
            }
            log.warn("Client credential {} rejected: secret does not match", keyId);
            throw invalid();
        }
        failures.remove(keyId);
        ClientApp app = clientAppRepository.findById(cred.getClientAppId())
                .filter(a -> a.getStatus() == Codes.ActiveStatus.ACTIVE)
                .orElse(null);
        if (app == null) {
            log.warn("Client credential {} rejected: client app {} is missing or inactive", keyId, cred.getClientAppId());
            throw invalid();
        }
        cred.setLastUsedAt(Instant.now());
        verified.put(cacheKey, new Verified(app.getId(), now));
        log.debug("Client credential {} verified for app {}", keyId, app.getCode());
        return app;
    }

    public ClientApp defaultApp(String code) {
        return clientAppRepository.findByTenantIdAndCode(tenantService.defaultTenantId(), code)
                .filter(a -> a.getStatus() == Codes.ActiveStatus.ACTIVE)
                .orElseThrow(() -> new FaceMatchException(HttpStatus.UNAUTHORIZED, "CLIENT_AUTH_REQUIRED",
                        "Client credentials are required"));
    }

    /** The app with this id when it is active. */
    public Optional<ClientApp> activeApp(Long id) {
        return id == null ? Optional.empty()
                : clientAppRepository.findById(id).filter(a -> a.getStatus() == Codes.ActiveStatus.ACTIVE);
    }

    public String hash(String secret) {
        return encoder.encode(secret);
    }

    /** Drops remembered checks, e.g. after a credential is revoked. */
    public void evict() {
        verified.clear();
        log.info("Client credential verification cache cleared");
    }

    private static FaceMatchException invalid() {
        return new FaceMatchException(HttpStatus.UNAUTHORIZED, "CLIENT_AUTH_INVALID", "The client credentials are not valid");
    }

    private record Verified(Long clientAppId, long at) {
    }

    private record Failures(int count, long since) {
    }
}
