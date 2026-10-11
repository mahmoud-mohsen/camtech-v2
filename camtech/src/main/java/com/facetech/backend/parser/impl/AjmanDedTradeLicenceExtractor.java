package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class AjmanDedTradeLicenceExtractor {

    private static final Pattern LICENSE_NO_INLINE = Pattern.compile("(?i)license\\s*no\\.?\\s*(\\d{4,8})");
    private static final Pattern REGISTER_NO_INLINE = Pattern.compile("(?i)register\\s*no\\.?\\s*(\\d{6,12})");
    private static final Pattern DCCI_NO = Pattern.compile("(?i)accci\\s*no\\.?\\s*(\\d{4,8})|(\\d{5,8})\\s*رقم\\s*الغرفة");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Z0-9'\\-.\\s]{8,}$");
    private static final Pattern PASSPORT = Pattern.compile("^[A-Z]{1,2}\\d{5,10}$");
    private static final Pattern EMIRATES_ID = Pattern.compile("^\\d{15}$");
    private static final Pattern SHARE = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*%\\s*$");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] allLines = normalized.split("\n");
        String[] lines = scopeMainLicense(normalized).split("\n");

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(normalized, allLines));
        addIfNotEmpty(result, "registerNo", extractRegisterNo(normalized, allLines));
        addIfNotEmpty(result, "companyName", extractEnglishAfterHeading(lines, "trade name"));
        addIfNotEmpty(result, "businessName", extractEnglishAfterHeading(lines, "trade name"));
        addIfNotEmpty(result, "companyNameAr", extractArabicTradeName(normalized, lines));
        addIfNotEmpty(result, "businessNameAr", extractArabicTradeName(normalized, lines));
        addIfNotEmpty(result, "legalType", extractEnglishAfterHeading(lines, "legal form"));
        addIfNotEmpty(result, "legalTypeAr", extractArabicLegalType(normalized, lines));
        addIfNotEmpty(result, "issueDate", extractDateNearHeading(allLines, "issue date", "تاريخ الاصدار", "تاريخ الإصدار"));
        addIfNotEmpty(result, "expiryDate", extractDateNearHeading(allLines, "expire date", "expiry date", "تاريخ الانتهاء", "تاريخ الإنتهاء"));
        addIfNotEmpty(result, "contractExpiryDate", extractContractExpiryDate(allLines));
        addIfNotEmpty(result, "lessor", extractLessor(allLines));
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(extractActivities(lines), extractArabicActivities(lines)));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(extractMembers(allLines)));
        addIfNotEmpty(result, "manager", extractManager(allLines));
        addIfNotEmpty(result, "dcciNo", extractDcciNo(allLines));
        addIfNotEmpty(result, "address", extractAddress(allLines));
        addIfNotEmpty(result, "poBox", extractPoBox(normalized));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Ajman DED trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String scopeMainLicense(String text) {
        String[] lines = text.split("\n");
        int appendix = findLine(lines, "(?i)partners register appendix|ملحق أسماء");
        if (appendix > 0) {
            return String.join("\n", java.util.Arrays.copyOfRange(lines, 0, appendix));
        }
        int footer = findLine(lines, "(?i)approved electronic document|وثيقة الكترونية");
        if (footer > 0) {
            return String.join("\n", java.util.Arrays.copyOfRange(lines, 0, footer));
        }
        return text;
    }

    private String extractLicenseNo(String scope, String[] lines) {
        Matcher inline = LICENSE_NO_INLINE.matcher(scope);
        if (inline.find()) {
            return inline.group(1);
        }
        return valueAfterHeading(lines, "(?i)license\\s*no|رقم الرخصة", line -> line.matches("\\d{4,8}"));
    }

    private String extractRegisterNo(String scope, String[] lines) {
        Matcher inline = REGISTER_NO_INLINE.matcher(scope);
        if (inline.find()) {
            return inline.group(1);
        }
        return valueAfterHeading(lines, "(?i)register\\s*no|رقم السجل", line -> line.matches("\\d{6,12}"));
    }

    private String extractEnglishAfterHeading(String[] lines, String heading) {
        int idx = findHeading(lines, heading);
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (isHeading(line) || arabicTextProcessor.containsArabic(line)) {
                break;
            }
            if (line.matches(".*[A-Za-z].*") && line.length() > 2) {
                return line;
            }
        }
        return "";
    }

    private String extractArabicTradeName(String text, String[] lines) {
        String inline = extractInlineArabicLabelValue(text, "الاسم التجاري");
        if (!inline.isBlank()) {
            return inline;
        }
        int idx = findHeading(lines, "trade name");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && line.length() > 4) {
                return arabicTextProcessor.normalizeArabic(line);
            }
            if (line.matches(".*[A-Za-z].*")) {
                break;
            }
        }
        return "";
    }

    private String extractArabicLegalType(String text, String[] lines) {
        String inline = extractInlineArabicLabelValue(text, "الشكل القانوني");
        if (!inline.isBlank()) {
            return inline;
        }
        int idx = findHeading(lines, "legal form");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && line.length() > 3) {
                return arabicTextProcessor.normalizeArabic(line);
            }
            if (line.matches(".*[A-Za-z].*")) {
                break;
            }
        }
        return "";
    }

    private String extractInlineArabicLabelValue(String text, String label) {
        for (String line : text.split("\n")) {
            String trimmed = line.trim();
            if (!trimmed.contains(label)) {
                continue;
            }
            String value = trimmed.replace(label, "").trim();
            if (arabicTextProcessor.containsArabic(value) && value.length() > 3 && !isHeading(value)) {
                return arabicTextProcessor.normalizeArabic(value);
            }
        }
        return "";
    }

    private String extractDateNearHeading(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            String lower = lines[i].toLowerCase();
            if (lower.contains("contract expiry")) {
                continue;
            }
            for (String label : labels) {
                if (!lower.contains(label.toLowerCase()) && !lines[i].contains(label)) {
                    continue;
                }
                String sameLine = firstDate(lines[i]);
                if (!sameLine.isEmpty()) {
                    return normalizeDate(sameLine);
                }
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    String next = firstDate(lines[j]);
                    if (!next.isEmpty()) {
                        return normalizeDate(next);
                    }
                }
            }
        }
        return "";
    }

    private String extractContractExpiryDate(String[] lines) {
        int idx = findLine(lines, "(?i)contract\\s*expiry\\s*date|تاريخ\\s*انتهاء\\s*عقد\\s*الا?يجار|تاریخ\\s*انتهاء\\s*عقد\\s*الا?يجار");
        if (idx < 0) {
            return "";
        }
        String sameLine = firstDate(lines[idx]);
        if (!sameLine.isEmpty()) {
            return normalizeDate(sameLine);
        }
        for (int j = idx + 1; j < Math.min(idx + 8, lines.length); j++) {
            String line = lines[j].trim();
            if (line.isEmpty() || isHeading(line) || isNoise(line)) {
                continue;
            }
            String next = firstDate(line);
            if (!next.isEmpty()) {
                return normalizeDate(next);
            }
        }
        return "";
    }

    private String extractLessor(String[] lines) {
        int idx = findLine(lines, "(?i)lessor|اسم\\s*المؤجر");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line) || isNoise(line)) {
                continue;
            }
            if (!firstDate(line).isEmpty()) {
                continue;
            }
            if (line.matches("^\\d+$") || line.length() <= 2) {
                continue;
            }
            String cleaned = line.replaceFirst("^[-–]+\\s*", "").trim();
            if (arabicTextProcessor.containsArabic(cleaned)) {
                return arabicTextProcessor.normalizeArabic(cleaned);
            }
            if (cleaned.matches(".*[A-Za-z].*") && cleaned.length() > 4) {
                return cleaned;
            }
        }
        return "";
    }

    private List<String> extractActivities(String[] lines) {
        List<String> activities = extractLinesAfterHeading(
                lines,
                "(?i)^\\s*activites\\s*$|^\\s*activities\\s*$|\\bactivites\\b|\\bactivities\\b",
                true,
                "(?i)p\\.?\\s*o\\.?\\s*box|صندوق البريد|contract expiry|register no|role\\s*/|accci|تفاصيل الرخصة|license details");
        if (!activities.isEmpty()) {
            return activities;
        }
        return extractHeaderActivities(lines, true);
    }

    private List<String> extractArabicActivities(String[] lines) {
        List<String> activities = extractLinesAfterHeading(
                lines,
                "الانشطة|الأنشطة",
                false,
                "(?i)address\\s*/|ملاحظات|voucher|print date|العنوان|member name|اسم صاحب");
        if (!activities.isEmpty()) {
            return activities;
        }
        return extractHeaderActivities(lines, false);
    }

    private List<String> extractLinesAfterHeading(String[] lines, String startPattern, boolean english, String endPattern) {
        int start = findLine(lines, startPattern);
        if (start < 0) {
            return List.of();
        }
        int end = findLineFrom(lines, start + 1, endPattern);
        if (end < 0) {
            end = lines.length;
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line) || isNoise(line)) {
                continue;
            }
            if (english) {
                if (line.matches(".*[A-Za-z].*") && line.length() > 4 && looksLikeActivity(line)) {
                    activities.add(line);
                }
            } else if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && line.length() > 4) {
                activities.add(arabicTextProcessor.normalizeArabic(line));
            }
        }
        return activities;
    }

    private List<String> extractHeaderActivities(String[] lines, boolean english) {
        int end = findHeading(lines, "license details", "license no", "تفاصيل الرخصة", "رقم الرخصة");
        if (end < 0) {
            end = Math.min(12, lines.length);
        }
        List<String> activities = new ArrayList<>();
        for (int i = 0; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line) || isNoise(line)) {
                continue;
            }
            if (english) {
                if (line.matches(".*[A-Za-z].*") && looksLikeActivity(line)) {
                    activities.add(line);
                }
            } else if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*")
                    && line.length() > 4 && line.contains("خدمات")) {
                activities.add(arabicTextProcessor.normalizeArabic(line));
            }
        }
        return activities;
    }

    private boolean looksLikeActivity(String line) {
        String lower = line.toLowerCase();
        return lower.contains("service")
                || lower.contains("trading")
                || lower.contains("consult")
                || lower.contains("workers")
                || lower.contains("information")
                || lower.contains("photocopy")
                || lower.contains("typing");
    }

    private List<Map<String, String>> extractMembers(String[] lines) {
        List<Map<String, String>> tableMembers = extractMembersFromPartnerRegisterTable(lines);
        if (!tableMembers.isEmpty()) {
            return tableMembers;
        }
        List<Map<String, String>> appendixMembers = extractMembersFromAppendix(lines);
        if (!appendixMembers.isEmpty()) {
            return appendixMembers;
        }
        List<Map<String, String>> roleTableMembers = extractMembersFromRoleTable(lines);
        List<Map<String, String>> nameSectionMembers = extractMembersFromNameSection(lines);
        return mergeMembers(roleTableMembers, nameSectionMembers);
    }

    private List<Map<String, String>> extractMembersFromPartnerRegisterTable(String[] lines) {
        int tableStart = findPartnerRegisterTableStart(lines);
        if (tableStart < 0) {
            return List.of();
        }

        int tableEnd = findPartnerTableEnd(lines, tableStart + 1);
        int arabicNameHeader = findLineFrom(lines, tableStart, "(?i)^arabic name$|^الاسم باللغة العربية$");
        if (arabicNameHeader >= 0 && arabicNameHeader < tableEnd) {
            int firstValue = nextMeaningfulLine(lines, arabicNameHeader + 1, tableEnd);
            if (firstValue >= 0 && arabicTextProcessor.containsArabic(lines[firstValue])
                    && looksLikePersonName(lines[firstValue])) {
                return dedupeMembers(parseVerticalPartnerTable(lines, arabicNameHeader, tableEnd));
            }
        }

        int dataStart = findLineFrom(lines, tableStart,
                "(?i)location of birth|مكان الميلاد|share percent|passportnumber");
        if (dataStart < 0 || dataStart >= tableEnd) {
            return List.of();
        }

        List<Map<String, String>> members = new ArrayList<>();
        Map<String, String> current = new LinkedHashMap<>();
        for (int i = dataStart + 1; i < tableEnd; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isPartnerTableColumnHeader(line)) {
                continue;
            }
            if (isPartnerTableFooter(line)) {
                break;
            }
            if (assignPartnerTableLine(current, line) && isPartnerRowComplete(current)) {
                finalizePartnerRow(members, current);
                current = new LinkedHashMap<>();
            }
        }
        finalizePartnerRow(members, current);
        return dedupeMembers(members);
    }

    private int findPartnerTableEnd(String[] lines, int from) {
        for (int i = from; i < lines.length; i++) {
            if (isPartnerTableFooter(lines[i].trim())) {
                return i;
            }
        }
        return lines.length;
    }

    private int nextMeaningfulLine(String[] lines, int from, int to) {
        for (int i = from; i < to; i++) {
            String line = lines[i].trim();
            if (!line.isEmpty() && !isPartnerTableColumnHeader(line) && !isPartnerTableFooter(line)) {
                return i;
            }
        }
        return -1;
    }

    private List<Map<String, String>> parseVerticalPartnerTable(String[] lines, int from, int to) {
        List<Map<String, String>> members = new ArrayList<>();
        Map<String, String> current = new LinkedHashMap<>();
        String pendingField = null;
        for (int i = from + 1; i < to; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isPartnerTableFooter(line)) {
                break;
            }
            String mappedField = mapPartnerTableHeader(line);
            if (mappedField != null) {
                pendingField = mappedField;
                continue;
            }
            if (pendingField != null) {
                if (pendingField.equals("emiratesIdExpiry") && !containsDate(line)) {
                    continue;
                }
                if (line.equals("ا")) {
                    continue;
                }
                putPartnerField(current, pendingField, line);
                pendingField = null;
                if (isPartnerRowComplete(current)) {
                    finalizePartnerRow(members, current);
                    current = new LinkedHashMap<>();
                }
                continue;
            }
            if (assignPartnerTableLine(current, line) && isPartnerRowComplete(current)) {
                finalizePartnerRow(members, current);
                current = new LinkedHashMap<>();
            }
        }
        finalizePartnerRow(members, current);
        return members;
    }

    private String mapPartnerTableHeader(String line) {
        String lower = line.toLowerCase().trim();
        if (lower.equals("arabic name")) {
            return "nameAr";
        }
        if (lower.equals("english name")) {
            return "nameEn";
        }
        if (lower.equals("capacity")) {
            return "role";
        }
        if (lower.equals("nationality")) {
            return "nationality";
        }
        if (lower.equals("uae emirates id")) {
            return "emiratesId";
        }
        if (lower.equals("uae emirates expiry date")) {
            return "emiratesIdExpiry";
        }
        if (lower.equals("passportnumber") || lower.equals("passport number")) {
            return "passport";
        }
        if (lower.equals("share percent")) {
            return "share";
        }
        if (lower.equals("address")) {
            return "address";
        }
        if (lower.equals("location of birth")) {
            return "birthLocation";
        }
        return null;
    }

    private void putPartnerField(Map<String, String> row, String field, String line) {
        if (line.isEmpty() || line.equals("ا")) {
            return;
        }
        switch (field) {
            case "nameAr" -> row.put("nameAr", arabicTextProcessor.normalizeArabic(line));
            case "nameEn" -> row.put("nameEn", line);
            case "role" -> row.put("role", normalizeRole(line));
            case "nationality" -> row.put("nationality", normalizeNationality(line));
            case "emiratesId" -> row.put("emiratesId", line.replaceAll("\\D", ""));
            case "emiratesIdExpiry" -> {
                String date = firstDate(line);
                if (date.isEmpty()) {
                    Matcher flexDate = Pattern.compile("(\\d{1,2})/(\\d{1,2})/(\\d{4})").matcher(line);
                    if (flexDate.find()) {
                        date = String.format("%02d/%02d/%s",
                                Integer.parseInt(flexDate.group(1)),
                                Integer.parseInt(flexDate.group(2)),
                                flexDate.group(3));
                    }
                }
                if (!date.isEmpty()) {
                    row.put("emiratesIdExpiry", normalizeDate(date));
                }
            }
            case "passport" -> row.put("passport", line);
            case "share" -> row.put("share", line.matches("^\\d+\\.\\d+$") ? line + "%" : line);
            case "address", "birthLocation" -> row.put(field, line);
            default -> {
            }
        }
    }

    private boolean containsDate(String line) {
        if (!firstDate(line).isEmpty()) {
            return true;
        }
        return Pattern.compile("\\d{1,2}/\\d{1,2}/\\d{4}").matcher(line).find();
    }

    private List<Map<String, String>> dedupeMembers(List<Map<String, String>> members) {
        List<Map<String, String>> unique = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, String> member : members) {
            String key = member.getOrDefault("passport", "") + "|" + member.getOrDefault("nameEn", "");
            if (seen.add(key)) {
                unique.add(member);
            }
        }
        return unique;
    }

    private int findPartnerRegisterTableStart(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String lower = lines[i].toLowerCase();
            if (!lower.contains("partners register appendix") && !lower.contains("ملحق")) {
                continue;
            }
            if (lower.contains("سجل") && !lower.contains("أسماء")) {
                return i;
            }
        }
        return -1;
    }

    private boolean assignPartnerTableLine(Map<String, String> row, String line) {
        if (EMIRATES_ID.matcher(line).matches()) {
            row.put("emiratesId", line);
            return false;
        }
        if (PASSPORT.matcher(line).matches()) {
            row.put("passport", line);
            return false;
        }
        if (line.matches("^\\d+\\.\\d+$")) {
            row.put("share", line + "%");
            return false;
        }
        if (isRoleValue(line)) {
            row.put("role", normalizeRole(line));
            return false;
        }
        if (isNationalityValue(line)) {
            row.put("nationality", normalizeNationality(line));
            return false;
        }
        if (looksLikeEnglishName(line)) {
            row.put("nameEn", line);
            return false;
        }
        if (row.containsKey("emiratesId") && !row.containsKey("emiratesIdExpiry")) {
            String date = firstDate(line);
            if (date.isEmpty()) {
                Matcher flexDate = Pattern.compile("(\\d{1,2})/(\\d{1,2})/(\\d{4})").matcher(line);
                if (flexDate.find()) {
                    date = String.format("%02d/%02d/%s",
                            Integer.parseInt(flexDate.group(1)),
                            Integer.parseInt(flexDate.group(2)),
                            flexDate.group(3));
                }
            }
            if (!date.isEmpty()) {
                row.put("emiratesIdExpiry", normalizeDate(date));
                return false;
            }
        }
        if (line.matches("(?i)^AM$") || line.matches("\\d{1,2}:\\d{2}:\\d{2}")) {
            return false;
        }
        if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && looksLikePersonName(line)) {
            row.put("nameAr", arabicTextProcessor.normalizeArabic(line));
            return false;
        }
        if (arabicTextProcessor.containsArabic(line) && line.length() > 8
                && row.containsKey("share") && !row.containsKey("address")) {
            row.put("address", line);
            return true;
        }
        return false;
    }

    private boolean isPartnerRowComplete(Map<String, String> row) {
        return row.containsKey("nameEn") && row.containsKey("role")
                && row.containsKey("passport") && row.containsKey("share");
    }

    private void finalizePartnerRow(List<Map<String, String>> members, Map<String, String> current) {
        if (current == null || !current.containsKey("nameEn")) {
            return;
        }
        if (current.containsKey("role") || current.containsKey("passport") || current.containsKey("share")) {
            members.add(copyMember(current));
        }
    }

    private boolean isPartnerTableFooter(String line) {
        String lower = line.toLowerCase();
        return lower.contains("approved electronic")
                || line.contains("وثيقة الكترونية")
                || line.contains("الاسم باللغة العربية")
                || line.contains("الاسم باللغة الانجليزية");
    }

    private boolean isPartnerTableColumnHeader(String line) {
        String lower = line.toLowerCase();
        return lower.equals("arabic name")
                || lower.equals("english name")
                || lower.equals("capacity")
                || lower.equals("nationality")
                || lower.contains("emirates id")
                || lower.contains("passportnumber")
                || lower.contains("share percent")
                || lower.equals("address")
                || lower.contains("location of birth")
                || line.contains("الصفة")
                || line.contains("الجنسية")
                || line.contains("رقم الهوية")
                || line.contains("رقم جواز السفر")
                || line.contains("مكان الميلاد");
    }

    private List<Map<String, String>> extractMembersFromAppendix(String[] lines) {
        int appendixStart = findNamesAppendixStart(lines);
        if (appendixStart < 0) {
            return List.of();
        }

        int memberNameStart = findLineFrom(lines, appendixStart, "(?i)member name|اسم صاحب|اسم الطرف");
        int end = findLineFrom(lines, appendixStart + 1,
                "(?i)approved electronic|صدرت هذه|print date");
        if (end < 0) {
            end = lines.length;
        }

        List<String> roles = new ArrayList<>();
        List<String> shares = new ArrayList<>();
        List<String> passports = new ArrayList<>();
        int roleDataTo = memberNameStart >= 0 ? memberNameStart : end;
        collectAppendixRoleData(lines, appendixStart + 1, roleDataTo, roles, shares, passports);

        if (memberNameStart >= 0) {
            if (!roles.isEmpty() || !passports.isEmpty() || !shares.isEmpty()) {
                List<Map<String, String>> members = parseAppendixNameSection(lines, memberNameStart + 1, end);
                if (!members.isEmpty()) {
                    mergeAppendixRoleData(members, roles, shares, passports);
                    return members;
                }
            }
            List<Map<String, String>> interleaved = parseAppendixInterleavedSection(lines, memberNameStart + 1, end);
            if (!interleaved.isEmpty()) {
                mergeAppendixRoleData(interleaved, roles, shares, passports);
                return interleaved;
            }
        }

        int dataStart = memberNameStart >= 0 ? memberNameStart : appendixStart;
        return parseAppendixInterleavedSection(lines, dataStart + 1, end);
    }

    private int findNamesAppendixStart(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String lower = lines[i].toLowerCase();
            if (!lower.contains("partners register appendix") && !lower.contains("ملحق")) {
                continue;
            }
            if (lower.contains("أسماء") || lower.contains("اسماء") || lower.contains("أسما")) {
                return i;
            }
        }
        return findLine(lines, "(?i)partners register appendix|ملحق أسماء");
    }

    private boolean hasAppendixRoleData(String[] lines, int from, int to) {
        for (int i = from; i < to; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isAppendixColumnHeader(line) || isAppendixNoise(line)) {
                continue;
            }
            if (PASSPORT.matcher(line).matches() || line.matches("^\\d+\\.\\d+$") || isRoleValue(line)) {
                return true;
            }
        }
        return false;
    }

    private void collectAppendixRoleData(String[] lines, int from, int to,
            List<String> roles, List<String> shares, List<String> passports) {
        for (int i = from; i < to; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isAppendixColumnHeader(line) || isAppendixNoise(line)) {
                continue;
            }
            if (PASSPORT.matcher(line).matches()) {
                if (passports.isEmpty() || !passports.get(passports.size() - 1).equals(line)) {
                    passports.add(line);
                }
                continue;
            }
            if (line.matches("^\\d+\\.\\d+$")) {
                shares.add(line + "%");
                continue;
            }
            if (isRoleValue(line)) {
                roles.add(normalizeRole(line));
            }
        }
    }

    private List<Map<String, String>> parseAppendixNameSection(String[] lines, int from, int to) {
        List<Map<String, String>> members = new ArrayList<>();
        Map<String, String> current = new LinkedHashMap<>();
        for (int i = from; i < to; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line) || isAppendixColumnHeader(line) || isAppendixNoise(line)) {
                continue;
            }
            if (isNationalityValue(line)) {
                current.put("nationality", normalizeNationality(line));
                continue;
            }
            if (looksLikeEnglishName(line)) {
                appendEnglishName(current, line);
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*")
                    && looksLikePersonName(line)) {
                finalizeAppendixMember(members, current);
                current = new LinkedHashMap<>();
                current.put("nameAr", arabicTextProcessor.normalizeArabic(line));
            }
        }
        finalizeAppendixMember(members, current);
        return members;
    }

    private List<Map<String, String>> parseAppendixInterleavedSection(String[] lines, int from, int to) {
        List<Map<String, String>> members = new ArrayList<>();
        Map<String, String> current = new LinkedHashMap<>();
        for (int i = from; i < to; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isAppendixColumnHeader(line) || isAppendixNoise(line)) {
                continue;
            }
            if (isRoleValue(line)) {
                if (current.containsKey("nameEn")) {
                    finalizeAppendixMember(members, current);
                    current = new LinkedHashMap<>();
                }
                current.put("role", normalizeRole(line));
                continue;
            }
            if (PASSPORT.matcher(line).matches()) {
                current.put("passport", line);
                continue;
            }
            if (line.matches("^\\d+\\.\\d+$")) {
                current.put("share", line + "%");
                continue;
            }
            if (isNationalityValue(line)) {
                current.put("nationality", normalizeNationality(line));
                continue;
            }
            if (looksLikeEnglishName(line)) {
                appendEnglishName(current, line);
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*")
                    && looksLikePersonName(line)) {
                if (current.containsKey("nameEn")) {
                    finalizeAppendixMember(members, current);
                    current = new LinkedHashMap<>();
                }
                current.put("nameAr", arabicTextProcessor.normalizeArabic(line));
            }
        }
        finalizeAppendixMember(members, current);
        return members;
    }

    private void appendEnglishName(Map<String, String> current, String line) {
        if (isEnglishNameContinuation(line, current.get("nameEn"))) {
            current.put("nameEn", current.get("nameEn") + " " + line);
            return;
        }
        if (current.containsKey("nameEn")) {
            current.put("nameEn", line);
            return;
        }
        current.put("nameEn", line);
    }

    private void mergeAppendixRoleData(List<Map<String, String>> members,
            List<String> roles, List<String> shares, List<String> passports) {
        for (int i = 0; i < members.size(); i++) {
            Map<String, String> member = members.get(i);
            if (i < roles.size()) {
                member.putIfAbsent("role", roles.get(i));
            }
            if (i < shares.size()) {
                member.putIfAbsent("share", shares.get(i));
            }
            if (i < passports.size()) {
                member.putIfAbsent("passport", passports.get(i));
            }
        }
    }

    private void finalizeAppendixMember(List<Map<String, String>> members, Map<String, String> current) {
        if (current == null || current.isEmpty() || !current.containsKey("nameEn")) {
            return;
        }
        members.add(copyMember(current));
    }

    private boolean looksLikeEnglishName(String line) {
        return EN_NAME.matcher(line).matches();
    }

    private boolean isEnglishNameContinuation(String line, String previousNameEn) {
        if (previousNameEn == null || previousNameEn.isBlank()) {
            return false;
        }
        if (!line.matches("^[A-Z][A-Z'\\-]{2,}$")) {
            return false;
        }
        return !previousNameEn.endsWith(line);
    }

    private List<Map<String, String>> extractMembersFromRoleTable(String[] lines) {
        int start = findLine(lines, "(?i)role\\s*/\\s*الصفة");
        int end = findLineFrom(lines, start + 1, "(?i)^activites$|^activities$|الانشطة|member name|اسم صاحب|اسم الطرف");
        if (start < 0 || end < 0 || end <= start) {
            return List.of();
        }

        List<Map<String, String>> members = new ArrayList<>();
        Map<String, String> current = new LinkedHashMap<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isAppendixColumnHeader(line) || isAppendixNoise(line)) {
                continue;
            }
            if (PASSPORT.matcher(line).matches()) {
                current.put("passport", line);
                if (current.containsKey("role")) {
                    members.add(copyMember(current));
                    current = new LinkedHashMap<>();
                }
                continue;
            }
            if (isNationalityValue(line)) {
                current.put("nationality", normalizeNationality(line));
                continue;
            }
            if (isRoleValue(line)) {
                String role = normalizeRole(line);
                if (!current.containsKey("role")) {
                    current.put("role", role);
                } else if (!current.containsKey("passport")) {
                    current.put("role", role);
                }
            }
        }
        return members;
    }

    private List<Map<String, String>> extractMembersFromNameSection(String[] lines) {
        int start = findHeading(lines, "member name", "manager name", "اسم صاحب", "اسم المدير", "اسم الطرف");
        if (start < 0) {
            return List.of();
        }
        int end = findLineFrom(lines, start + 1,
                "(?i)address\\s*/|activites|activities|voucher|lessor|print date|contract expiry|صندوق البريد|الانشطة|ملاحظات|اسم المؤجر");
        if (end < 0) {
            end = lines.length;
        }

        List<Map<String, String>> members = new ArrayList<>();
        String pendingAr = "";
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line) || isAppendixColumnHeader(line) || isAppendixNoise(line)) {
                continue;
            }
            if (EN_NAME.matcher(line).matches()) {
                Map<String, String> member = new LinkedHashMap<>();
                member.put("nameEn", line);
                if (!pendingAr.isBlank()) {
                    member.put("nameAr", pendingAr);
                    pendingAr = "";
                }
                members.add(member);
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*")
                    && looksLikePersonName(line)) {
                if (!members.isEmpty() && !members.get(members.size() - 1).containsKey("nameAr")) {
                    members.get(members.size() - 1).put("nameAr", arabicTextProcessor.normalizeArabic(line));
                } else {
                    pendingAr = arabicTextProcessor.normalizeArabic(line);
                }
            }
        }
        return members;
    }

    private List<Map<String, String>> mergeMembers(List<Map<String, String>> roleData, List<Map<String, String>> names) {
        if (names.isEmpty()) {
            return roleData;
        }
        if (roleData.isEmpty()) {
            return names;
        }
        List<Map<String, String>> merged = new ArrayList<>();
        int count = Math.max(roleData.size(), names.size());
        for (int i = 0; i < count; i++) {
            Map<String, String> member = new LinkedHashMap<>();
            if (i < names.size()) {
                member.putAll(names.get(i));
            }
            if (i < roleData.size()) {
                for (Map.Entry<String, String> entry : roleData.get(i).entrySet()) {
                    member.putIfAbsent(entry.getKey(), entry.getValue());
                }
            }
            if (!member.isEmpty()) {
                merged.add(member);
            }
        }
        return merged;
    }

    private Map<String, String> copyMember(Map<String, String> member) {
        return new LinkedHashMap<>(member);
    }

    private String normalizeRole(String line) {
        String lower = line.toLowerCase();
        if (lower.contains("service agent") || line.contains("وكيل")) {
            return "Service Agent";
        }
        if (lower.contains("owner") || lower.contains("proprietor") || line.contains("مالك")) {
            return "Owner";
        }
        if (lower.contains("manager") || line.contains("مدير")) {
            return "Manager";
        }
        return line.trim();
    }

    private String normalizeNationality(String line) {
        String lower = line.toLowerCase();
        if (lower.contains("uae") || lower.contains("united arab emirates") || line.contains("الإمارات")) {
            return "United Arab Emirates";
        }
        if (lower.contains("india") || line.contains("الهند")) {
            return "India";
        }
        return line.trim();
    }

    private boolean isRoleValue(String line) {
        String lower = line.toLowerCase();
        return lower.contains("owner")
                || lower.contains("proprietor")
                || lower.contains("service agent")
                || lower.contains("manager")
                || line.contains("وكيل")
                || line.contains("مالك");
    }

    private boolean isNationalityValue(String line) {
        String lower = line.toLowerCase();
        return lower.contains("india")
                || lower.contains("uae")
                || lower.contains("united arab emirates")
                || line.contains("الهند")
                || line.contains("الإمارات");
    }

    private boolean isAppendixColumnHeader(String line) {
        return isHeading(line)
                || line.toLowerCase().contains("share/")
                || line.toLowerCase().contains("percent")
                || line.contains("نسبة الشراكة");
    }

    private boolean isAppendixNoise(String line) {
        String lower = line.toLowerCase();
        return lower.contains("voucher")
                || lower.contains("print date")
                || lower.contains("approved electronic")
                || line.length() <= 2
                || line.equals("ا");
    }

    private String extractManager(String[] lines) {
        int idx = findHeading(lines, "manager name");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 15, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (isHeading(line) && !line.toLowerCase().contains("passport")) {
                continue;
            }
            if (PASSPORT.matcher(line).matches() || isRoleValue(line)) {
                continue;
            }
            if (isNationalityValue(line) || isNoise(line)) {
                continue;
            }
            if (EN_NAME.matcher(line).matches()) {
                return line;
            }
        }
        return "";
    }

    private String extractDcciNo(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            Matcher matcher = DCCI_NO.matcher(lines[i]);
            if (matcher.find()) {
                String value = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
                if (value != null && !value.isBlank()) {
                    return value;
                }
            }
            if (lines[i].toLowerCase().contains("accci no")) {
                for (int j = i; j < Math.min(i + 4, lines.length); j++) {
                    String candidate = lines[j].trim();
                    if (candidate.matches("\\d{5,8}")) {
                        return candidate;
                    }
                }
            }
        }
        return "";
    }

    private String extractAddress(String[] lines) {
        int idx = findHeading(lines, "address /", "address");
        if (idx < 0) {
            return "";
        }
        StringBuilder address = new StringBuilder();
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.contains("ملاحظات") || line.equalsIgnoreCase("remarks")
                    || isHeading(line) || isNoise(line)) {
                break;
            }
            if (line.equals("العنوان") || line.equalsIgnoreCase("address")) {
                continue;
            }
            if (line.matches(".*[A-Za-z].*") || arabicTextProcessor.containsArabic(line)) {
                if (!address.isEmpty()) {
                    address.append(", ");
                }
                address.append(line);
            }
        }
        return address.toString().trim();
    }

    private String extractPoBox(String scope) {
        Matcher matcher = Pattern.compile("(?i)p\\.?\\s*o\\.?\\s*box\\s*[:\\s]?(\\d{3,10})").matcher(scope);
        return matcher.find() ? matcher.group(1) : "";
    }

    private String valueAfterHeading(String[] lines, String headingPattern, java.util.function.Predicate<String> validator) {
        int idx = findLine(lines, headingPattern);
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String candidate = lines[i].trim();
            if (!candidate.isEmpty() && validator.test(candidate)) {
                return candidate;
            }
        }
        return "";
    }

    private int findHeading(String[] lines, String... headings) {
        for (String heading : headings) {
            int idx = findLine(lines, "(?i)^\\s*" + Pattern.quote(heading) + "\\s*$|\\b" + heading + "\\b");
            if (idx >= 0) {
                return idx;
            }
        }
        return -1;
    }

    private int findSectionEnd(String[] lines, int from) {
        int end = findLineFrom(lines, from,
                "(?i)address\\s*/|p\\.?\\s*o\\.?\\s*box|صندوق البريد|contract expiry|voucher|lessor|print date|register no|license no|role\\s*/|member name|اسم المؤجر");
        return end < 0 ? lines.length : end;
    }

    private int findLineFrom(String[] lines, int from, String pattern) {
        Pattern compiled = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
        for (int i = Math.max(0, from); i < lines.length; i++) {
            if (compiled.matcher(lines[i]).find()) {
                return i;
            }
        }
        return -1;
    }

    private boolean looksLikePersonName(String line) {
        String normalized = arabicTextProcessor.normalizeArabic(line);
        return normalized.length() >= 8
                && !normalized.contains("خدمات")
                && !normalized.contains("الانشطة")
                && !normalized.contains("العنوان")
                && !normalized.contains("الايصال")
                && !normalized.contains("المؤجر")
                && !normalized.contains("ملاحظات")
                && !normalized.contains("تاريخ");
    }

    private boolean isHeading(String line) {
        String lower = line.toLowerCase().trim();
        return lower.equals("trade name")
                || lower.equals("legal form")
                || lower.equals("license details")
                || lower.equals("license no.")
                || lower.equals("register no.")
                || lower.contains("issue date")
                || lower.contains("expire date")
                || (lower.contains("expiry date") && !lower.contains("contract expiry"))
                || lower.contains("contract expiry date")
                || lower.contains("lessor")
                || lower.contains("role /")
                || lower.contains("passport /")
                || lower.contains("nationality /")
                || lower.contains("member name")
                || lower.contains("manager name")
                || lower.contains("address /")
                || lower.contains("activites")
                || lower.contains("activities")
                || line.contains("تفاصيل الرخصة")
                || line.contains("الشكل القانوني")
                || line.contains("الاسم التجاري")
                || line.contains("رقم الرخصة")
                || line.contains("رقم السجل")
                || line.contains("الصفة")
                || line.contains("رقم الجواز")
                || line.contains("الجنسية")
                || line.contains("اسم صاحب")
                || line.contains("اسم المؤجر")
                || line.contains("تاريخ انتهاء عقد")
                || line.contains("اسم المدير")
                || line.contains("اسم الطرف")
                || line.contains("العنوان")
                || line.contains("الانشطة")
                || line.contains("ملاحظات")
                || line.equalsIgnoreCase("remarks");
    }

    private boolean isColumnHeader(String line) {
        return isHeading(line);
    }

    private boolean isNoise(String line) {
        String lower = line.toLowerCase();
        return lower.contains("voucher")
                || lower.contains("print date")
                || lower.contains("approved electronic")
                || lower.contains("ajmanded")
                || lower.contains("www.")
                || lower.contains("government of ajman")
                || line.contains("وثيقة")
                || line.contains("تاريخ الطباعة")
                || line.contains("رقم الايصال")
                || line.contains("تاريخ الايصال")
                || PASSPORT.matcher(line).matches()
                || SHARE.matcher(line).matches()
                || lower.equals("service agent")
                || lower.contains("owner -")
                || lower.contains("proprietor")
                || lower.contains("the uae")
                || lower.contains("united arab emirates")
                || lower.equals("india")
                || line.contains("وكيل خدمات")
                || line.contains("مالك");
    }
}
