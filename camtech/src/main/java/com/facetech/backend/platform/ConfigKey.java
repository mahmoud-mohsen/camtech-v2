package com.facetech.backend.platform;

import java.util.List;

/**
 * Every setting camtech reads from config_param, with its type, default and
 * allowed range. The back-office edits values; this catalogue is the
 * fallback when no row matches and the validation rule for new values.
 */
public enum ConfigKey {

    SESSION_TTL_MINUTES("session.ttl_minutes", Type.INTEGER, "15", 1.0, 1440.0,
            "Minutes a verification stays open"),
    FACE_DOC_MATCH_SIMILARITY("face.doc_match_similarity", Type.NUMBER, "0.40", -1.0, 1.0,
            "Selfie vs document photo: cosine similarity at or above this is a match"),
    FACE_REVIEW_SIMILARITY("face.review_similarity", Type.NUMBER, "0.28", -1.0, 1.0,
            "Selfie vs document photo: at or above this (and below the match value) needs a review"),
    FACE_EXCELLENT_SIMILARITY("face.excellent_similarity", Type.NUMBER, "0.70", -1.0, 1.0,
            "Similarity that maps to the top of the 0-100 score"),
    FACE_TEMPLATE_MATCH_SIMILARITY("face.template_match_similarity", Type.NUMBER, "0.50", -1.0, 1.0,
            "Face authentication: selfie vs enrolled face, at or above this is a match"),
    LIVENESS_MIN_SAME_PERSON_SIMILARITY("liveness.min_same_person_similarity", Type.NUMBER, "0.5", -1.0, 1.0,
            "Normal vs closer selfie must be at least this similar"),
    LIVENESS_MIN_CLOSER_AREA_GAIN("liveness.min_closer_area_gain", Type.NUMBER, "1.1", 1.0, 5.0,
            "The face must grow by at least this factor (area) in the closer selfie or the MOVE_CLOSER challenge"),
    LIVENESS_MIN_DEVICE_ANTISPOOF("liveness.min_device_antispoof", Type.NUMBER, "0.3", 0.0, 1.0,
            "Minimum anti-spoof score reported by the device (0-1)"),
    LIVENESS_DEVICE_ANTISPOOF_REQUIRED("liveness.device_antispoof_required", Type.BOOLEAN, "false", null, null,
            "Reject liveness uploads that do not include a device anti-spoof score"),
    LIVENESS_MODE("liveness.mode", Type.STRING, "ACTIVE", null, null,
            "Tenant setting per flow: PASSIVE (anti-spoof model only) or ACTIVE (random challenge required)"),
    LIVENESS_CHALLENGE_ACTIONS("liveness.challenge_actions", Type.LIST,
            "TURN_LEFT,TURN_RIGHT,BLINK,LOOK_UP,LOOK_DOWN,SMILE,MOVE_CLOSER", null, null,
            "Tenant setting per flow: challenges a session draws from: TURN_LEFT, TURN_RIGHT, BLINK, LOOK_UP, LOOK_DOWN, SMILE, MOVE_CLOSER"),
    LIVENESS_CHALLENGE_STEPS("liveness.challenge_steps", Type.INTEGER, "2", 1.0, 7.0,
            "Tenant setting per flow: how many different challenges each user does, in random order"),
    LIVENESS_ALLOW_WITHOUT_CHALLENGE("liveness.allow_without_challenge", Type.BOOLEAN, "false", null, null,
            "Released apps without active-liveness support: accept uploads without a challenge (passive check required)"),
    LIVENESS_CHALLENGE_TTL_SECONDS("liveness.challenge_ttl_seconds", Type.INTEGER, "180", 30.0, 900.0,
            "Seconds a challenge stays valid after it is issued"),
    LIVENESS_TURN_MIN_YAW("liveness.turn_min_yaw", Type.NUMBER, "18", 5.0, 60.0,
            "Turn challenges: degrees the head must turn to the requested side"),
    LIVENESS_EYES_OPEN_MIN("liveness.eyes_open_min", Type.NUMBER, "0.24", 0.0, 1.0,
            "Blink challenge: eye aspect ratio at or above this counts as open"),
    LIVENESS_EYES_CLOSED_MAX("liveness.eyes_closed_max", Type.NUMBER, "0.21", 0.0, 1.0,
            "Blink challenge: eye aspect ratio at or below this counts as closed"),
    LIVENESS_LOOK_MIN_PITCH("liveness.look_min_pitch", Type.NUMBER, "15", 5.0, 45.0,
            "Look up / look down challenges: degrees the head must tilt up or down"),
    LIVENESS_SMILE_MIN_GAIN("liveness.smile_min_gain", Type.NUMBER, "1.10", 1.0, 2.0,
            "Smile challenge: the mouth must widen by at least this factor over the opening neutral frame"),
    LIVENESS_MAX_FACELESS_FRAMES("liveness.max_faceless_frames", Type.INTEGER, "1", 0.0, 5.0,
            "Challenge frames without a face tolerated in one attempt; more fails with FACE_NOT_VISIBLE"),
    LIVENESS_PASSIVE_REQUIRED("liveness.passive_required", Type.BOOLEAN, "false", null, null,
            "Refuse liveness when the passive anti-spoof model is not available (otherwise the check is skipped)"),
    LIVENESS_PASSIVE_MIN_SCORE("liveness.passive_min_score", Type.NUMBER, "0.55", 0.0, 1.0,
            "Passive anti-spoof: real-face score (0-1) the selfies must reach"),
    LIVENESS_KEEP_FAILED_MEDIA("liveness.keep_failed_media", Type.BOOLEAN, "true", null, null,
            "Keep the selfies of failed liveness attempts for audit and fraud analysis"),
    LIVENESS_MAX_ATTEMPTS("liveness.max_attempts", Type.INTEGER, null, 1.0, 20.0,
            "Liveness attempts per verification. Empty = the flow step setting"),
    DOCUMENT_MAX_ATTEMPTS("document.max_attempts", Type.INTEGER, null, 1.0, 20.0,
            "Document attempts per verification. Empty = the flow step setting"),
    DOCUMENT_FILE_UPLOAD_ALLOWED("document.file_upload_allowed", Type.BOOLEAN, "true", null, null,
            "Whether the app may let the user upload a document photo from the gallery instead of the camera"),
    DOCUMENT_OCR_REVIEW_MODE("document.ocr.review_mode", Type.STRING, "AUTO", null, null,
            "Server OCR scans: AUTO holds for review only scans that fail a check or score low, ALWAYS holds every scan, NEVER holds none (checks are still recorded)"),
    DOCUMENT_OCR_AUTO_ACCEPT_CONFIDENCE("document.ocr.auto_accept_confidence", Type.NUMBER, "0.85", 0.0, 1.0,
            "Server OCR scans: overall confidence (0-1) at or above which a scan with no failed check is accepted without review"),
    DOCUMENT_OCR_FIELD_MIN_CONFIDENCE("document.ocr.field_min_confidence", Type.NUMBER, "0.70", 0.0, 1.0,
            "Server OCR scans: every required field must reach this confidence (0-1), else the scan needs review"),
    DOCUMENT_OCR_REQUIRED_FIELDS("document.ocr.required_fields", Type.LIST, null, null, null,
            "Server OCR scans: fields every scan must yield, e.g. emiratesIdNumber,fullNameEn,dateOfBirth,expiryDate. Empty = the document's own"),
    DOCUMENT_OCR_ACCEPT_EXPIRED("document.ocr.accept_expired", Type.BOOLEAN, "false", null, null,
            "Server OCR scans: accept expired documents without review"),
    DOCUMENT_EXPIRY_WARNING_DAYS("document.expiry_warning_days", Type.INTEGER, "30", 1.0, 365.0,
            "Days before a document expires when the DOCUMENT_EXPIRING event is sent and the portal flags it"),
    REVIEW_OWNER("review.owner", Type.STRING, "TENANT", null, null,
            "Who decides verifications that need a person: TENANT (the tenant's reviewers, in the portal) or CAMTECH (camtech operators)"),
    DEDUP_ENABLED("dedup.enabled", Type.BOOLEAN, "true", null, null,
            "Search the new face against every other enrolled person after a match"),
    DEDUP_SIMILARITY("dedup.similarity", Type.NUMBER, "0.55", -1.0, 1.0,
            "Selfie vs another person's enrolled selfie: at or above this is flagged as a duplicate identity"),
    LEGACY_DISTANCE_THRESHOLD("face.legacy_distance_threshold", Type.NUMBER, "0.95", 0.0, 2.0,
            "Legacy /face/verify and /face/identify: Euclidean distance at or below this is a match");

    public enum Type { NUMBER, INTEGER, BOOLEAN, STRING, LIST }

    private final String key;
    private final Type type;
    private final String defaultValue;
    private final Double min;
    private final Double max;
    private final String description;

    ConfigKey(String key, Type type, String defaultValue, Double min, Double max, String description) {
        this.key = key;
        this.type = type;
        this.defaultValue = defaultValue;
        this.min = min;
        this.max = max;
        this.description = description;
    }

    public String key() {
        return key;
    }

    public Type type() {
        return type;
    }

    public String defaultValue() {
        return defaultValue;
    }

    public Double min() {
        return min;
    }

    public Double max() {
        return max;
    }

    public String description() {
        return description;
    }

    public static ConfigKey fromKey(String key) {
        for (ConfigKey k : values()) {
            if (k.key.equals(key)) {
                return k;
            }
        }
        return null;
    }

    /** @return null when valid, otherwise a message for the user */
    public String validate(String value) {
        if (value == null || value.isBlank()) {
            return "A value is required";
        }
        String v = value.trim();
        switch (type) {
            case BOOLEAN -> {
                if (!v.equals("true") && !v.equals("false")) {
                    return "Use true or false";
                }
            }
            case INTEGER, NUMBER -> {
                double d;
                try {
                    d = type == Type.INTEGER ? Integer.parseInt(v) : Double.parseDouble(v);
                } catch (NumberFormatException e) {
                    return type == Type.INTEGER ? "Use a whole number" : "Use a number";
                }
                if (min != null && d < min) {
                    return "Must be at least " + strip(min);
                }
                if (max != null && d > max) {
                    return "Must be at most " + strip(max);
                }
            }
            case STRING -> {
                if (this == LIVENESS_MODE && !LIVENESS_MODES.contains(v)) {
                    return "Use " + String.join(" or ", LIVENESS_MODES);
                }
                if (this == DOCUMENT_OCR_REVIEW_MODE && !OCR_REVIEW_MODES.contains(v)) {
                    return "Use " + String.join(", ", OCR_REVIEW_MODES);
                }
                if (this == REVIEW_OWNER && !REVIEW_OWNERS.contains(v)) {
                    return "Use " + String.join(" or ", REVIEW_OWNERS);
                }
            }
            case LIST -> {
                if (this == DOCUMENT_OCR_REQUIRED_FIELDS) {
                    for (String item : v.split(",")) {
                        if (!item.trim().matches("[A-Za-z][A-Za-z0-9]{1,60}")) {
                            return "Use a comma-separated list of field names, e.g. emiratesIdNumber,fullNameEn";
                        }
                    }
                }
                if (this == LIVENESS_CHALLENGE_ACTIONS) {
                    for (String item : v.split(",")) {
                        if (!CHALLENGE_ACTIONS.contains(item.trim())) {
                            return "Use a comma-separated list of " + String.join(", ", CHALLENGE_ACTIONS);
                        }
                    }
                }
            }
            default -> {
            }
        }
        return null;
    }

    /** Actions an active-liveness challenge can ask for, in display order. */
    public static final List<String> CHALLENGE_ACTIONS = List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE",
            "MOVE_CLOSER");

    /** How server OCR scans are held for review. */
    public static final List<String> OCR_REVIEW_MODES = List.of("AUTO", "ALWAYS", "NEVER");

    /** Who decides verification review cases. */
    public static final List<String> REVIEW_OWNERS = List.of("TENANT", "CAMTECH");

    /** Liveness modes of a flow. */
    public static final List<String> LIVENESS_MODES = List.of("PASSIVE", "ACTIVE");

    private static String strip(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }
}
