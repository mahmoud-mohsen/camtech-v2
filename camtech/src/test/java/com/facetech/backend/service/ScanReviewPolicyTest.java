package com.facetech.backend.service;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.platform.DocumentOcrSettingsService.OcrSettings;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScanReviewPolicyTest {

    private static final OcrSettings AUTO = new OcrSettings("AUTO", 0.85, 0.70, List.of(), false);

    @Test
    void cleanScanIsAccepted() {
        ScanReviewPolicy.Decision d = ScanReviewPolicy.evaluate(dto(0.95, "VALID", 0.97), AUTO);

        assertFalse(d.reviewRequired());
        assertTrue(d.reasons().isEmpty());
    }

    @Test
    void invalidFieldNeedsReviewEvenWithHighOverallScore() {
        DocumentFieldsDto dto = dto(0.95, "VALID", 0.97);
        dto.addCheck("dateOfBirth", new DocumentFieldsDto.FieldCheck("LABEL", "INVALID", "Birth date is in the future"));

        ScanReviewPolicy.Decision d = ScanReviewPolicy.evaluate(dto, AUTO);

        assertTrue(d.reviewRequired());
        assertEquals("FIELD_INVALID", d.reasons().get(0).code());
        assertEquals("dateOfBirth", d.reasons().get(0).field());
    }

    @Test
    void lowScoresNeedReview() {
        ScanReviewPolicy.Decision d = ScanReviewPolicy.evaluate(dto(0.60, "VALID", 0.50), AUTO);

        assertTrue(d.reviewRequired());
        List<String> codes = d.reasons().stream().map(ScanReviewPolicy.Reason::code).toList();
        assertTrue(codes.contains("FIELD_LOW_CONFIDENCE"));
        assertTrue(codes.contains("LOW_CONFIDENCE"));
    }

    @Test
    void missingRequiredFieldNeedsReview() {
        DocumentFieldsDto dto = dto(0.95, "VALID", 0.97);
        OcrSettings strict = new OcrSettings("AUTO", 0.85, 0.70, List.of("emiratesIdNumber", "issueDate"), false);

        ScanReviewPolicy.Decision d = ScanReviewPolicy.evaluate(dto, strict);

        assertTrue(d.reviewRequired());
        assertEquals("FIELD_MISSING", d.reasons().get(0).code());
        assertEquals("issueDate", d.reasons().get(0).field());
    }

    @Test
    void expiredCardNeedsReviewUnlessTheTenantAcceptsIt() {
        DocumentFieldsDto dto = dto(0.95, "VALID", 0.97);
        dto.addIssue("EXPIRED");

        assertTrue(ScanReviewPolicy.evaluate(dto, AUTO).reviewRequired());
        assertFalse(ScanReviewPolicy.evaluate(dto, new OcrSettings("AUTO", 0.85, 0.70, List.of(), true)).reviewRequired());
    }

    @Test
    void modesOverrideTheChecks() {
        DocumentFieldsDto bad = dto(0.30, "INVALID", 0.2);
        ScanReviewPolicy.Decision never = ScanReviewPolicy.evaluate(bad, new OcrSettings("NEVER", 0.85, 0.70, List.of(), false));
        assertFalse(never.reviewRequired());
        assertFalse(never.reasons().isEmpty(), "reasons are kept for the portal");

        ScanReviewPolicy.Decision always = ScanReviewPolicy.evaluate(dto(0.95, "VALID", 0.97),
                new OcrSettings("ALWAYS", 0.85, 0.70, List.of(), false));
        assertTrue(always.reviewRequired());
        assertEquals("ALWAYS_REVIEW", always.reasons().get(0).code());
    }

    @Test
    void parsersWithoutValidationAreNotJudged() {
        DocumentFieldsDto passport = DocumentFieldsDto.builder().overallConfidence(BigDecimal.valueOf(0.4)).build();
        passport.addField("passportNumber", "A1234567");

        assertFalse(ScanReviewPolicy.evaluate(passport, AUTO).reviewRequired());
    }

    @Test
    void reasonsSurviveStorage() {
        List<ScanReviewPolicy.Reason> reasons = List.of(
                new ScanReviewPolicy.Reason("FIELD_INVALID", "emiratesIdNumber", "Bad | check\ndigit"),
                new ScanReviewPolicy.Reason("EXPIRED", null, null));

        List<ScanReviewPolicy.Reason> back = ScanReviewPolicy.decode(ScanReviewPolicy.encode(reasons));

        assertEquals(2, back.size());
        assertEquals("emiratesIdNumber", back.get(0).field());
        assertEquals("Bad / check digit", back.get(0).message());
        assertEquals("EXPIRED", back.get(1).code());
        assertEquals(null, back.get(1).field());
    }

    /** An Emirates ID front with the ID number in the given state and a name. */
    private static DocumentFieldsDto dto(double overall, String idStatus, double idConfidence) {
        DocumentFieldsDto dto = DocumentFieldsDto.builder().overallConfidence(BigDecimal.valueOf(overall)).build();
        dto.setRequiredFields(List.of("emiratesIdNumber", "fullNameEn"));
        dto.addField("emiratesIdNumber", "784-1990-1234567-6", BigDecimal.valueOf(idConfidence));
        dto.addCheck("emiratesIdNumber", new DocumentFieldsDto.FieldCheck("PATTERN", idStatus, null));
        dto.addField("fullNameEn", "Ahmed Ali Hassan", BigDecimal.valueOf(Math.min(idConfidence, 0.95)));
        dto.addCheck("fullNameEn", new DocumentFieldsDto.FieldCheck("LABEL", "UNVERIFIED", null));
        return dto;
    }
}
