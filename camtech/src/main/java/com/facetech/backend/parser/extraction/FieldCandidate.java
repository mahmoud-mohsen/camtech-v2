package com.facetech.backend.parser.extraction;

/** One possible value of a field and where it was read. */
public record FieldCandidate(String value, ExtractionSource source) {
}
