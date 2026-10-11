package com.facetech.backend.dto.response;

import com.facetech.backend.model.DocumentType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DocumentScanResponse {
    private boolean success;
    private String scanId;
    private DocumentType documentType;
    /** COMPLETED (values can be used) or NEEDS_REVIEW (a person must confirm them first). */
    private String status;
    private boolean reviewRequired;
    private List<ReviewReason> reviewReasons;
    /** Problems with the document as a whole, e.g. EXPIRED, SIDES_MISMATCH. */
    private List<String> issues;
    private BigDecimal confidence;
    private Map<String, Object> fields;
    /** Per field: VALID, UNVERIFIED, MISMATCH, INVALID or MISSING, where it was read, and why. */
    private Map<String, FieldValidation> validations;
    private String rawText;
    private String message;
    private Long processingTimeMs;

    public record FieldValidation(String status, String source, String message) {
    }

    public record ReviewReason(String code, String field, String message) {
    }
}
