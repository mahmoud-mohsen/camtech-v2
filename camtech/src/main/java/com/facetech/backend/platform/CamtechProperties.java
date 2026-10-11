package com.facetech.backend.platform;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/** Service-level settings ({@code camtech.*} in application.yml). Tenant settings live in config_param. */
@Data
@ConfigurationProperties(prefix = "camtech")
public class CamtechProperties {

    /** The tenant every request belongs to while camtech runs single-tenant. */
    private String tenantCode = "NOQODI";

    private Security security = new Security();
    private ResultToken resultToken = new ResultToken();
    private Backoffice backoffice = new Backoffice();
    private Jobs jobs = new Jobs();
    private SdkToken sdkToken = new SdkToken();
    private List<String> corsAllowedOrigins = new ArrayList<>(List.of("*"));

    @Data
    public static class SdkToken {
        /** Default lifetime of a token from POST /v2/sdk-tokens. */
        private int ttlMinutes = 30;
        /** Longest lifetime a caller may ask for. */
        private int maxTtlMinutes = 60;
        /**
         * HMAC key for SDK tokens (only camtech verifies them). Empty = derived from the result-token
         * private key, so every instance with the same key accepts the same tokens.
         */
        private String secret = "";
    }

    @Data
    public static class Security {
        /** When false, calls without X-Client-Id / X-Client-Secret run as {@link #defaultClientApp}. */
        private boolean requireClientCredentials = false;
        /** When false, session calls without "Authorization: Bearer <sessionToken>" are accepted. */
        private boolean requireSessionToken = false;
        private String defaultClientApp = "MOBILE_APP";
    }

    @Data
    public static class ResultToken {
        private String issuer = "camtech";
        private int ttlMinutes = 10;
        private String keyId = "camtech-1";
        /** PKCS#8 RSA private key (PEM or base64). Empty = a key is generated at startup (dev only). */
        private String privateKey = "";
    }

    @Data
    public static class Backoffice {
        /** Password for the first "admin" user. Empty = generated and written to the log once. */
        private String adminPassword = "";
        private int sessionHours = 8;
        private int maxFailedLogins = 5;
        private int lockMinutes = 15;
    }

    @Data
    public static class Jobs {
        private long sessionExpiryMs = 60_000;
        private long webhookRelayMs = 5_000;
        private String retentionCron = "0 30 2 * * *";
        private int webhookTimeoutSeconds = 10;
        private int webhookMaxAttempts = 6;
    }
}
