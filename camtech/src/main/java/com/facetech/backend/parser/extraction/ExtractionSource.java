package com.facetech.backend.parser.extraction;

/**
 * Where a field value was read, with how much that way of reading is trusted before validation.
 * A check digit or checksum that matches raises a value above its source; see {@link FieldResolution}.
 */
public enum ExtractionSource {
    /** MRZ value whose ICAO check digit matched. */
    MRZ_VERIFIED(0.99),
    /** Value found next to its label using the OCR layout (positions on the card). */
    LAYOUT(0.90),
    /** Value found after its label in the OCR text. */
    LABEL(0.85),
    /** MRZ value without a check digit (name, sex) or whose check digit did not match. */
    MRZ(0.75),
    /** Value matched by its format alone, anywhere in the text. */
    PATTERN(0.70),
    /** Value guessed from its position among others (e.g. the latest date is the expiry). */
    INFERRED(0.50),
    /** Value entered or confirmed by a reviewer. */
    REVIEW(1.0);

    private final double weight;

    ExtractionSource(double weight) {
        this.weight = weight;
    }

    public double weight() {
        return weight;
    }
}
