package com.facetech.backend.platform;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.exception.FaceMatchException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Short-lived tokens that let a browser or app use camtech for one client app
 * without holding its secret. The tenant's backend asks for one with its
 * credentials (POST /v2/sdk-tokens) and hands it to the web SDK, which sends
 * it as X-Sdk-Token. Only camtech verifies them, so they are HS256 JWTs with
 * their own audience: they can never pass as a result token (RS256, JWKS).
 */
@Service
@Slf4j
public class SdkTokenService {

    public static final String AUDIENCE = "camtech-sdk";

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final CamtechProperties properties;
    private final ObjectMapper objectMapper;
    private final byte[] key;

    public SdkTokenService(CamtechProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.key = key(properties);
    }

    public record Issued(String token, Instant expiresAt) {
    }

    /** What a valid token allows: which app of which tenant, optionally for one user only. */
    public record Claims(Long tenantId, Long clientAppId, String clientAppCode, String subjectRef, Instant expiresAt) {
    }

    /** Issues a token for {@code app}; {@code ttlMinutes} null = the default, capped at the maximum. */
    public Issued issue(ClientApp app, String subjectRef, Integer ttlMinutes) {
        CamtechProperties.SdkToken cfg = properties.getSdkToken();
        int ttl = ttlMinutes == null ? cfg.getTtlMinutes() : ttlMinutes;
        if (ttl < 1 || ttl > cfg.getMaxTtlMinutes()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                    "ttlMinutes must be between 1 and " + cfg.getMaxTtlMinutes());
        }
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(ttl * 60L);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", properties.getResultToken().getIssuer());
        payload.put("aud", AUDIENCE);
        payload.put("ten", app.getTenantId());
        payload.put("app", app.getId());
        payload.put("apc", app.getCode());
        if (subjectRef != null) {
            payload.put("sub", subjectRef);
        }
        payload.put("iat", now.getEpochSecond());
        payload.put("exp", exp.getEpochSecond());
        payload.put("jti", UUID.randomUUID().toString());
        try {
            String signingInput = B64.encodeToString(objectMapper.writeValueAsBytes(Map.of("alg", "HS256", "typ", "JWT")))
                    + "." + B64.encodeToString(objectMapper.writeValueAsBytes(payload));
            Issued issued = new Issued(signingInput + "." + B64.encodeToString(hmac(signingInput)), exp);
            log.info("SDK token issued for app {} (tenant {}), ttl {} min, bound to a user: {}", app.getCode(),
                    app.getTenantId(), ttl, subjectRef != null);
            return issued;
        } catch (Exception e) {
            throw new IllegalStateException("Could not sign the SDK token", e);
        }
    }

    /** Checks signature, issuer, audience and expiry; throws 401 SDK_TOKEN_INVALID otherwise. */
    public Claims verify(String token) {
        String[] parts = token == null ? new String[0] : token.trim().split("\\.");
        if (parts.length != 3) {
            throw invalid();
        }
        try {
            if (!MessageDigest.isEqual(hmac(parts[0] + "." + parts[1]), B64D.decode(parts[2]))) {
                throw invalid();
            }
            Map<String, Object> header = objectMapper.readValue(B64D.decode(parts[0]), new TypeReference<>() {
            });
            Map<String, Object> claims = objectMapper.readValue(B64D.decode(parts[1]), new TypeReference<>() {
            });
            if (!"HS256".equals(header.get("alg")) || !AUDIENCE.equals(claims.get("aud"))
                    || !properties.getResultToken().getIssuer().equals(claims.get("iss"))) {
                throw invalid();
            }
            Instant exp = Instant.ofEpochSecond(((Number) claims.get("exp")).longValue());
            if (!exp.isAfter(Instant.now())) {
                log.debug("SDK token for app {} expired at {}", claims.get("apc"), exp);
                throw new FaceMatchException(HttpStatus.UNAUTHORIZED, "SDK_TOKEN_EXPIRED",
                        "This link has expired. Please start again.");
            }
            Claims result = new Claims(((Number) claims.get("ten")).longValue(), ((Number) claims.get("app")).longValue(),
                    (String) claims.get("apc"), (String) claims.get("sub"), exp);
            log.debug("SDK token verified for app {} (tenant {})", result.clientAppCode(), result.tenantId());
            return result;
        } catch (FaceMatchException e) {
            throw e;
        } catch (Exception e) {
            log.debug("SDK token could not be parsed: {}", e.getClass().getSimpleName());
            throw invalid();
        }
    }

    private byte[] hmac(String input) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(input.getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] key(CamtechProperties properties) {
        String secret = properties.getSdkToken().getSecret();
        if (secret == null || secret.isBlank()) {
            String resultKey = properties.getResultToken().getPrivateKey();
            if (resultKey == null || resultKey.isBlank()) {
                log.warn("Neither camtech.sdk-token.secret nor the result-token key is set: SDK tokens use a key "
                        + "generated at startup and stop working after a restart. Set a key outside local development.");
                return Secrets.token(32).getBytes(StandardCharsets.US_ASCII);
            }
            secret = "camtech-sdk-token|" + resultKey.replaceAll("\\s", "");
        }
        try {
            return MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static FaceMatchException invalid() {
        return new FaceMatchException(HttpStatus.UNAUTHORIZED, "SDK_TOKEN_INVALID", "The SDK token is not valid");
    }
}
