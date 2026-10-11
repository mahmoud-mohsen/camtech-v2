package com.facetech.backend.platform.storage;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;

/**
 * Object keys (without file extension) for everything camtech stores. One
 * folder per case under the root folder, then per day and per verification:
 *
 * <pre>
 * camtech/
 *   selfie-verifications/2026/10/08/{sessionId}/liveness/attempt-1-normal.jpg
 *   selfie-verifications/2026/10/08/{sessionId}/liveness/attempt-1-closer.jpg
 *   selfie-verifications/2026/10/08/{sessionId}/document/attempt-1-front.jpg
 *   face-authentications/2026/10/08/{sessionId}/liveness/attempt-1-normal.jpg
 *   document-scans/2026/10/08/{scanId}/document.jpg
 *   onboarding/{personId}/face/front-3f2a9c1e.jpg
 *   onboarding/{personId}/emirates-id/front-3f2a9c1e.jpg
 *   onboarding/{personId}/passport/photo-page-3f2a9c1e.jpg
 *   face-compare/2026/10/08/{uuid}/image-a.jpg
 * </pre>
 */
public final class MediaKeys {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy/MM/dd").withZone(ZoneOffset.UTC);

    private MediaKeys() {
    }

    public static String flowFolder(String flowCode) {
        return switch (flowCode) {
            case "SELFIE_ID_VERIFICATION" -> "selfie-verifications";
            case "FACE_AUTHENTICATION" -> "face-authentications";
            case "LIVENESS_CHECK" -> "liveness-checks";
            case "FACE_ENROLLMENT" -> "face-enrollments";
            case "ONBOARDING" -> "onboarding";
            default -> flowCode.toLowerCase(Locale.ROOT).replace('_', '-');
        };
    }

    /** {@code <flow>/yyyy/MM/dd/<sessionId>/<part>/attempt-<n>-<name>} */
    public static String sessionFile(String flowCode, Instant sessionCreated, String sessionId, String part,
                                     int attempt, String name) {
        return flowFolder(flowCode) + "/" + DAY.format(sessionCreated) + "/" + sessionId + "/" + part
                + "/attempt-" + attempt + "-" + slug(name);
    }

    /** {@code document-scans/yyyy/MM/dd/<scanId>/document} */
    public static String scanFile(Instant created, String scanId) {
        return "document-scans/" + DAY.format(created) + "/" + scanId + "/document";
    }

    /** {@code onboarding/<personId>/<part>/<name>-<random>} */
    public static String onboardingFile(String partyPublicId, String part, String name) {
        return "onboarding/" + partyPublicId + "/" + slug(part) + "/" + slug(name) + "-" + shortId();
    }

    /** {@code face-compare/yyyy/MM/dd/<random>/<name>} for stateless comparisons that are kept for audit. */
    public static String compareFile(Instant at, String batchId, String name) {
        return "face-compare/" + DAY.format(at) + "/" + batchId + "/" + slug(name);
    }

    public static String shortId() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static String slug(String s) {
        return s.toLowerCase(Locale.ROOT).replace('_', '-').replaceAll("[^a-z0-9-]", "");
    }
}
