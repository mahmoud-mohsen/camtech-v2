package com.facetech.backend.platform;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Signs verification results as RS256 JWTs. The app forwards the token to
 * its own backend, which checks the signature with the public key from
 * {@code GET /v2/.well-known/jwks.json}, so the result cannot be forged on
 * the device.
 */
@Service
@Slf4j
public class ResultTokenService {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private final CamtechProperties.ResultToken settings;
    private final ObjectMapper objectMapper;
    private final PrivateKey privateKey;
    private final RSAPublicKey publicKey;

    public ResultTokenService(CamtechProperties properties, ObjectMapper objectMapper) throws Exception {
        this.settings = properties.getResultToken();
        this.objectMapper = objectMapper;
        String pem = settings.getPrivateKey();
        if (pem == null || pem.isBlank()) {
            log.warn("camtech.result-token.private-key is not set: using a key generated at startup. "
                    + "Result tokens stop verifying after a restart and differ between instances. Set a key outside local development.");
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            KeyPair pair = gen.generateKeyPair();
            this.privateKey = pair.getPrivate();
            this.publicKey = (RSAPublicKey) pair.getPublic();
        } else {
            String body = pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
            KeyFactory kf = KeyFactory.getInstance("RSA");
            this.privateKey = kf.generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(body)));
            RSAPrivateCrtKey crt = (RSAPrivateCrtKey) privateKey;
            this.publicKey = (RSAPublicKey) kf.generatePublic(new RSAPublicKeySpec(crt.getModulus(), crt.getPublicExponent()));
        }
        log.info("Result tokens: issuer {}, key id {}, ttl {} min", settings.getIssuer(), settings.getKeyId(),
                settings.getTtlMinutes());
    }

    public record Issued(String token, String jti, Instant expiresAt) {
    }

    /** Signs {@code claims} plus iss, iat, exp and jti. */
    public Issued issue(Map<String, Object> claims) {
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(settings.getTtlMinutes() * 60L);
        String jti = UUID.randomUUID().toString();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", settings.getIssuer());
        payload.putAll(claims);
        payload.put("iat", now.getEpochSecond());
        payload.put("exp", exp.getEpochSecond());
        payload.put("jti", jti);
        Map<String, Object> header = Map.of("alg", "RS256", "typ", "JWT", "kid", settings.getKeyId());
        try {
            String signingInput = B64.encodeToString(objectMapper.writeValueAsBytes(header)) + "."
                    + B64.encodeToString(objectMapper.writeValueAsBytes(payload));
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initSign(privateKey);
            sig.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            Issued issued = new Issued(signingInput + "." + B64.encodeToString(sig.sign()), jti, exp);
            log.debug("Result token {} issued, expires {}", jti, exp);
            return issued;
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialise result token", e);
        } catch (Exception e) {
            throw new IllegalStateException("Could not sign result token", e);
        }
    }

    /** JWKS document with the public key. */
    public Map<String, Object> jwks() {
        Map<String, Object> key = new LinkedHashMap<>();
        key.put("kty", "RSA");
        key.put("use", "sig");
        key.put("alg", "RS256");
        key.put("kid", settings.getKeyId());
        key.put("n", B64.encodeToString(unsigned(publicKey.getModulus())));
        key.put("e", B64.encodeToString(unsigned(publicKey.getPublicExponent())));
        return Map.of("keys", List.of(key));
    }

    /** Verifies a token signed by this service and returns its claims (used by tests and support tools). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> verify(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Not a JWT");
        }
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(publicKey);
            sig.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!sig.verify(Base64.getUrlDecoder().decode(parts[2]))) {
                throw new IllegalArgumentException("Bad signature");
            }
            return objectMapper.readValue(Base64.getUrlDecoder().decode(parts[1]), Map.class);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid token", e);
        }
    }

    private static byte[] unsigned(BigInteger value) {
        byte[] bytes = value.toByteArray();
        if (bytes.length > 1 && bytes[0] == 0) {
            byte[] trimmed = new byte[bytes.length - 1];
            System.arraycopy(bytes, 1, trimmed, 0, trimmed.length);
            return trimmed;
        }
        return bytes;
    }
}
