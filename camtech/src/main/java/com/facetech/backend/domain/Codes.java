package com.facetech.backend.domain;

/**
 * Status and type values stored as text. Kept as enums so a typo is a
 * compile error; the database CHECK constraints list the same values.
 */
public final class Codes {

    private Codes() {
    }

    public enum Channel { MOBILE, WEB, ADMIN }

    public enum ActiveStatus { ACTIVE, DISABLED }

    public enum FeatureType { FLOW, DOCUMENT, FEATURE }

    public enum SessionStatus {
        CREATED, IN_PROGRESS, COMPLETED, EXPIRED, FAILED, CANCELLED;

        public boolean isOpen() {
            return this == CREATED || this == IN_PROGRESS;
        }
    }

    /** Fine-grained position inside the selfie ID verification flow. */
    public enum Stage {
        CREATED, LIVENESS_FAILED, LIVENESS_PASSED, VERIFIED_MATCH, VERIFIED_REVIEW, VERIFIED_NO_MATCH
    }

    public enum Decision { APPROVED, REVIEW, REJECTED }

    public enum DecidedBy { SYSTEM, USER }

    public enum StepStatus { PENDING, IN_PROGRESS, PASSED, FAILED, REVIEW, SKIPPED }

    public enum CheckOutcome { PASS, REVIEW, FAIL, SKIPPED }

    public enum PartyType { PERSON, ORG }

    public enum DocumentStatus { CAPTURED, VERIFIED, EXPIRED, REJECTED }

    public enum FieldSource { CLIENT_OCR, SERVER_OCR, MRZ, MANUAL }

    /** COMPLETED = values accepted (automatically or by a reviewer); NEEDS_REVIEW = held until a person decides. */
    public enum ScanStatus { PENDING, PROCESSING, COMPLETED, NEEDS_REVIEW, REJECTED, FAILED }

    public enum TemplateRole { SELFIE, DOCUMENT }

    public enum TemplateStatus { SESSION, ENROLLED, REVOKED }

    public enum MediaCategory { FAILED_ATTEMPT_MEDIA, VERIFIED_MEDIA, SCAN_ONLY_MEDIA }

    public enum ReviewStatus {
        OPEN, IN_REVIEW, APPROVED, REJECTED;

        public boolean isClosed() {
            return this == APPROVED || this == REJECTED;
        }
    }

    public enum ReviewActionType { OPENED, ASSIGNED, COMMENTED, APPROVED, REJECTED }

    public enum OutboxStatus { PENDING, SENT, FAILED }

    public enum DeliveryStatus { PENDING, DELIVERED, RETRYING, FAILED }

    public enum ActorType { CLIENT, ADMIN, SYSTEM, TENANT }

    public enum AdminRole { ADMIN, REVIEWER, VIEWER }

    /** Tenant portal roles. OWNER can do everything; the others are not ranked (see TenantAccess). */
    public enum TenantRole { OWNER, DEVELOPER, REVIEWER, VIEWER }

    public enum CredentialStatus { ACTIVE, REVOKED }

    public enum ChallengeStatus { ISSUED, USED }

    /** PASSIVE = anti-spoof model only, no challenge; ACTIVE = a random challenge is required. */
    public enum LivenessMode { PASSIVE, ACTIVE }

    /** Step codes. */
    public static final String LIVENESS = "LIVENESS";
    public static final String DOC_CAPTURE = "DOC_CAPTURE";
    public static final String DOC_VALIDATION = "DOC_VALIDATION";
    public static final String FACE_DOC_MATCH = "FACE_DOC_MATCH";
    public static final String FACE_TEMPLATE_MATCH = "FACE_TEMPLATE_MATCH";
    public static final String DEDUP_SEARCH = "DEDUP_SEARCH";

    /** Flow codes. */
    public static final String FLOW_SELFIE_ID = "SELFIE_ID_VERIFICATION";
    public static final String FLOW_FACE_AUTH = "FACE_AUTHENTICATION";
    public static final String FLOW_ONBOARDING = "ONBOARDING";
    public static final String FLOW_DOCUMENT_SCAN = "DOCUMENT_SCAN";
    public static final String FLOW_FACE_IDENTIFICATION = "FACE_IDENTIFICATION";
    /** Liveness check: liveness selfies only, no document, nothing registered. */
    public static final String FLOW_LIVENESS_CHECK = "LIVENESS_CHECK";
    /**
     * Face registration: liveness selfies, then the face is registered for the person. The entitlement also
     * allows a selfie ID verification to register the face ({@code enrollFace}).
     */
    public static final String FLOW_FACE_ENROLLMENT = "FACE_ENROLLMENT";

    /** Feature codes (entitlement type FEATURE). */
    public static final String FEATURE_DEDUP = "DEDUP_SEARCH";
    public static final String FEATURE_MANUAL_REVIEW = "MANUAL_REVIEW";
    public static final String FEATURE_WEBHOOKS = "WEBHOOKS";
    public static final String FEATURE_FACE_COMPARE = "FACE_COMPARE";
    public static final String FEATURE_SERVER_OCR = "SERVER_OCR";

    /** Outbox / webhook event types. */
    public static final String EVENT_SESSION_COMPLETED = "SESSION_COMPLETED";
    public static final String EVENT_SESSION_EXPIRED = "SESSION_EXPIRED";
    public static final String EVENT_REVIEW_OPENED = "REVIEW_OPENED";
    public static final String EVENT_REVIEW_DECIDED = "REVIEW_DECIDED";
    public static final String EVENT_SCAN_REVIEW_REQUIRED = "SCAN_REVIEW_REQUIRED";
    public static final String EVENT_SCAN_REVIEW_DECIDED = "SCAN_REVIEW_DECIDED";
    public static final String EVENT_DOCUMENT_EXPIRING = "DOCUMENT_EXPIRING";
    public static final String EVENT_PARTY_ERASED = "PARTY_ERASED";
    public static final String EVENT_WEBHOOK_TEST = "WEBHOOK_TEST";
}
