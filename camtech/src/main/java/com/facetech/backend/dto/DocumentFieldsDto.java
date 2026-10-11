package com.facetech.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DocumentFieldsDto {
    @Builder.Default
    private Map<String, Object> fields = new HashMap<>();
    private BigDecimal overallConfidence;
    private String rawText;
    /** Per field: where it was read and how it was checked. Parsers that do not validate leave it empty. */
    @Builder.Default
    private Map<String, FieldCheck> checks = new LinkedHashMap<>();
    /** Problems with the document as a whole, e.g. EXPIRED or SIDES_MISMATCH (see the parser). */
    @Builder.Default
    private List<String> issues = new ArrayList<>();
    /** Fields this document must yield; the review policy uses them when the tenant names none. */
    @Builder.Default
    private List<String> requiredFields = new ArrayList<>();

    /**
     * @param source  ExtractionSource name, null when missing
     * @param status  ValidationStatus name
     * @param message why the status is not VALID, or what was cross-checked; may be null
     */
    public record FieldCheck(String source, String status, String message) {
    }

    public void addField(String key, Object value) {
        fields.put(key, value);
    }

    public void addField(String key, Object value, BigDecimal confidence) {
        fields.put(key, value);
        fields.put(key + "_confidence", confidence);
    }

    public void addCheck(String key, FieldCheck check) {
        checks.put(key, check);
    }

    public void addIssue(String issue) {
        if (!issues.contains(issue)) {
            issues.add(issue);
        }
    }

    /** Whether this result carries validation (only then can the review policy judge it). */
    public boolean validated() {
        return !checks.isEmpty();
    }
}
