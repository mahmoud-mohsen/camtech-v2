package com.facetech.backend.parser.extraction;

/**
 * The value chosen for a field, how it was checked and how confident we are in it.
 *
 * @param value      chosen value, or null when the field is missing
 * @param source     where the chosen value was read, or null when missing
 * @param status     outcome of the checks
 * @param confidence 0..1
 * @param message    why the status is not VALID, or what was cross-checked; may be null
 */
public record FieldResolution(String value, ExtractionSource source, ValidationStatus status, double confidence,
                              String message) {

    public static FieldResolution missing(String message) {
        return new FieldResolution(null, null, ValidationStatus.MISSING, 0.0, message);
    }

    /**
     * Confidence of a value from its source and checks.
     *
     * @param strong  a checksum or check digit confirmed the value
     * @param agreed  another independent source read the same value
     */
    public static double confidence(ExtractionSource source, ValidationStatus status, boolean strong, boolean agreed) {
        double c = switch (status) {
            case VALID -> strong ? Math.max(0.97, source.weight()) : source.weight();
            case UNVERIFIED -> source.weight() * 0.85;
            case MISMATCH -> source.weight() * 0.5;
            case INVALID -> 0.2;
            case MISSING -> 0.0;
        };
        if (agreed && (status == ValidationStatus.VALID || status == ValidationStatus.UNVERIFIED)) {
            c = Math.max(c, 0.95);
        }
        return Math.round(Math.min(1.0, c) * 10_000) / 10_000.0;
    }
}
