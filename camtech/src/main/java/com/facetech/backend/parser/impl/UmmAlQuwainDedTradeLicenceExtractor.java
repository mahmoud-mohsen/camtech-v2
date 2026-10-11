package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractEmail;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class UmmAlQuwainDedTradeLicenceExtractor {

    private static final Pattern LEASE_CONTRACT_NO = Pattern.compile("(?i)\\b(TC-\\d{3,8})\\b");
    private static final Pattern LICENSE_NO = Pattern.compile("(?i)\\b(LIC-(?:PROF|COM|IND)-\\d{3,8})\\b");
    private static final Pattern REGISTER_NO = Pattern.compile("(?i)registration\\s*no\\.?\\s*\\n\\s*(\\d{5,8})");
    private static final Pattern MOBILE = Pattern.compile(
            "(?<!\\d)(?:00)?(\\+?9715\\d{8}|0?5\\d{8})(?!\\d)");
    private static final Pattern SHARE = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*%$");
    private static final Pattern ROLE = Pattern.compile(
            "(?i)^(manager|owner|partner|service\\s+agent|director)"
                    + "(?:\\s*[|/]?\\s*(manager|owner|partner|service\\s+agent|director))?$");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Z0-9'\\-.\\s]{4,}$");
    /** Business/entity tokens that never appear as person names on UAQ DED licences. */
    private static final Pattern BUSINESS_NAME_TOKEN = Pattern.compile(
            "(?i).*\\b(SERVICES?|TRADING|TRAVEL|TOURISM|CONTRACTING|ESTABLISHMENT|COMPANY|DOCUMENT|CLEARING"
                    + "|TYPING|PRINTING|PHOTOCOPYING|CONSULTANCY|ENTERPRISES?|LLC|L\\.L\\.C|FZCO|FZE"
                    + "|GENERAL|INDUSTRIAL|COMMERCIAL)\\b.*");
    private static final Pattern ACTIVITY_KEYWORD = Pattern.compile(
            "(?i).*\\b(agent|agents|services?|trading|travel|tourism|consult|contracting|clearing"
                    + "|typing|printing|photocopy|follow[- ]?up|transactions?|document)\\b.*");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = dedupeConsecutive(normalized.split("\n"));

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(normalized, lines));
        addIfNotEmpty(result, "licenceType", extractLicenceType(normalized));

        String company = extractMultiLineValue(lines, "trade name", "legal type", "license number");
        String legalType = extractSingleValue(lines, "legal type", "license number");
        String registerNo = extractRegisterNo(normalized, lines);
        String issueDate = extractDateAfter(lines, "issue date");
        String expiryDate = extractDateAfter(lines, "expiry date");
        String companyAr = extractArabicAfterEnglishValue(lines, "trade name", "legal type");
        String legalTypeAr = extractArabicAfterEnglishValue(lines, "legal type", "license number");

        // Google OCR clusters License Details labels; values appear later after "Lic - Prof/Com/Ind".
        if (isLicenseDetailsLabelCluster(lines)) {
            Map<String, String> displaced = extractDisplacedLicenseDetails(lines);
            if (company.isBlank()) {
                company = displaced.getOrDefault("companyName", "");
            }
            if (legalType.isBlank()) {
                legalType = displaced.getOrDefault("legalType", "");
            }
            if (registerNo.isBlank()) {
                registerNo = displaced.getOrDefault("registerNo", "");
            }
            if (issueDate.isBlank()) {
                issueDate = displaced.getOrDefault("issueDate", "");
            }
            if (expiryDate.isBlank()) {
                expiryDate = displaced.getOrDefault("expiryDate", "");
            }
            if (result.getFields().get("licenseNo") == null && displaced.containsKey("licenseNo")) {
                addIfNotEmpty(result, "licenseNo", displaced.get("licenseNo"));
            }
        }
        if (companyAr.isBlank()) {
            companyAr = extractArabicAfterArabicLabel(lines, "الاسم التجاري", "الشكل القانوني", "رقم الرخصة");
        }
        if (legalTypeAr.isBlank()) {
            legalTypeAr = extractArabicAfterArabicLabel(lines, "الشكل القانوني", "رقم الرخصة", "البريد");
        }

        addIfNotEmpty(result, "registerNo", registerNo);
        addIfNotEmpty(result, "companyName", company);
        addIfNotEmpty(result, "businessName", company);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);
        addIfNotEmpty(result, "legalType", legalType);
        addIfNotEmpty(result, "legalTypeAr", legalTypeAr);
        addIfNotEmpty(result, "issueDate", issueDate);
        addIfNotEmpty(result, "expiryDate", expiryDate);
        addIfNotEmpty(result, "email", extractEmail(normalized));
        addIfNotEmpty(result, "mobileNo", extractMobile(normalized));
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(extractActivities(lines), extractArabicActivities(lines)));
        List<Map<String, String>> members = extractMembers(lines, company);
        addIfNotEmpty(result, "licenseMembers", toPersonJson(members));
        addIfNotEmpty(result, "manager", extractManager(members));
        addAddressFields(result, lines);

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("UAQ DED trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String[] dedupeConsecutive(String[] lines) {
        List<String> out = new ArrayList<>();
        String prev = null;
        for (String line : lines) {
            String trimmed = line == null ? "" : line.trim();
            if (prev != null && prev.equals(trimmed)) {
                continue;
            }
            out.add(trimmed);
            prev = trimmed;
        }
        return out.toArray(String[]::new);
    }

    private String extractLicenseNo(String text, String[] lines) {
        Matcher matcher = LICENSE_NO.matcher(text);
        if (matcher.find()) {
            return matcher.group(1).toUpperCase(Locale.ROOT);
        }
        return extractSingleValue(lines, "license number", "issue date");
    }

    private String extractLicenceType(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.contains("lic - com") || lower.contains("lic-com")) {
            return "Commercial";
        }
        if (lower.contains("lic - ind") || lower.contains("lic-ind")) {
            return "Industrial";
        }
        if (lower.contains("lic - prof") || lower.contains("lic-prof")) {
            return "Professional";
        }
        return "";
    }

    private String extractRegisterNo(String text, String[] lines) {
        Matcher matcher = REGISTER_NO.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return extractSingleValue(lines, "registration no", "email", "mobile number");
    }

    /**
     * True when License Details English labels are stacked with no inline values
     * (typical Google Document AI reading order for UAQ DED).
     */
    private boolean isLicenseDetailsLabelCluster(String[] lines) {
        int trade = findExactLabel(lines, "trade name");
        int legal = findExactLabel(lines, "legal type");
        int license = findExactLabel(lines, "license number");
        return trade >= 0 && legal == trade + 1 && license == legal + 1;
    }

    /**
     * Parse displaced License Details values for Google OCR label-cluster layouts.
     * Trade name may appear either before or after the Lic-Prof/Com/Ind banner.
     */
    private Map<String, String> extractDisplacedLicenseDetails(String[] lines) {
        Map<String, String> out = new LinkedHashMap<>();
        int banner = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].matches("(?i).*\\bLic\\s*-\\s*(Prof|Com|Ind)\\b.*")) {
                banner = i;
                break;
            }
        }
        if (banner < 0) {
            return out;
        }

        String tradeName = extractTradeNameNearBanner(lines, banner);
        String legalType = "";
        String licenseNo = "";
        String issue = "";
        String expiry = "";
        String register = "";

        for (int i = banner + 1; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            if (line.equalsIgnoreCase("license activities")
                    || line.equalsIgnoreCase("address details")
                    || line.contains("اطراف الرخصة")
                    || line.contains("انشطة الرخصة")
                    || line.contains("أنشطة الرخصة")) {
                break;
            }
            if (line.equalsIgnoreCase("share") || line.equalsIgnoreCase("role")
                    || line.equalsIgnoreCase("nationality") || line.equalsIgnoreCase("name")) {
                continue;
            }
            if (isDisplacedDetailsSkipLine(line)) {
                continue;
            }
            if (line.contains("@") || (MOBILE.matcher(line).find() && line.matches("^[+\\d\\s-]{8,}$"))) {
                continue;
            }

            Matcher lic = LICENSE_NO.matcher(line);
            if (lic.find()) {
                if (licenseNo.isBlank()) {
                    licenseNo = lic.group(1).toUpperCase(Locale.ROOT);
                }
                continue;
            }
            String date = firstDate(line);
            if (!date.isEmpty()) {
                if (issue.isBlank()) {
                    issue = normalizeDate(date);
                } else if (expiry.isBlank()) {
                    expiry = normalizeDate(date);
                }
                continue;
            }
            if (line.matches("\\d{5,8}") && !licenseNo.isBlank() && !issue.isBlank() && register.isBlank()) {
                register = line;
                if (!expiry.isBlank()) {
                    break;
                }
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (ROLE.matcher(line).matches() || isLegalTypePhrase(line)) {
                if (legalType.isBlank()) {
                    legalType = capitalizeWords(line);
                }
                continue;
            }
            if ((EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z0-9'\\-.\\s]{3,}$"))
                    && !line.toUpperCase(Locale.ROOT).contains("DEPARTMENT OF ECONOMIC")
                    && !line.toUpperCase(Locale.ROOT).contains("GOVERNMENT OF")) {
                if (tradeName.isBlank() && legalType.isBlank() && licenseNo.isBlank()) {
                    tradeName = line;
                } else if (!tradeName.isBlank() && legalType.isBlank() && licenseNo.isBlank()
                        && looksLikeTradeNameContinuation(line)) {
                    tradeName = (tradeName + " " + line).replaceAll("\\s{2,}", " ").trim();
                }
            }

            if (!licenseNo.isBlank() && !issue.isBlank() && !expiry.isBlank() && !register.isBlank()) {
                break;
            }
        }

        if (!tradeName.isBlank()) {
            out.put("companyName", tradeName);
        }
        if (!legalType.isBlank()) {
            out.put("legalType", legalType);
        }
        if (!licenseNo.isBlank()) {
            out.put("licenseNo", licenseNo);
        }
        if (!issue.isBlank()) {
            out.put("issueDate", issue);
        }
        if (!expiry.isBlank()) {
            out.put("expiryDate", expiry);
        }
        if (!register.isBlank()) {
            out.put("registerNo", register);
        }
        return out;
    }

    /**
     * Commercial Google OCR often places Trade Name immediately before the Lic-Com/Prof banner.
     */
    private String extractTradeNameNearBanner(String[] lines, int banner) {
        int from = findExactLabel(lines, "license members");
        if (from < 0) {
            from = Math.max(0, banner - 12);
        }
        StringBuilder sb = new StringBuilder();
        for (int i = from + 1; i < banner; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line) || isMemberHeader(line) || isExactLabel(line)
                    || isDisplacedDetailsSkipLine(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (SHARE.matcher(line).matches() || ROLE.matcher(line).matches() || isLegalTypePhrase(line)) {
                continue;
            }
            if (EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z0-9'\\-.\\s]{3,}$")
                    || looksLikeTradeNameContinuation(line)) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(line);
            }
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private boolean looksLikeTradeNameContinuation(String line) {
        String upper = line.toUpperCase(Locale.ROOT);
        return upper.contains("L.L.C") || upper.contains("LLC") || upper.contains("FZE")
                || upper.contains("FZCO") || BUSINESS_NAME_TOKEN.matcher(upper).matches()
                || EN_NAME.matcher(line).matches();
    }

    private boolean isDisplacedDetailsSkipLine(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return line.equals("الصفة") || line.equals("الحصص") || line.equals("الجنسية")
                || line.equals("بيانات الرخصة") || line.equals("الاسم التجاري")
                || line.equals("الشكل القانوني") || line.equals("الاسم")
                || line.contains("رقم الرخصة") || line.contains("تاريخ الاصدار")
                || line.contains("تاريخ الإصدار") || line.contains("تاريخ الانتهاء")
                || line.contains("تاريخ الإنتهاء") || line.contains("رقم السجل")
                || line.contains("البريد") || line.contains("رقم الهاتف")
                || line.contains("دائرة التنمية")
                || lower.contains("department of economic")
                || lower.equals("license members")
                || lower.equals("license details");
    }

    private boolean isLegalTypePhrase(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("service agent")
                || lower.equals("limited liability company")
                || lower.equals("sole establishment")
                || lower.equals("civil company")
                || lower.contains("limited liability");
    }

    private String extractArabicAfterArabicLabel(String[] lines, String label, String... stopLabels) {
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains(label)) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return "";
        }
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            boolean stop = false;
            for (String s : stopLabels) {
                if (line.contains(s)) {
                    stop = true;
                    break;
                }
            }
            if (stop || isExactLabel(line)) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractSingleValue(String[] lines, String startLabel, String... stopLabels) {
        int start = findExactLabel(lines, startLabel);
        if (start < 0) {
            return "";
        }
        int stop = findNextLabel(lines, start + 1, stopLabels);
        if (stop < 0) {
            stop = Math.min(start + 8, lines.length);
        }
        for (int i = start + 1; i < stop; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z0-9].*")) {
                continue;
            }
            if (line.matches(".*[A-Za-z0-9].*")) {
                return line;
            }
        }
        return "";
    }

    private String extractMultiLineValue(String[] lines, String startLabel, String... stopLabels) {
        int start = findExactLabel(lines, startLabel);
        if (start < 0) {
            return "";
        }
        int stop = findNextLabel(lines, start + 1, stopLabels);
        if (stop < 0) {
            stop = Math.min(start + 10, lines.length);
        }
        StringBuilder sb = new StringBuilder();
        for (int i = start + 1; i < stop; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z0-9].*")) {
                break;
            }
            if (line.matches(".*[A-Za-z0-9].*")) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(line);
            }
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private String extractArabicAfterEnglishValue(String[] lines, String startLabel, String... stopLabels) {
        int start = findExactLabel(lines, startLabel);
        if (start < 0) {
            return "";
        }
        int stop = findNextLabel(lines, start + 1, stopLabels);
        if (stop < 0) {
            stop = Math.min(start + 12, lines.length);
        }
        List<String> arabicParts = new ArrayList<>();
        boolean seenEnglish = false;
        for (int i = start + 1; i < stop; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            if (line.matches(".*[A-Za-z]{2,}.*")) {
                seenEnglish = true;
                continue;
            }
            if (seenEnglish && arabicTextProcessor.containsArabic(line)) {
                arabicParts.add(arabicTextProcessor.normalizeArabic(line));
            }
        }
        return String.join(" ", arabicParts).trim();
    }

    private String extractDateAfter(String[] lines, String label) {
        int start = findExactLabel(lines, label);
        if (start < 0) {
            return "";
        }
        for (int i = start; i < Math.min(start + 6, lines.length); i++) {
            String date = firstDate(lines[i]);
            if (!date.isEmpty()) {
                return normalizeDate(date);
            }
        }
        return "";
    }

    private String extractMobile(String text) {
        Matcher matcher = MOBILE.matcher(text);
        return matcher.find() ? matcher.group(1) : "";
    }

    private List<String> extractActivities(String[] lines) {
        int start = findExactLabel(lines, "license activities");
        if (start < 0) {
            return List.of();
        }
        int end = findExactLabel(lines, "address details");
        if (end < 0 || end <= start) {
            end = lines.length;
        }
        LinkedHashSet<String> activities = new LinkedHashSet<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            if (line.contains("انشطة الرخصة") || line.contains("أنشطة الرخصة")) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{4,}.*")) {
                continue;
            }
            if (looksLikeDisplacedPersonName(line)) {
                continue;
            }
            if (line.matches("(?i)\\d{1,2}\\s*of\\s*\\d{1,2}")) {
                continue;
            }
            if (ACTIVITY_KEYWORD.matcher(line).matches() || looksLikeActivityPhrase(line)) {
                activities.add(line);
            }
        }
        return new ArrayList<>(activities);
    }

    private boolean looksLikeActivityPhrase(String line) {
        // Activity lines are usually title-case / mixed phrases, not ALL-CAPS person names.
        if (EN_NAME.matcher(line).matches() && line.split("\\s+").length >= 2
                && !ACTIVITY_KEYWORD.matcher(line).matches()) {
            return false;
        }
        return line.matches(".*[A-Za-z]{4,}.*");
    }

    private boolean looksLikeDisplacedPersonName(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        if (ACTIVITY_KEYWORD.matcher(line).matches()) {
            return false;
        }
        if (BUSINESS_NAME_TOKEN.matcher(line.toUpperCase(Locale.ROOT)).matches()) {
            return false;
        }
        return EN_NAME.matcher(line).matches() && line.split("\\s+").length >= 2;
    }

    private List<String> extractArabicActivities(String[] lines) {
        LinkedHashSet<String> activities = new LinkedHashSet<>();
        int start = findExactLabel(lines, "license activities");
        int end = findExactLabel(lines, "address details");
        if (start >= 0) {
            if (end < 0 || end <= start) {
                end = lines.length;
            }
            for (int i = start + 1; i < end; i++) {
                String line = lines[i].trim();
                if (line.isEmpty() || isNoise(line)) {
                    continue;
                }
                if (line.contains("انشطة الرخصة") || line.contains("أنشطة الرخصة")) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                    activities.add(arabicTextProcessor.normalizeArabic(line));
                }
            }
        }
        // Google OCR often places Arabic activities under انشطة الرخصة after address block.
        if (activities.isEmpty()) {
            int arStart = -1;
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].contains("انشطة الرخصة") || lines[i].contains("أنشطة الرخصة")) {
                    arStart = i;
                    break;
                }
            }
            if (arStart >= 0) {
                for (int i = arStart + 1; i < Math.min(arStart + 12, lines.length); i++) {
                    String line = lines[i].trim();
                    if (line.isEmpty() || isNoise(line)) {
                        continue;
                    }
                    if (line.contains("تفاصيل العنوان") || line.contains("رقم عقد")
                            || line.contains("مالك العقار") || isExactLabel(line)) {
                        break;
                    }
                    if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")
                            && line.length() >= 4) {
                        activities.add(arabicTextProcessor.normalizeArabic(line));
                    }
                }
            }
        }
        return new ArrayList<>(activities);
    }

    private List<Map<String, String>> extractMembers(String[] lines, String companyName) {
        int start = findExactLabel(lines, "license members");
        if (start < 0) {
            return List.of();
        }
        int activitiesIdx = findExactLabel(lines, "license activities");
        int end = findExactLabel(lines, "address details");
        if (end < 0) {
            end = lines.length;
        }
        // Stop member recovery at Arabic activities heading when present inside the window.
        for (int i = Math.max(start, activitiesIdx < 0 ? start : activitiesIdx);
             i < end; i++) {
            if (lines[i].contains("انشطة الرخصة") || lines[i].contains("أنشطة الرخصة")) {
                end = i;
                break;
            }
        }

        List<Map<String, String>> members = new ArrayList<>();
        String share = "";
        String role = "";
        String nationality = "";
        StringBuilder nameEn = new StringBuilder();
        StringBuilder nameAr = new StringBuilder();
        boolean pastLicenseDump = !isLicenseDetailsLabelCluster(lines);
        boolean inActivityZone = false;
        boolean namesStarted = false;

        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            if (isMemberHeader(line)) {
                // Only collect person names after the Name / الاسم column header.
                if (line.equalsIgnoreCase("name") || line.equals("الاسم")) {
                    namesStarted = true;
                    nameAr.setLength(0);
                }
                continue;
            }
            if (activitiesIdx >= 0 && i >= activitiesIdx) {
                inActivityZone = true;
                namesStarted = true;
            }
            if (!pastLicenseDump) {
                if (LICENSE_NO.matcher(line).find() || line.matches("\\d{5,8}")) {
                    pastLicenseDump = true;
                }
                continue;
            }
            Matcher shareMatcher = SHARE.matcher(line);
            if (shareMatcher.matches()) {
                // Share before English name belongs to the in-progress Arabic-named member.
                if (nameEn.length() > 0
                        || (nameAr.length() > 0 && !share.isBlank() && !nationality.isBlank())) {
                    flushMember(members, share, role, nationality, nameEn, nameAr, companyName);
                    role = "";
                    nationality = "";
                    nameEn = new StringBuilder();
                    nameAr = new StringBuilder();
                }
                share = shareMatcher.group(1) + "%";
                continue;
            }
            if (ROLE.matcher(line).matches()) {
                role = normalizeCombinedRole(line);
                continue;
            }
            if (isNationality(line)) {
                nationality = capitalizeWords(line);
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                String normalized = arabicTextProcessor.normalizeArabic(line);
                if (isArabicMemberNoise(normalized)) {
                    continue;
                }
                // "وكيل خدمات" is the legal-type phrase on UAQ DED; ignore until a person name starts.
                if ((normalized.equals("وكيل خدمات") || normalized.contains("وكيل خدمات"))
                        && nameEn.length() == 0 && nameAr.length() == 0) {
                    continue;
                }
                String arabicRole = mapArabicRole(normalized);
                if (arabicRole != null) {
                    if (nameEn.length() > 0) {
                        flushMember(members, share, role, nationality, nameEn, nameAr, companyName);
                        share = "";
                        role = "";
                        nationality = "";
                        nameEn = new StringBuilder();
                        nameAr = new StringBuilder();
                    }
                    role = arabicRole;
                    continue;
                }
                String arabicNationality = mapArabicNationality(normalized);
                if (arabicNationality != null) {
                    if (nameEn.length() > 0) {
                        flushMember(members, share, role, nationality, nameEn, nameAr, companyName);
                        share = "";
                        role = "";
                        nationality = "";
                        nameEn = new StringBuilder();
                        nameAr = new StringBuilder();
                    }
                    nationality = arabicNationality;
                    continue;
                }
                if (!namesStarted || inActivityZone) {
                    continue;
                }
                // New Arabic person name while previous English name is open → start next member.
                if (nameEn.length() > 0) {
                    flushMember(members, share, role, nationality, nameEn, nameAr, companyName);
                    share = "";
                    role = "";
                    nationality = "";
                    nameEn = new StringBuilder();
                    nameAr = new StringBuilder();
                }
                if (nameAr.length() > 0) {
                    nameAr.append(' ');
                }
                nameAr.append(normalized);
                continue;
            }
            if (isMemberNameNoise(line) || isLegalTypePhrase(line)) {
                continue;
            }
            if (inActivityZone) {
                // Google OCR may dump the next member's English name into the activities block.
                if (line.equalsIgnoreCase("license activities")
                        || line.matches("(?i)\\d{1,2}\\s*of\\s*\\d{1,2}")
                        || ACTIVITY_KEYWORD.matcher(line).matches()
                        || (looksLikeActivityPhrase(line) && !looksLikeDisplacedPersonName(line))) {
                    continue;
                }
                if (!looksLikeDisplacedPersonName(line)
                        && !(EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z'\\-.\\s]{3,}$"))) {
                    continue;
                }
            } else if (!namesStarted) {
                continue;
            }
            if (EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z'\\-.\\s]{3,}$")) {
                if (nameEn.length() > 0) {
                    nameEn.append(' ');
                }
                nameEn.append(line);
            }
        }
        flushMember(members, share, role, nationality, nameEn, nameAr, companyName);
        return members;
    }

    private void flushMember(List<Map<String, String>> members, String share, String role,
                             String nationality, StringBuilder nameEn, StringBuilder nameAr,
                             String companyName) {
        if (nameEn.length() == 0 && nameAr.length() == 0) {
            return;
        }
        String name = nameEn.toString().replaceAll("\\s{2,}", " ").trim();
        String arName = nameAr.toString().replaceAll("\\s{2,}", " ").trim();
        if (!name.isBlank() && !isPlausibleMemberName(name, companyName)) {
            if (arName.isBlank()) {
                return;
            }
            name = "";
        }
        if (name.isBlank() && arName.isBlank()) {
            return;
        }
        // Real UAQ DED member rows carry share and/or nationality; trade-name dumps do not.
        if (share.isBlank() && nationality.isBlank() && role.isBlank()) {
            return;
        }
        Map<String, String> person = new LinkedHashMap<>();
        if (!name.isBlank()) {
            person.put("nameEn", name);
        }
        if (!arName.isBlank()) {
            person.put("nameAr", arName);
        }
        if (!nationality.isBlank()) {
            person.put("nationality", nationality);
        }
        if (!role.isBlank()) {
            person.put("role", role);
        }
        if (!share.isBlank()) {
            person.put("share", share);
        }
        members.add(person);
        nameEn.setLength(0);
        nameAr.setLength(0);
    }

    private String mapArabicRole(String normalized) {
        if (normalized.contains("مدير")) {
            return "Manager";
        }
        if (normalized.contains("مالك")) {
            return "Owner";
        }
        if (normalized.contains("شريك")) {
            return "Partner";
        }
        if (normalized.contains("وكيل")) {
            return "Service Agent";
        }
        return null;
    }

    private String mapArabicNationality(String normalized) {
        if (normalized.contains("الإمارات") || normalized.contains("الامارات")) {
            return "United Arab Emirates";
        }
        if (normalized.contains("مصر")) {
            return "Egypt";
        }
        if (normalized.contains("باكستان")) {
            return "Pakistan";
        }
        if (normalized.contains("الهند")) {
            return "India";
        }
        if (normalized.contains("اردن") || normalized.contains("الأردن") || normalized.contains("الاردن")) {
            return "Jordan";
        }
        if (normalized.contains("سوري")) {
            return "Syria";
        }
        if (normalized.contains("لبن")) {
            return "Lebanon";
        }
        if (normalized.contains("سعود")) {
            return "Saudi Arabia";
        }
        if (normalized.contains("بنغلاد") || normalized.contains("بنجلاد")) {
            return "Bangladesh";
        }
        if (normalized.contains("فلبين")) {
            return "Philippines";
        }
        return null;
    }

    private boolean isArabicMemberNoise(String normalized) {
        return normalized.contains("اطراف الرخصة")
                || normalized.equals("الاسم")
                || normalized.contains("الجنسية")
                || normalized.contains("الصفة")
                || normalized.contains("الحصص")
                || normalized.contains("رقم الرخصة")
                || normalized.contains("تاريخ")
                || normalized.contains("البريد")
                || normalized.contains("الهاتف")
                || normalized.contains("بيانات الرخصة")
                || normalized.contains("الاسم التجاري")
                || normalized.contains("الشكل القانوني")
                || normalized.contains("دائرة التنمية")
                || normalized.contains("انشطة الرخصة")
                || normalized.contains("أنشطة الرخصة")
                || normalized.contains("تفاصيل العنوان")
                || normalized.contains("رقم عقد")
                || normalized.contains("مالك العقار");
    }

    /**
     * Reject Google-OCR header junk that lands inside the License Members block
     * (trade name, licence number, issuing authority).
     */
    private boolean isMemberNameNoise(String line) {
        if (line == null || line.isBlank()) {
            return true;
        }
        String upper = line.toUpperCase(Locale.ROOT).trim();
        if (LICENSE_NO.matcher(upper).find()) {
            return true;
        }
        if (upper.contains("DEPARTMENT OF ECONOMIC")
                || upper.contains("GOVERNMENT OF UMM")
                || upper.contains("GOVERNMENT OF UMM AL")) {
            return true;
        }
        if (upper.equals("LICENSE DETAILS") || upper.equals("COMMERCIAL REGISTER")) {
            return true;
        }
        if (BUSINESS_NAME_TOKEN.matcher(upper).matches()) {
            return true;
        }
        return false;
    }

    private boolean isPlausibleMemberName(String name, String companyName) {
        if (name == null || name.isBlank()) {
            return false;
        }
        String upper = name.toUpperCase(Locale.ROOT).trim();
        if (isMemberNameNoise(upper)) {
            return false;
        }
        if (BUSINESS_NAME_TOKEN.matcher(upper).matches()) {
            return false;
        }
        // Strip accidental role words glued onto a person name by OCR.
        upper = upper.replaceAll("(?i)\\b(OWNER|MANAGER|PARTNER|DIRECTOR|SERVICE\\s+AGENT)\\b", "")
                .replaceAll("\\s{2,}", " ")
                .trim();
        if (upper.isBlank()) {
            return false;
        }
        if (companyName != null && !companyName.isBlank()) {
            String companyUpper = companyName.toUpperCase(Locale.ROOT).trim();
            if (upper.equals(companyUpper)
                    || upper.contains(companyUpper)
                    || companyUpper.contains(upper)
                    || sharesSignificantTokens(upper, companyUpper)) {
                return false;
            }
        }
        String[] parts = upper.split("\\s+");
        return parts.length >= 2;
    }

    /** True when two phrases share enough significant tokens (trade name vs fake member). */
    private boolean sharesSignificantTokens(String a, String b) {
        LinkedHashSet<String> tokensA = significantTokens(a);
        LinkedHashSet<String> tokensB = significantTokens(b);
        if (tokensA.isEmpty() || tokensB.isEmpty()) {
            return false;
        }
        int overlap = 0;
        for (String t : tokensA) {
            if (tokensB.contains(t)) {
                overlap++;
            }
        }
        int min = Math.min(tokensA.size(), tokensB.size());
        return overlap >= 2 && overlap * 2 >= min;
    }

    private LinkedHashSet<String> significantTokens(String phrase) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String part : phrase.toUpperCase(Locale.ROOT).split("\\s+")) {
            if (part.length() < 3) {
                continue;
            }
            if (part.equals("THE") || part.equals("AND") || part.equals("FOR") || part.equals("OF")) {
                continue;
            }
            out.add(part);
        }
        return out;
    }

    private String extractManager(List<Map<String, String>> members) {
        for (Map<String, String> member : members) {
            String role = member.getOrDefault("role", "").toLowerCase(Locale.ROOT);
            if (role.contains("manager") || role.contains("director")) {
                return member.getOrDefault("nameEn", "");
            }
        }
        return "";
    }

    private String normalizeCombinedRole(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        boolean manager = lower.contains("manager") || lower.contains("director");
        boolean owner = lower.contains("owner");
        boolean partner = lower.contains("partner");
        boolean serviceAgent = lower.contains("service");
        // Prefer the management role when OCR joins Owner|Manager on one line.
        if (manager) {
            return "Manager";
        }
        if (owner) {
            return "Owner";
        }
        if (partner) {
            return "Partner";
        }
        if (serviceAgent) {
            return "Service Agent";
        }
        return capitalizeWords(line.replace('|', ' ').replace('/', ' '));
    }

    private void addAddressFields(DocumentFieldsDto result, String[] lines) {
        int start = findExactLabel(lines, "address details");
        if (start < 0) {
            return;
        }

        String lease = extractLeaseContractNo(lines, start);
        String owner = extractPropertyOwner(lines, start);
        String region = valueAfter(lines, start, "region", false);
        String street = valueAfter(lines, start, "street", true);

        // Google OCR often stacks Address Details labels; values appear later in a dump.
        if (isAddressDetailsLabelCluster(lines, start)
                || lease.isBlank() || region.isBlank() || (street.isBlank() && owner.isBlank())) {
            Map<String, String> displaced = extractDisplacedAddressDetails(lines, start);
            if (lease.isBlank()) {
                lease = displaced.getOrDefault("leaseContractNo", "");
            }
            if (owner.isBlank()) {
                owner = displaced.getOrDefault("propertyOwner", "");
            }
            if (region.isBlank()) {
                region = displaced.getOrDefault("region", "");
            }
            if (street.isBlank()) {
                street = displaced.getOrDefault("street", "");
            }
        }

        // Lease must look like a contract number, not a person/place name grabbed by mistake.
        if (!lease.isBlank() && !LEASE_CONTRACT_NO.matcher(lease).find()) {
            Matcher m = LEASE_CONTRACT_NO.matcher(String.join("\n", lines));
            lease = m.find() ? m.group(1).toUpperCase(Locale.ROOT) : "";
        } else if (!lease.isBlank()) {
            Matcher m = LEASE_CONTRACT_NO.matcher(lease);
            lease = m.find() ? m.group(1).toUpperCase(Locale.ROOT) : lease;
        }

        // If street accidentally captured a person-shaped value, treat it as property owner.
        if (owner.isBlank() && !street.isBlank() && street.split("\\s+").length >= 3
                && street.equals(street.toUpperCase(Locale.ROOT))
                && !looksLikePlaceName(street)) {
            owner = street;
            street = "";
        }
        // Street must not be a fragment of the property owner.
        if (!owner.isBlank() && !street.isBlank()
                && (owner.contains(street) || street.contains(owner)
                || sharesSignificantTokens(owner.toUpperCase(Locale.ROOT), street.toUpperCase(Locale.ROOT)))) {
            street = "";
        }
        // If region is still blank but street looks like a place, reclassify.
        if (region.isBlank() && !street.isBlank() && looksLikePlaceName(street)) {
            region = street;
            street = "";
        }

        addIfNotEmpty(result, "leaseContractNo", lease);
        addIfNotEmpty(result, "propertyOwner", owner);
        addIfNotEmpty(result, "region", region);
        addIfNotEmpty(result, "street", street);

        List<String> parts = new ArrayList<>();
        if (!street.isBlank()) {
            parts.add(street);
        }
        if (!region.isBlank()) {
            parts.add(region);
        }
        if (!lease.isBlank()) {
            parts.add("Lease " + lease);
        }
        addIfNotEmpty(result, "address", String.join(", ", parts));
    }

    private boolean isAddressDetailsLabelCluster(String[] lines, int start) {
        int lease = -1;
        int owner = -1;
        int region = -1;
        for (int i = start; i < Math.min(start + 12, lines.length); i++) {
            String lower = lines[i].trim().toLowerCase(Locale.ROOT);
            if (lower.equals("lease contract no") && lease < 0) {
                lease = i;
            } else if (lower.equals("property owner") && owner < 0) {
                owner = i;
            } else if (lower.equals("region") && region < 0) {
                region = i;
            }
        }
        if (lease < 0 || owner < 0 || region < 0) {
            return false;
        }
        // Labels stacked with little/no value between Lease and Property Owner.
        boolean leaseThenOwner = owner > lease && owner - lease <= 2;
        boolean ownerThenRegion = region > owner;
        if (!leaseThenOwner || !ownerThenRegion) {
            return false;
        }
        // If Property Owner has an English value before Region, it is not a full cluster —
        // still treat as partial cluster when Region/Street have no immediate values.
        String regionImmediate = valueAfter(lines, start, "region", false);
        return regionImmediate.isBlank();
    }

    /**
     * After Address Details labels, Google OCR dumps values roughly as:
     * Property Owner → Region → (boilerplate) → Lease Contract No (TC-*) → Street.
     */
    private Map<String, String> extractDisplacedAddressDetails(String[] lines, int start) {
        Map<String, String> out = new LinkedHashMap<>();
        int dumpStart = start + 1;
        for (int i = start + 1; i < Math.min(start + 20, lines.length); i++) {
            String lower = lines[i].trim().toLowerCase(Locale.ROOT);
            if (lower.equals("lease contract no") || lower.equals("property owner")
                    || lower.equals("region") || lower.equals("street") || lower.equals("note")
                    || lower.equals("address details")) {
                dumpStart = i + 1;
                continue;
            }
            break;
        }

        String owner = "";
        String region = "";
        String lease = "";
        String street = "";
        StringBuilder ownerBuf = new StringBuilder();

        // Inline Property Owner between its label and Region (partial cluster layouts).
        int ownerLabel = -1;
        int regionLabel = -1;
        for (int i = start; i < Math.min(start + 20, lines.length); i++) {
            String lower = lines[i].trim().toLowerCase(Locale.ROOT);
            if (lower.equals("property owner") && ownerLabel < 0) {
                ownerLabel = i;
            }
            if (lower.equals("region") && regionLabel < 0) {
                regionLabel = i;
            }
        }
        if (ownerLabel >= 0 && regionLabel > ownerLabel) {
            for (int i = ownerLabel + 1; i < regionLabel; i++) {
                String line = lines[i].trim();
                if (line.isEmpty() || isNoise(line) || isExactLabel(line)) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                    continue;
                }
                if (EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z0-9'\\-.\\s]{3,}$")) {
                    if (ownerBuf.length() > 0) {
                        ownerBuf.append(' ');
                    }
                    ownerBuf.append(line);
                }
            }
            if (ownerBuf.length() > 0) {
                owner = ownerBuf.toString().replaceAll("\\s{2,}", " ").trim();
                ownerBuf.setLength(0);
            }
        }

        for (int i = dumpStart; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line) || isExactLabel(line)) {
                continue;
            }
            String lower = line.toLowerCase(Locale.ROOT);

            Matcher leaseMatcher = LEASE_CONTRACT_NO.matcher(line);
            if (leaseMatcher.find()) {
                if (lease.isBlank()) {
                    lease = leaseMatcher.group(1).toUpperCase(Locale.ROOT);
                }
                continue;
            }

            if (lower.startsWith("this document is considered")
                    || lower.equals("print date")
                    || lower.equals("payment voucher")
                    || lower.equals("no")
                    || lower.startsWith("ded_pv_")
                    || lower.contains("تفاصيل العنوان")
                    || lower.contains("رقم عقد")
                    || lower.contains("مالك العقار")
                    || lower.contains("المنطقة")
                    || lower.contains("الشارع")
                    || lower.contains("ملاحظة")
                    || lower.contains("انشطة الرخصة")
                    || lower.contains("أنشطة الرخصة")
                    || lower.contains("تعتبر هذه")
                    || lower.startsWith("this is a certified")) {
                if (owner.isBlank() && ownerBuf.length() > 0) {
                    owner = ownerBuf.toString().replaceAll("\\s{2,}", " ").trim();
                    ownerBuf.setLength(0);
                }
                // Keep scanning for TC-* / street that often appear after print/voucher lines.
                continue;
            }

            if (firstDate(line).length() > 0 || line.matches("(?i)\\d{1,2}\\s*of\\s*\\d{1,2}")
                    || line.equalsIgnoreCase("undefined")) {
                continue;
            }

            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                if (owner.isBlank() && ownerBuf.length() > 0) {
                    owner = ownerBuf.toString().replaceAll("\\s{2,}", " ").trim();
                    ownerBuf.setLength(0);
                }
                // Prefer the first short Arabic line as street (after owner/region are known).
                if (street.isBlank() && line.length() >= 2 && !line.contains("رقم")
                        && (!owner.isBlank() || !region.isBlank() || !lease.isBlank())) {
                    street = arabicTextProcessor.normalizeArabic(line);
                }
                continue;
            }

            if (!(EN_NAME.matcher(line).matches()
                    || line.matches("^[A-Z][A-Za-z0-9'\\-.\\s]{2,}$")
                    || line.matches("^[A-Za-z][A-Za-z0-9'\\-.\\s]{2,}$"))) {
                continue;
            }

            // Never re-assign property-owner fragments into street/region.
            String ownerSoFar = !owner.isBlank() ? owner : ownerBuf.toString();
            if (!ownerSoFar.isBlank()
                    && (ownerSoFar.contains(line) || line.contains(ownerSoFar)
                    || sharesSignificantTokens(ownerSoFar.toUpperCase(Locale.ROOT),
                    line.toUpperCase(Locale.ROOT)))) {
                continue;
            }

            if (looksLikePlaceName(line)) {
                if (owner.isBlank() && ownerBuf.length() > 0) {
                    owner = ownerBuf.toString().replaceAll("\\s{2,}", " ").trim();
                    ownerBuf.setLength(0);
                }
                if (region.isBlank()) {
                    region = line;
                }
                continue;
            }

            // Multi-token Latin lines before region/lease are property owner (may be multi-line).
            if (owner.isBlank() && region.isBlank() && lease.isBlank()) {
                String[] tokens = line.trim().split("\\s+");
                if (tokens.length >= 2 && !BUSINESS_NAME_TOKEN.matcher(line.toUpperCase(Locale.ROOT)).matches()) {
                    if (ownerBuf.length() > 0) {
                        ownerBuf.append(' ');
                    }
                    ownerBuf.append(line);
                    continue;
                }
            }

            if (owner.isBlank() && ownerBuf.length() > 0) {
                owner = ownerBuf.toString().replaceAll("\\s{2,}", " ").trim();
                ownerBuf.setLength(0);
            }

            if (street.isBlank() && !line.equalsIgnoreCase(region) && !line.equalsIgnoreCase(owner)) {
                street = line;
            }
        }

        if (owner.isBlank() && ownerBuf.length() > 0) {
            owner = ownerBuf.toString().replaceAll("\\s{2,}", " ").trim();
        }

        if (!owner.isBlank()) {
            out.put("propertyOwner", owner);
        }
        if (!region.isBlank()) {
            out.put("region", region);
        }
        if (!lease.isBlank()) {
            out.put("leaseContractNo", lease);
        }
        if (!street.isBlank()) {
            out.put("street", street);
        }
        return out;
    }

    private String extractLeaseContractNo(String[] lines, int start) {
        String inline = valueAfter(lines, start, "lease contract no", false);
        if (!inline.isBlank()) {
            Matcher m = LEASE_CONTRACT_NO.matcher(inline);
            if (m.find()) {
                return m.group(1).toUpperCase(Locale.ROOT);
            }
        }
        for (int i = start; i < Math.min(start + 40, lines.length); i++) {
            Matcher m = LEASE_CONTRACT_NO.matcher(lines[i]);
            if (m.find()) {
                return m.group(1).toUpperCase(Locale.ROOT);
            }
        }
        return "";
    }

    private String extractPropertyOwner(String[] lines, int start) {
        int ownerIdx = -1;
        int stopIdx = lines.length;
        for (int i = start; i < lines.length; i++) {
            String lower = lines[i].trim().toLowerCase(Locale.ROOT);
            if (lower.equals("property owner") && ownerIdx < 0) {
                ownerIdx = i;
            }
            if (ownerIdx >= 0 && (lower.equals("region") || lower.equals("street") || lower.equals("note"))) {
                stopIdx = i;
                break;
            }
        }
        if (ownerIdx < 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = ownerIdx + 1; i < stopIdx; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line) || isExactLabel(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                break;
            }
            if (LEASE_CONTRACT_NO.matcher(line).find()) {
                break;
            }
            if (EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z0-9'\\-.\\s]{3,}$")) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(line);
            }
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private boolean looksLikePlaceName(String line) {
        String trimmed = line.trim();
        if (LEASE_CONTRACT_NO.matcher(trimmed).find()) {
            return false;
        }
        // UAQ region lines: "Al …", "Umm …", or a place phrase ending with a unit number.
        return trimmed.matches("(?i)^Al\\s+\\S+.*")
                || trimmed.matches("(?i)^Umm\\b.*")
                || trimmed.matches("(?i)^[A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,4}\\s+\\d+$")
                || trimmed.matches("(?i)^[A-Za-z][A-Za-z'\\-]*\\d+$");
    }

    private String valueAfter(String[] lines, int from, String label, boolean allowArabic) {
        int idx = -1;
        for (int i = from; i < lines.length; i++) {
            if (lines[i].trim().equalsIgnoreCase(label)) {
                idx = i;
                break;
            }
        }
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isNoise(line)) {
                continue;
            }
            // Next section/column label means this field has no inline value.
            if (isExactLabel(line)) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z0-9].*")) {
                if (allowArabic) {
                    return arabicTextProcessor.normalizeArabic(line);
                }
                continue;
            }
            if (line.matches(".*[A-Za-z0-9].*")) {
                return line;
            }
        }
        return "";
    }

    private int findExactLabel(String[] lines, String label) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().equalsIgnoreCase(label)) {
                return i;
            }
        }
        return findLine(lines, "(?i)^" + Pattern.quote(label) + "$");
    }

    private int findNextLabel(String[] lines, int from, String... labels) {
        for (int i = from; i < lines.length; i++) {
            String current = lines[i].trim().toLowerCase(Locale.ROOT);
            for (String label : labels) {
                if (current.equals(label.toLowerCase(Locale.ROOT))) {
                    return i;
                }
            }
        }
        return -1;
    }

    private boolean isExactLabel(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("trade name")
                || lower.equals("legal type")
                || lower.equals("license number")
                || lower.equals("issue date")
                || lower.equals("expiry date")
                || lower.equals("registration no")
                || lower.equals("email")
                || lower.equals("mobile number")
                || lower.equals("license members")
                || lower.equals("license activities")
                || lower.equals("address details")
                || lower.equals("region")
                || lower.equals("street")
                || lower.equals("lease contract no")
                || lower.equals("property owner")
                || lower.equals("share")
                || lower.equals("role")
                || lower.equals("nationality")
                || lower.equals("name")
                || lower.equals("note")
                || lower.equals("print date")
                || lower.equals("payment voucher")
                || lower.equals("no");
    }

    private boolean isMemberHeader(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("share") || lower.equals("role") || lower.equals("nationality") || lower.equals("name");
    }

    private boolean isNoise(String line) {
        return line.equals("^") || line.equals("`") || line.equals("f") || line.equals("-")
                || line.matches("^[A-Z]$") || line.matches("^\\d+\\s+of\\s+\\d+$");
    }

    private boolean isNationality(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("united arab emirates")
                || lower.equals("uae")
                || lower.equals("egypt")
                || lower.equals("india")
                || lower.equals("pakistan")
                || lower.equals("jordan")
                || lower.equals("saudi arabia")
                || lower.equals("oman")
                || lower.equals("syria")
                || lower.equals("lebanon")
                || lower.equals("bangladesh")
                || lower.equals("philippines");
    }

    private String capitalizeWords(String value) {
        String[] parts = value.trim().toLowerCase(Locale.ROOT).split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return sb.toString();
    }
}
