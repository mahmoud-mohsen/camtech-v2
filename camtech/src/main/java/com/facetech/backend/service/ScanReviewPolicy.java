package com.facetech.backend.service;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.platform.DocumentOcrSettingsService.OcrSettings;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Decides whether a parsed document can be accepted on its own or needs a person to look at it.
 * Pure: the tenant's settings come in, the decision goes out.
 */
public final class ScanReviewPolicy {

    private ScanReviewPolicy() {
    }

    /** One reason a scan is held. {@code field} is null for reasons about the whole document. */
    public record Reason(String code, String field, String message) {

        /** "CODE|field|message", one per line in document_scan.review_reasons. */
        String encode() {
            return code + "|" + (field == null ? "" : field) + "|" + (message == null ? "" : message.replace('\n', ' ').replace('|', '/'));
        }

        static Reason decode(String line) {
            String[] p = line.split("\\|", 3);
            return new Reason(p[0], p.length > 1 && !p[1].isEmpty() ? p[1] : null, p.length > 2 && !p[2].isEmpty() ? p[2] : null);
        }
    }

    /**
     * @param reviewRequired the scan waits for a person (status NEEDS_REVIEW)
     * @param reasons        why; kept even when the mode is NEVER, so the portal can still show them
     */
    public record Decision(boolean reviewRequired, List<Reason> reasons) {
    }

    public static Decision evaluate(DocumentFieldsDto dto, OcrSettings settings) {
        String mode = settings.reviewMode() == null ? "AUTO" : settings.reviewMode().toUpperCase(Locale.ROOT);
        List<Reason> reasons = new ArrayList<>();
        // Parsers without validation (passport, trade licence) are not judged: their scores are not comparable.
        if (dto.validated()) {
            collect(dto, settings, reasons);
        }
        boolean review = switch (mode) {
            case "ALWAYS" -> true;
            case "NEVER" -> false;
            default -> !reasons.isEmpty();
        };
        if ("ALWAYS".equals(mode) && reasons.isEmpty()) {
            reasons.add(new Reason("ALWAYS_REVIEW", null, "Every scan is reviewed (tenant setting)"));
        }
        return new Decision(review, reasons);
    }

    private static void collect(DocumentFieldsDto dto, OcrSettings settings, List<Reason> reasons) {
        Map<String, DocumentFieldsDto.FieldCheck> checks = dto.getChecks();
        Set<String> required = new LinkedHashSet<>(settings.requiredFields().isEmpty()
                ? dto.getRequiredFields() : settings.requiredFields());
        for (String field : required) {
            DocumentFieldsDto.FieldCheck check = checks.get(field);
            Object value = dto.getFields().get(field);
            if (check == null || "MISSING".equals(check.status()) || value == null) {
                reasons.add(new Reason("FIELD_MISSING", field, "Not read from the document"));
                continue;
            }
            double confidence = confidence(dto, field);
            if (!"INVALID".equals(check.status()) && !"MISMATCH".equals(check.status())
                    && confidence < settings.fieldMinConfidence()) {
                reasons.add(new Reason("FIELD_LOW_CONFIDENCE", field, String.format(Locale.ROOT,
                        "Confidence %.2f is below %.2f", confidence, settings.fieldMinConfidence())));
            }
        }
        // A value that fails its own checks is wrong wherever it is, required or not.
        checks.forEach((field, check) -> {
            if ("INVALID".equals(check.status())) {
                reasons.add(new Reason("FIELD_INVALID", field, check.message()));
            } else if ("MISMATCH".equals(check.status())) {
                reasons.add(new Reason("FIELD_MISMATCH", field, check.message()));
            }
        });
        for (String issue : dto.getIssues()) {
            switch (issue) {
                case "EXPIRED" -> {
                    if (!settings.acceptExpired()) {
                        reasons.add(new Reason("EXPIRED", "expiryDate", "The document has expired"));
                    }
                }
                case "SIDES_MISMATCH" -> reasons.add(new Reason("SIDES_MISMATCH", null,
                        "The front and the back do not belong to the same card"));
                case "MRZ_NOT_VERIFIED" -> reasons.add(new Reason("MRZ_NOT_VERIFIED", null,
                        "The machine-readable zone was read but its check digits do not all match"));
                default -> reasons.add(new Reason(issue, null, null));
            }
        }
        BigDecimal overall = dto.getOverallConfidence();
        if (overall == null || overall.doubleValue() < settings.autoAcceptConfidence()) {
            reasons.add(new Reason("LOW_CONFIDENCE", null, String.format(Locale.ROOT,
                    "Overall confidence %.2f is below %.2f", overall == null ? 0 : overall.doubleValue(),
                    settings.autoAcceptConfidence())));
        }
    }

    private static double confidence(DocumentFieldsDto dto, String field) {
        Object c = dto.getFields().get(field + "_confidence");
        return c instanceof BigDecimal b ? b.doubleValue() : c instanceof Number n ? n.doubleValue() : 0;
    }

    public static String encode(List<Reason> reasons) {
        if (reasons.isEmpty()) {
            return null;
        }
        String joined = String.join("\n", reasons.stream().map(Reason::encode).toList());
        return joined.length() > 4000 ? joined.substring(0, 4000) : joined;
    }

    public static List<Reason> decode(String stored) {
        if (stored == null || stored.isBlank()) {
            return List.of();
        }
        return stored.lines().filter(l -> !l.isBlank()).map(Reason::decode).toList();
    }
}
