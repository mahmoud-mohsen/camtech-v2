package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractDateAfterLabel;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class JafzaTradeLicenceExtractor {

    private static final Pattern LICENSE_NO = Pattern.compile("^\\d{5,8}$");
    private static final Pattern POBOX = Pattern.compile("(?i)p\\.?\\s*o\\.?\\s*box\\s*[:\\s]?\\s*(\\d{3,10})");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = normalized.split("\n");

        List<String> activities = extractActivities(lines);
        List<String> values = extractValueBlock(lines);

        addIfNotEmpty(result, "licenseNo", pick(values, 0));
        addIfNotEmpty(result, "companyName", pick(values, 1));
        addIfNotEmpty(result, "businessName", pick(values, 2));
        addIfNotEmpty(result, "legalType", pick(values, 3));
        addIfNotEmpty(result, "issueDate", firstNonEmpty(pick(values, 4), extractDateAfterLabel(normalized, "issue date", "تاريخ الإصدار")));
        addIfNotEmpty(result, "expiryDate", firstNonEmpty(pick(values, 5), extractDateAfterLabel(normalized, "expiry date", "تاريخ الإنتهاء", "تاريخ الإنتهاء")));
        addIfNotEmpty(result, "address", joinNonBlank(pick(values, 8), pick(values, 9)));
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(activities, extractArabicActivities(lines)));
        addIfNotEmpty(result, "poBox", extractPoBox(normalized));

        String manager = firstNonEmpty(pick(values, 7), findManagerName(lines, values));
        if (looksLikePersonName(manager)) {
            Map<String, String> member = new LinkedHashMap<>();
            member.put("nameEn", manager);
            member.put("role", "Manager");
            addIfNotEmpty(result, "licenseMembers", toPersonJson(List.of(member)));
        }

        addIfNotEmpty(result, "companyNameAr", extractArabicCompany(lines));
        addIfNotEmpty(result, "businessNameAr", extractArabicTradeName(lines));
        addIfNotEmpty(result, "legalTypeAr", extractArabicLegalType(lines));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("JAFZA trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private List<String> extractActivities(String[] lines) {
        int start = findLine(lines, "(?i)^activities$|النشاطات");
        int end = findLine(lines, "(?i)^license remarks$|ملاحظات الترخيص");
        if (start < 0 || end < 0 || end <= start) {
            return List.of();
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || line.matches("(?i)^license remarks$")) {
                continue;
            }
            if (line.matches(".*[A-Za-z].*") && line.length() > 4) {
                activities.add(line);
            }
        }
        return activities;
    }

    private List<String> extractArabicActivities(String[] lines) {
        int start = findLine(lines, "النشاطات");
        int end = findLine(lines, "ملاحظات الترخيص");
        if (start < 0 || end < 0 || end <= start) {
            return List.of();
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (arabicTextProcessor.containsArabic(line) && line.length() > 3) {
                activities.add(arabicTextProcessor.normalizeArabic(line));
            }
        }
        return activities;
    }

    private List<String> extractValueBlock(String[] lines) {
        int remarks = findLine(lines, "(?i)^license remarks$|ملاحظات الترخيص");
        if (remarks < 0) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        for (int i = remarks + 1; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.startsWith("CELEBRATING") || line.contains("Zoho") || line.contains("electronic")) {
                break;
            }
            if (line.matches("(?i)^the emirates$")) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*")) {
                break;
            }
            if (line.matches("(?i)^CN:\\d+$")) {
                continue;
            }
            if (LICENSE_NO.matcher(line).matches()
                    || line.matches(".*[A-Za-z].*")
                    || TradeLicenceParseSupport.SLASH_DATE.matcher(line).find()) {
                values.add(line);
            }
            if (values.size() >= 10) {
                break;
            }
        }
        return values;
    }

    private String findManagerName(String[] lines, List<String> values) {
        for (String value : values) {
            if (looksLikePersonName(value)) {
                return value;
            }
        }
        int managerIdx = findLine(lines, "(?i)name of manager|company manager|مدير الشركة|إسم مدير الشركة");
        if (managerIdx >= 0) {
            for (int i = managerIdx + 1; i < Math.min(managerIdx + 4, lines.length); i++) {
                String line = lines[i].trim();
                if (looksLikePersonName(line)) {
                    return line;
                }
            }
        }
        return "";
    }

    private String extractPoBox(String text) {
        Matcher matcher = POBOX.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return "";
    }

    private String extractArabicCompany(String[] lines) {
        int idx = findLine(lines, "صاحب الرخصة");
        if (idx >= 0 && idx + 1 < lines.length) {
            String next = lines[idx + 1].trim();
            if (arabicTextProcessor.containsArabic(next)) {
                return arabicTextProcessor.normalizeArabic(next);
            }
        }
        return "";
    }

    private String extractArabicTradeName(String[] lines) {
        int idx = findLine(lines, "الإسم التجاري");
        if (idx >= 0 && idx + 1 < lines.length) {
            String next = lines[idx + 1].trim();
            if (arabicTextProcessor.containsArabic(next)) {
                return arabicTextProcessor.normalizeArabic(next);
            }
        }
        return "";
    }

    private String extractArabicLegalType(String[] lines) {
        int idx = findLine(lines, "الشكل القانوني");
        if (idx >= 0 && idx + 1 < lines.length) {
            String next = lines[idx + 1].trim();
            if (arabicTextProcessor.containsArabic(next)) {
                return arabicTextProcessor.normalizeArabic(next);
            }
        }
        return "";
    }

    private boolean looksLikePersonName(String value) {
        return value != null
                && value.matches("^[A-Za-z][A-Za-z'\\-.\\s]{5,}$")
                && value.split("\\s+").length >= 2;
    }

    private String pick(List<String> values, int index) {
        return index < values.size() ? values.get(index) : "";
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String joinNonBlank(String... values) {
        StringBuilder sb = new StringBuilder();
        for (String value : values) {
            if (value == null || value.isBlank()) {
                continue;
            }
            if (looksLikePersonName(value)) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(", ");
            }
            sb.append(value.trim());
        }
        return sb.toString();
    }
}
