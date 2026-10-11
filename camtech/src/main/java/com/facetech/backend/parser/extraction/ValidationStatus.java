package com.facetech.backend.parser.extraction;

/** Outcome of checking one extracted field. */
public enum ValidationStatus {
    /** Passed its checks (checksum, date rules, agreement with another source). */
    VALID,
    /** Read, but nothing can confirm it (free text such as an employer name). */
    UNVERIFIED,
    /** Well formed, but disagrees with another field or the other side of the card. */
    MISMATCH,
    /** Fails its own rules (bad checksum, impossible date): almost certainly misread. */
    INVALID,
    /** Expected on this document but not found. */
    MISSING
}
