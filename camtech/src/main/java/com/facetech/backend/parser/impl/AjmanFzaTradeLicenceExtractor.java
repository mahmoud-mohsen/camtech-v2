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
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLineFrom;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class AjmanFzaTradeLicenceExtractor {

    private static final Pattern LICENSE_NO = Pattern.compile("License No\\.\\s+(\\d{4,8})");
    private static final Pattern REGISTER_NO = Pattern.compile("Registration No\\.\\s+(\\d{4,8})");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Z0-9'\\-.\\s]{8,}$");
    private static final Pattern SHARE_PERCENT = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*%");
    private static final Pattern PASSPORT = Pattern.compile("^[A-Z]{1,2}\\d{6,10}$");
    private static final Pattern INLINE_SHAREHOLDER_ROW = Pattern.compile(
            "^(\\d+)\\s+(\\d+(?:\\.\\d+)?)\\s*%\\s+([A-Za-z]+)\\s+([A-Z]{1,2}\\d{6,10})\\s*$");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = normalized.split("\n");

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(normalized));
        addIfNotEmpty(result, "registerNo", extractRegisterNo(normalized));
        addIfNotEmpty(result, "companyName", extractTradeName(lines));
        addIfNotEmpty(result, "businessName", extractTradeName(lines));
        addIfNotEmpty(result, "companyNameAr", extractArabicTradeName(lines));
        addIfNotEmpty(result, "businessNameAr", extractArabicTradeName(lines));
        addIfNotEmpty(result, "legalType", extractLegalForm(lines));
        addIfNotEmpty(result, "legalTypeAr", extractArabicLegalForm(lines));
        addIfNotEmpty(result, "issueDate", extractDate(lines, "current issue date", "first issue date", "تاريخ الصدار"));
        addIfNotEmpty(result, "expiryDate", extractDate(lines, "expiry date", "تاريخ النتهاء", "تاريخ الانتهاء"));
        addIfNotEmpty(result, "manager", extractManager(lines));
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(extractActivities(lines), extractArabicActivities(lines)));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(extractShareholders(lines)));
        addIfNotEmpty(result, "address", extractAddress(lines));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Ajman FZA trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String extractLicenseNo(String text) {
        Matcher matcher = LICENSE_NO.matcher(text);
        return matcher.find() ? matcher.group(1) : "";
    }

    private String extractRegisterNo(String text) {
        Matcher matcher = REGISTER_NO.matcher(text);
        return matcher.find() ? matcher.group(1) : "";
    }

    private String extractTradeName(String[] lines) {
        int idx = findLine(lines, "(?i)trade name");
        if (idx < 0) {
            return "";
        }
        for (int i = idx; i < Math.min(idx + 3, lines.length); i++) {
            String cleaned = lines[i].replaceFirst("(?i).*trade name\\s*", "").trim();
            if (cleaned.contains(" - ")) {
                cleaned = cleaned.split(" - ")[0].trim();
            }
            if (cleaned.matches(".*[A-Za-z].*") && cleaned.length() > 3) {
                return cleaned;
            }
        }
        return "";
    }

    private String extractArabicTradeName(String[] lines) {
        int idx = findLine(lines, "(?i)trade name");
        if (idx < 0) {
            return "";
        }
        for (int i = idx; i < Math.min(idx + 4, lines.length); i++) {
            String line = lines[i].trim();
            if (arabicTextProcessor.containsArabic(line) && line.length() > 4) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractLegalForm(String[] lines) {
        int idx = findLine(lines, "(?i)legal form");
        if (idx < 0) {
            return "";
        }
        StringBuilder form = new StringBuilder();
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (line.matches(".*[A-Za-z].*") && !line.toLowerCase().contains("issue")) {
                if (!form.isEmpty()) {
                    form.append(' ');
                }
                form.append(line);
            } else if (!form.isEmpty()) {
                break;
            }
        }
        return form.toString().trim();
    }

    private String extractArabicLegalForm(String[] lines) {
        int idx = findLine(lines, "الشكل القانوني");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (arabicTextProcessor.containsArabic(line) && line.length() > 4) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractDate(String[] lines, String... labels) {
        for (String label : labels) {
            for (int i = 0; i < lines.length; i++) {
                if (!lines[i].toLowerCase().contains(label.toLowerCase())
                        && !lines[i].contains(label)) {
                    continue;
                }
                String sameLine = firstDate(lines[i]);
                if (!sameLine.isEmpty()) {
                    return normalizeDate(sameLine);
                }
                for (int j = i; j < Math.min(i + 3, lines.length); j++) {
                    String next = firstDate(lines[j]);
                    if (!next.isEmpty()) {
                        return normalizeDate(next);
                    }
                }
            }
        }
        return "";
    }

    private String extractManager(String[] lines) {
        int idx = findLine(lines, "(?i)\\bmanager\\b|المدير");
        if (idx < 0) {
            return "";
        }
        StringBuilder manager = new StringBuilder();
        for (int i = Math.max(0, idx - 3); i < idx; i++) {
            appendManagerNamePart(manager, lines[i].trim());
        }
        String inline = lines[idx].replaceFirst("(?i).*\\bmanager\\b\\s*", "").trim();
        if (inline.matches(".*[A-Za-z]{3,}.*")) {
            appendManagerNamePart(manager, stripArabicSuffix(inline));
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (line.toLowerCase().contains("address") || line.contains("العنوان")) {
                break;
            }
            appendManagerNamePart(manager, stripArabicSuffix(line));
        }
        if (!manager.isEmpty()) {
            return manager.toString().trim();
        }
        for (int i = idx + 1; i < Math.min(idx + 4, lines.length); i++) {
            String line = lines[i].trim();
            if (arabicTextProcessor.containsArabic(line) && line.length() > 8) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private void appendManagerNamePart(StringBuilder manager, String line) {
        if (line.isEmpty() || line.equalsIgnoreCase("manager") || isShareholderNoise(line)) {
            return;
        }
        if (!line.matches(".*[A-Za-z].*") || line.length() < 3) {
            return;
        }
        if (line.toLowerCase().contains("issue") || line.toLowerCase().contains("expiry")) {
            return;
        }
        if (!manager.isEmpty()) {
            manager.append(' ');
        }
        manager.append(line);
    }

    private String stripArabicSuffix(String value) {
        int arIdx = -1;
        for (int i = 0; i < value.length(); i++) {
            if (arabicTextProcessor.containsArabic(String.valueOf(value.charAt(i)))) {
                arIdx = i;
                break;
            }
        }
        return arIdx > 0 ? value.substring(0, arIdx).trim() : value.trim();
    }

    private List<String> extractActivities(String[] lines) {
        int start = findLine(lines, "(?i)^activities");
        int end = findLine(lines, "(?i)shareholder|المساهم");
        if (start < 0 || end < 0 || end <= start) {
            return List.of();
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.matches("^\\d+\\.\\s+.*[A-Za-z].*")) {
                activities.add(line.replaceFirst("^\\d+\\.\\s+", ""));
            }
        }
        return activities;
    }

    private List<String> extractArabicActivities(String[] lines) {
        int start = findLine(lines, "الأنشطة");
        if (start < 0) {
            start = findLine(lines, "(?i)^activities");
        }
        if (start < 0) {
            return List.of();
        }
        int end = findLineFrom(lines, start + 1, "(?i)shareholder|المساهم|الجنسية|nationality");
        if (end < 0) {
            end = lines.length;
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isShareholderNoise(line) || isShareholderHeader(line)) {
                continue;
            }
            if (line.matches("^\\d+\\.\\s+.*") && arabicTextProcessor.containsArabic(line)) {
                activities.add(arabicTextProcessor.normalizeArabic(line.replaceFirst("^\\d+\\.\\s+", "")));
            } else if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && line.length() > 8) {
                activities.add(arabicTextProcessor.normalizeArabic(line));
            }
        }
        return activities;
    }

    private List<Map<String, String>> extractShareholders(String[] lines) {
        List<Map<String, String>> members = new ArrayList<>();
        String arabicShareholderName = extractArabicShareholderName(lines);

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            Map<String, String> inline = parseInlineShareholderRow(line);
            if (inline != null) {
                appendShareholderNamesFromAbove(lines, i, inline);
                if (!arabicShareholderName.isEmpty()) {
                    inline.putIfAbsent("nameAr", arabicShareholderName);
                }
                inline.putIfAbsent("role", "Shareholder");
                members.add(inline);
                continue;
            }
            if (!PASSPORT.matcher(line).matches()) {
                continue;
            }
            Map<String, String> member = parseShareholderBlockAbove(lines, i);
            if (member.isEmpty()) {
                continue;
            }
            if (!arabicShareholderName.isEmpty()) {
                member.putIfAbsent("nameAr", arabicShareholderName);
            }
            member.putIfAbsent("role", "Shareholder");
            members.add(member);
        }
        return dedupeShareholders(members);
    }

    private Map<String, String> parseInlineShareholderRow(String line) {
        Matcher matcher = INLINE_SHAREHOLDER_ROW.matcher(line);
        if (!matcher.matches()) {
            return null;
        }
        Map<String, String> member = new LinkedHashMap<>();
        member.put("shares", matcher.group(1));
        member.put("share", matcher.group(2) + "%");
        member.put("nationality", normalizeNationality(matcher.group(3)));
        member.put("passport", matcher.group(4));
        return member;
    }

    private void appendShareholderNamesFromAbove(String[] lines, int rowIdx, Map<String, String> member) {
        if (member.containsKey("nameEn")) {
            return;
        }
        List<String> nameParts = collectEnglishNameLinesAbove(lines, rowIdx);
        if (!nameParts.isEmpty()) {
            member.put("nameEn", String.join(" ", nameParts));
        }
    }

    private Map<String, String> parseShareholderBlockAbove(String[] lines, int passportIdx) {
        Map<String, String> member = new LinkedHashMap<>();
        member.put("passport", lines[passportIdx].trim());

        int idx = passportIdx - 1;
        while (idx >= 0 && isShareholderNoise(lines[idx])) {
            idx--;
        }
        if (idx >= 0 && isShareholderNationality(lines[idx])) {
            member.put("nationality", normalizeNationality(lines[idx].trim()));
            idx--;
        }
        while (idx >= 0 && isShareholderNoise(lines[idx])) {
            idx--;
        }
        if (idx >= 0) {
            Matcher shareMatcher = SHARE_PERCENT.matcher(lines[idx]);
            if (shareMatcher.find()) {
                member.put("share", shareMatcher.group(1) + "%");
                idx--;
            }
        }
        while (idx >= 0 && isShareholderNoise(lines[idx])) {
            idx--;
        }
        if (idx >= 0 && lines[idx].trim().matches("^\\d+$")) {
            member.put("shares", lines[idx].trim());
            idx--;
        }
        List<String> nameParts = collectEnglishNameLinesAbove(lines, idx + 1);
        if (!nameParts.isEmpty()) {
            member.put("nameEn", String.join(" ", nameParts));
        }
        return member.containsKey("nameEn") || member.containsKey("nationality") ? member : Map.of();
    }

    private List<String> collectEnglishNameLinesAbove(String[] lines, int beforeIdx) {
        List<String> nameParts = new ArrayList<>();
        for (int i = beforeIdx - 1; i >= 0; i--) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (isShareholderNoise(line) || isShareholderHeader(line)) {
                break;
            }
            if (looksLikeShareholderNameLine(line)) {
                nameParts.add(0, line);
            } else {
                break;
            }
        }
        return nameParts;
    }

    private String extractArabicShareholderName(String[] lines) {
        int managerIdx = findLine(lines, "المدير");
        int addressIdx = findLine(lines, "العنوان");
        if (managerIdx < 0 || addressIdx < 0 || addressIdx <= managerIdx) {
            return "";
        }
        for (int i = managerIdx + 1; i < addressIdx; i++) {
            String line = lines[i].trim();
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && line.length() > 8) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private List<Map<String, String>> dedupeShareholders(List<Map<String, String>> members) {
        List<Map<String, String>> unique = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (Map<String, String> member : members) {
            String key = member.getOrDefault("passport", "") + "|" + member.getOrDefault("nameEn", "");
            if (seen.add(key)) {
                unique.add(member);
            }
        }
        return unique;
    }

    private boolean looksLikeShareholderNameLine(String line) {
        return line.matches("^[A-Za-z][A-Za-z'\\-.\\s]{2,}$")
                && !line.equalsIgnoreCase("manager")
                && !line.toLowerCase().contains("license")
                && !line.toLowerCase().contains("government");
    }

    private boolean isShareholderNationality(String line) {
        String trimmed = line.trim();
        String lower = trimmed.toLowerCase();
        return lower.equals("egypt")
                || lower.equals("india")
                || lower.equals("uae")
                || lower.contains("emirates")
                || lower.contains("pakistan")
                || trimmed.contains("مصر")
                || trimmed.contains("الهند");
    }

    private String normalizeNationality(String value) {
        return switch (value.trim().toLowerCase()) {
            case "egypt" -> "Egypt";
            case "india" -> "India";
            case "uae" -> "United Arab Emirates";
            default -> value.trim();
        };
    }

    private boolean isShareholderHeader(String line) {
        String lower = line.toLowerCase();
        return lower.contains("shareholder")
                || lower.contains("passport number")
                || lower.contains("number of shares")
                || lower.contains("percentage")
                || lower.equals("names")
                || lower.equals("nationality")
                || line.contains("المساهم")
                || line.contains("عدد الأسهم")
                || line.contains("النسبة المئوية")
                || line.contains("رقم جواز السفر")
                || line.contains("الأسماء");
    }

    private boolean isShareholderNoise(String line) {
        String lower = line.toLowerCase();
        return lower.contains("approved electronic")
                || lower.contains("license document")
                || lower.contains("toll free")
                || lower.contains("www.")
                || lower.contains("authority formation")
                || lower.contains("free zones authority")
                || lower.contains("notes:")
                || line.contains("وثيقة")
                || line.contains("هيئة المناطق الحرة")
                || line.matches("^[\\.\\d]+$");
    }

    private String extractAddress(String[] lines) {
        int idx = findLine(lines, "(?i)^address$|العنوان");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (!line.isEmpty() && !line.toLowerCase().contains("premises")
                    && !line.toLowerCase().contains("building")
                    && (line.contains("B.C.") || arabicTextProcessor.containsArabic(line))) {
                return line;
            }
        }
        return "";
    }
}
