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
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildSimpleJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLineFrom;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.linkedMap;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class AjmanAncfzTradeLicenceExtractor {

    private static final Pattern LICENSE_NO = Pattern.compile("License Number\\s+(\\d{10,16})");
    private static final Pattern LICENSE_NO_LINE = Pattern.compile("^\\d{10,16}$");
    private static final Pattern PASSPORT = Pattern.compile("^[A-Z]{1,2}\\d{6,10}$");
    private static final Pattern PASSPORT_IN_LINE = Pattern.compile("([A-Z]{1,2}\\d{6,10})");
    private static final Pattern SHARE_PERCENT = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*%");
    private static final Pattern PO_BOX = Pattern.compile("(?i)p\\.?\\s*o\\.?\\s*box\\s*[:\\s]?(\\d{3,10})");
    private static final Pattern PHONE = Pattern.compile("(?i)telephone:\\s*([+\\d\\s-]{8,20})");
    private static final Pattern COMPANY_LINE = Pattern.compile("(?i).+\\b(FZE|FZC)\\b.*\\bLLC\\b.*");
    private static final Pattern LEGAL_TYPE_LINE = Pattern.compile("(?i)free zone (entity|company).+LLC");
    private static final Pattern CONTACT_EMAIL = Pattern.compile("[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+");
    private static final Pattern ADDRESS_CODE = Pattern.compile("^[A-Z]{2,3}-[A-Z0-9\\-]+$|^CWS-[A-Z0-9\\-]+$");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = normalized.split("\n");
        boolean columnLayout = isColumnLayout(lines);

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(normalized, lines, columnLayout));
        addIfNotEmpty(result, "registerNo", extractRegistrationNo(normalized, lines, columnLayout));
        addIfNotEmpty(result, "companyName", extractCompanyName(normalized, lines, columnLayout));
        addIfNotEmpty(result, "businessName", extractCompanyName(normalized, lines, columnLayout));
        addIfNotEmpty(result, "companyNameAr", extractArabicCompanyName(lines));
        addIfNotEmpty(result, "businessNameAr", extractArabicCompanyName(lines));
        addIfNotEmpty(result, "legalType", extractLegalType(normalized, lines, columnLayout));
        addIfNotEmpty(result, "legalTypeAr", extractArabicLegalType(lines));
        addIfNotEmpty(result, "issueDate", extractDate(normalized, lines, "Start Date", columnLayout));
        addIfNotEmpty(result, "expiryDate", extractDate(normalized, lines, "Expiry Date", columnLayout));
        String manager = extractManager(lines, columnLayout);
        addIfNotEmpty(result, "manager", manager);
        addIfNotEmpty(result, "managerNationality", extractManagerNationality(normalized, lines, columnLayout));
        List<String> englishActivities = extractEnglishActivities(lines, columnLayout);
        List<String> arabicActivities = extractArabicActivities(lines, columnLayout, englishActivities);
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(englishActivities, arabicActivities));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(extractShareholders(lines, manager)));
        addIfNotEmpty(result, "address", extractAddress(lines, columnLayout));
        addIfNotEmpty(result, "addressAr", extractArabicAddress(lines));
        addIfNotEmpty(result, "email", extractContactEmail(normalized));
        addIfNotEmpty(result, "phoneNo", extractPhoneNo(normalized));
        addIfNotEmpty(result, "poBox", extractPoBox(normalized));
        addIfNotEmpty(result, "capitalDetails", extractCapital(lines));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Ajman ANCFZ trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private boolean isColumnLayout(String[] lines) {
        int companyIdx = findLine(lines, "(?i)^company name$");
        if (companyIdx < 0 || companyIdx + 1 >= lines.length) {
            return false;
        }
        String next = lines[companyIdx + 1].trim().toLowerCase();
        return next.equals("legal status") || next.equals("start date");
    }

    private String extractLicenseNo(String text, String[] lines, boolean columnLayout) {
        Matcher matcher = LICENSE_NO.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        if (columnLayout) {
            for (String line : lines) {
                if (LICENSE_NO_LINE.matcher(line.trim()).matches()) {
                    return line.trim();
                }
            }
        }
        return "";
    }

    private String extractRegistrationNo(String text, String[] lines, boolean columnLayout) {
        Matcher matcher = Pattern.compile("Registration Number\\s+(\\d{10,16})").matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return columnLayout ? extractLicenseNo(text, lines, true) : "";
    }

    private String extractCompanyName(String text, String[] lines, boolean columnLayout) {
        Matcher matcher = Pattern.compile("Company Name\\s+(.+?)(?:ش\\.م\\.ح|م\\.م\\.ح|إسم|$)").matcher(text);
        if (matcher.find()) {
            String value = stripArabicSuffix(matcher.group(1).trim());
            if (!isLabelLine(value)) {
                return value;
            }
        }
        int idx = findLine(lines, "(?i)company name");
        if (idx >= 0) {
            for (int i = idx; i < Math.min(idx + 3, lines.length); i++) {
                String cleaned = lines[i].replaceFirst("(?i).*company name\\s*", "").trim();
                cleaned = stripArabicSuffix(cleaned);
                if (cleaned.matches(".*[A-Za-z].*") && cleaned.length() > 5 && !isLabelLine(cleaned)) {
                    return cleaned;
                }
            }
        }
        if (columnLayout) {
            for (String line : lines) {
                if (COMPANY_LINE.matcher(line.trim()).matches()) {
                    return line.trim();
                }
            }
        }
        return "";
    }

    private String extractLegalType(String text, String[] lines, boolean columnLayout) {
        String inline = extractAfterLabel(text, "Legal Status");
        if (!inline.isBlank() && !isLabelLine(inline)) {
            return inline;
        }
        if (columnLayout) {
            for (String line : lines) {
                if (LEGAL_TYPE_LINE.matcher(line.trim()).matches()) {
                    return line.trim();
                }
            }
        }
        return "";
    }

    private String extractArabicCompanyName(String[] lines) {
        int idx = findLine(lines, "(?i)company name|إسم الشركة|اسم الشركة");
        if (idx < 0) {
            return "";
        }
        for (int i = idx; i < Math.min(idx + 4, lines.length); i++) {
            String arabic = extractArabicSegment(lines[i]);
            if (!arabic.isBlank() && arabic.length() > 4) {
                return arabicTextProcessor.normalizeArabic(arabic);
            }
        }
        return "";
    }

    private String extractArabicLegalType(String[] lines) {
        int idx = findLine(lines, "الشكل القانوني");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("تاريخ") || line.contains("رقم")) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z].*") && line.length() > 3) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractAfterLabel(String text, String label) {
        Matcher matcher = Pattern.compile(label + "\\s+([^\\n]+)").matcher(text);
        if (!matcher.find()) {
            return "";
        }
        return stripArabicSuffix(matcher.group(1).trim());
    }

    private String extractDate(String text, String[] lines, String enLabel, boolean columnLayout) {
        Matcher matcher = Pattern.compile(enLabel + "\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4})").matcher(text);
        if (matcher.find()) {
            return normalizeDate(matcher.group(1));
        }
        if (columnLayout) {
            Matcher month = Pattern.compile("(?i)\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}\\b").matcher(text);
            List<String> dates = new ArrayList<>();
            while (month.find()) {
                dates.add(normalizeDate(month.group()));
            }
            if ("Start Date".equalsIgnoreCase(enLabel) && !dates.isEmpty()) {
                return dates.get(0);
            }
            if ("Expiry Date".equalsIgnoreCase(enLabel) && dates.size() > 1) {
                return dates.get(1);
            }
        }
        return "";
    }

    private String extractManager(String[] lines, boolean columnLayout) {
        int idx = findLine(lines, "(?i)manager(?!\\s*['\u2019]?s\\s*nationality)|المدير");
        if (idx < 0) {
            return "";
        }
        StringBuilder manager = new StringBuilder();
        String inline = lines[idx].replaceFirst("(?i).*\\bmanager\\b\\s*", "").trim();
        inline = stripArabicSuffix(inline);
        if (inline.matches(".*[A-Za-z]{3,}.*") && !inline.toLowerCase().contains("nationality")) {
            appendManagerPart(manager, inline);
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (isManagerBoundary(line)) {
                break;
            }
            appendManagerPart(manager, stripArabicSuffix(line));
        }
        if (!manager.isEmpty()) {
            return manager.toString().trim();
        }
        if (columnLayout) {
            for (int i = 0; i < lines.length - 1; i++) {
                String lower = lines[i].trim().toLowerCase();
                if (!isLicenseAddressLine(lower)) {
                    continue;
                }
                String candidate = cleanName(lines[i + 1].trim());
                if (looksLikePersonName(candidate)) {
                    return candidate;
                }
            }
        }
        return "";
    }

    private boolean looksLikePersonName(String line) {
        String lower = line.toLowerCase();
        if (lower.contains("consult")
                || lower.contains("service")
                || lower.contains("trading")
                || lower.contains("commerce")
                || lower.contains("portal")
                || lower.contains("management")
                || lower.contains("tourism")
                || lower.contains("document")) {
            return false;
        }
        return line.matches("^[A-Za-z][A-Za-z'\\-.\\s]{5,}$")
                && !lower.contains("floor")
                && !lower.contains("ajman")
                && !lower.contains("license")
                && !COMPANY_LINE.matcher(line).matches()
                && !LEGAL_TYPE_LINE.matcher(line).matches()
                && !isShareholderNationality(line);
    }

    private String cleanName(String value) {
        return stripArabicSuffix(value).replaceAll("\\s*/\\s*$", "").trim();
    }

    private void appendManagerPart(StringBuilder manager, String line) {
        if (line.isEmpty() || line.equalsIgnoreCase("manager") || isShareholderNoise(line)) {
            return;
        }
        if (!line.matches(".*[A-Za-z].*") || line.length() < 3) {
            return;
        }
        if (!manager.isEmpty()) {
            manager.append(' ');
        }
        manager.append(line);
    }

    private boolean isManagerBoundary(String line) {
        String lower = line.toLowerCase();
        return lower.contains("nationality")
                || lower.contains("activities")
                || lower.equals("license address")
                || line.contains("النشاط")
                || line.contains("جنسية");
    }

    private String extractManagerNationality(String text, String[] lines, boolean columnLayout) {
        Matcher matcher = Pattern.compile("(?i)manager['\u2019]?s?\\s+nationality\\s+(Pakistan|India|Egypt|Jordan|Oman)").matcher(text);
        if (matcher.find()) {
            return normalizeNationality(matcher.group(1));
        }
        int managerIdx = findLine(lines, "(?i)^manager$|(?i)manager\\s+[A-Z]|المدير");
        if (managerIdx >= 0) {
            for (int i = managerIdx + 1; i < Math.min(managerIdx + 10, lines.length); i++) {
                String cleaned = stripArabicSuffix(lines[i].trim());
                if (cleaned.toLowerCase().startsWith("activities") || isLabelLine(cleaned)) {
                    continue;
                }
                if (isShareholderNationality(cleaned)) {
                    return normalizeNationality(cleaned);
                }
            }
        }
        if (columnLayout) {
            for (int i = 0; i < lines.length - 2; i++) {
                String lower = lines[i].trim().toLowerCase();
                if (!isLicenseAddressLine(lower)) {
                    continue;
                }
                String candidate = stripArabicSuffix(lines[i + 2].trim());
                if (isShareholderNationality(candidate)) {
                    return normalizeNationality(candidate);
                }
            }
        }
        return "";
    }

    private boolean isLicenseAddressLine(String lower) {
        return lower.matches(".*\\d+(st|nd|rd|th)\\s+floor.*")
                && !lower.startsWith("address:")
                && !lower.contains("mezzanine");
    }

    private List<String> extractEnglishActivities(String[] lines, boolean columnLayout) {
        if (columnLayout) {
            List<String> registerActivities = extractActivitiesFromSection(lines, "(?i)^register activities");
            if (!registerActivities.isEmpty()) {
                return registerActivities;
            }
        }
        return extractActivitiesFromSection(lines, "(?i)^activities:");
    }

    private List<String> extractArabicActivities(String[] lines, boolean columnLayout, List<String> englishActivities) {
        List<String> arabic = extractArabicActivitiesFromSection(lines, "النشاط");
        if (arabic.isEmpty()) {
            arabic = extractArabicActivitiesFromSection(lines, "أنشطة السجل");
        }
        if (!arabic.isEmpty()) {
            return arabic;
        }
        List<String> inline = extractInlineArabicActivities(lines, "(?i)^activities:");
        if (!inline.isEmpty()) {
            return inline;
        }
        if (englishActivities.isEmpty()) {
            return List.of();
        }
        return List.of();
    }

    private List<String> extractActivitiesFromSection(String[] lines, String startPattern) {
        int start = findLine(lines, startPattern);
        if (start < 0) {
            return List.of();
        }
        int end = findLineFrom(lines, start + 1, "(?i)^remarks:|verification qr|capital details|ملاحظات");
        if (end < 0) {
            end = lines.length;
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (!isActivityEnglishLine(line)) {
                continue;
            }
            activities.add(stripArabicSuffix(line));
        }
        return activities;
    }

    private List<String> extractArabicActivitiesFromSection(String[] lines, String header) {
        int start = findLine(lines, header);
        if (start < 0) {
            return List.of();
        }
        int end = findLineFrom(lines, start + 1, "(?i)remarks:|verification qr|ملاحظات|capital details|register activities|أنشطة السجل");
        if (end < 0) {
            end = lines.length;
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || line.equals("•") || isShareholderNoise(line)) {
                continue;
            }
            if (line.matches(".*[A-Za-z].*") && !arabicTextProcessor.containsArabic(line)) {
                continue;
            }
            String arabic = arabicTextProcessor.containsArabic(line)
                    ? arabicTextProcessor.normalizeArabic(line)
                    : arabicTextProcessor.normalizeArabic(extractArabicSegment(line));
            if (!arabic.isBlank() && arabic.length() > 3 && !arabic.contains("تاريخ") && !arabic.contains("رقم")) {
                activities.add(arabic);
            }
        }
        return activities;
    }

    private List<String> extractInlineArabicActivities(String[] lines, String startPattern) {
        int start = findLine(lines, startPattern);
        if (start < 0) {
            return List.of();
        }
        int end = findLineFrom(lines, start + 1, "(?i)^remarks:|verification qr|ملاحظات");
        if (end < 0) {
            end = lines.length;
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (!isActivityEnglishLine(line)) {
                continue;
            }
            String arabic = extractArabicSegment(line);
            if (!arabic.isBlank()) {
                activities.add(arabicTextProcessor.normalizeArabic(arabic));
            } else {
                activities.add("");
            }
        }
        return activities;
    }

    private boolean isActivityEnglishLine(String line) {
        if (line.isEmpty() || line.equals("•") || isShareholderNoise(line) || isLabelLine(line)) {
            return false;
        }
        if (line.contains("@")) {
            return false;
        }
        if (!line.matches(".*[A-Za-z].*") || line.length() <= 4 || line.matches("^\\d{10,16}$")) {
            return false;
        }
        String english = stripArabicSuffix(line);
        return !english.isBlank()
                && !looksLikeDate(english)
                && !COMPANY_LINE.matcher(english).matches()
                && !ADDRESS_CODE.matcher(english).matches()
                && !english.toLowerCase().contains("floor")
                && !isShareholderNationality(english)
                && !isLikelyPersonName(english);
    }

    private boolean isLikelyPersonName(String line) {
        String lower = line.toLowerCase();
        if (lower.contains("consult") || lower.contains("service") || lower.contains("trading")
                || lower.contains("commerce") || lower.contains("portal") || lower.contains("agent")
                || lower.contains("bookkeeping") || lower.contains("translation")) {
            return false;
        }
        String[] words = line.trim().split("\\s+");
        if (words.length < 2 || words.length > 5) {
            return false;
        }
        return line.matches("^[A-Z][A-Za-z'\\-.]+(\\s+[A-Z][A-Za-z'\\-.]+)+$")
                && !COMPANY_LINE.matcher(line).matches();
    }

    private List<Map<String, String>> extractShareholders(String[] lines, String managerName) {
        Map<String, String> designations = extractDesignationsByPassport(lines);
        int sectionStart = findLine(lines, "(?i)license shareholders");
        int sectionEnd = sectionStart >= 0
                ? findLineFrom(lines, sectionStart + 1, "(?i)commercial register")
                : findLine(lines, "(?i)commercial register");
        if (sectionEnd < 0) {
            sectionEnd = lines.length;
        }
        int scanStart = sectionStart >= 0 ? sectionStart : 0;

        List<Map<String, String>> members = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int shareholderCount = countDistinctPassportsInSection(lines, scanStart, sectionEnd);
        List<String> orderedShares = collectOrderedShares(lines, scanStart, sectionEnd);

        for (int i = scanStart; i < sectionEnd; i++) {
            String line = lines[i].trim();

            Map<String, String> inline = parseInlineShareholderLine(line, lines, i);
            if (inline != null && seen.add(inline.get("passport"))) {
                applyDesignation(inline, designations, managerName);
                members.add(inline);
                continue;
            }

            if (!PASSPORT.matcher(line).matches() || seen.contains(line)) {
                continue;
            }
            Map<String, String> member = parseShareholderBlock(lines, i, sectionStart, sectionEnd, managerName,
                    shareholderCount);
            if (!member.isEmpty()) {
                seen.add(line);
                applyDesignation(member, designations, managerName);
                members.add(member);
            }
        }

        if (!orderedShares.isEmpty()) {
            for (int i = 0; i < members.size() && i < orderedShares.size(); i++) {
                members.get(i).put("share", orderedShares.get(i));
            }
        }

        assignMissingShares(members, lines, scanStart, sectionEnd);
        return members;
    }

    private void assignMissingShares(List<Map<String, String>> members, String[] lines, int start, int end) {
        for (Map<String, String> member : members) {
            if (member.containsKey("share")) {
                continue;
            }
            String passport = member.get("passport");
            if (passport == null) {
                continue;
            }
            for (int i = start; i < end; i++) {
                if (!lines[i].contains(passport)) {
                    continue;
                }
                Matcher shareMatcher = SHARE_PERCENT.matcher(lines[i]);
                if (shareMatcher.find()) {
                    member.put("share", shareMatcher.group(1) + "%");
                    break;
                }
            }
        }
    }

    private Map<String, String> parseInlineShareholderLine(String line, String[] lines, int lineIdx) {
        Matcher passportMatcher = PASSPORT_IN_LINE.matcher(line);
        Matcher shareMatcher = SHARE_PERCENT.matcher(line);
        if (!passportMatcher.find() || !shareMatcher.find()) {
            return null;
        }

        Map<String, String> member = new LinkedHashMap<>();
        member.put("passport", passportMatcher.group(1));
        member.put("share", shareMatcher.group(1) + "%");

        String nationality = extractNationalityFromLine(line);
        if (!nationality.isBlank()) {
            member.put("nationality", nationality);
        }

        int sectionStart = findLine(lines, "(?i)license shareholders");
        String name = resolveShareholderName(lines, lineIdx, sectionStart);
        if (!name.isBlank()) {
            member.put("nameEn", sanitizeMemberName(name));
        }
        String nameAr = resolveShareholderArabicName(lines, lineIdx, sectionStart);
        if (!nameAr.isBlank()) {
            member.put("nameAr", nameAr);
        }
        return member.containsKey("nameEn") ? member : null;
    }

    private Map<String, String> parseShareholderBlock(String[] lines, int passportIdx, int sectionStart, int sectionEnd,
                                                     String managerName, int shareholderCount) {
        String passport = lines[passportIdx].trim();
        Map<String, String> member = new LinkedHashMap<>();
        member.put("passport", passport);

        int blockStart = findPreviousPassportIndex(lines, passportIdx, sectionStart) + 1;
        int blockEnd = findNextPassportIndex(lines, passportIdx, sectionEnd);
        String share = findInlineShare(lines, passportIdx);
        if (!share.isBlank()) {
            member.put("share", share);
        }

        String nationality = findNearestNationality(lines, passportIdx, blockStart, blockEnd);
        if (!nationality.isBlank()) {
            member.put("nationality", nationality);
        }

        String name = resolveShareholderName(lines, passportIdx, sectionStart);
        if (name.isBlank() && shareholderCount <= 1 && !managerName.isBlank()) {
            name = managerName;
        }
        if (!name.isBlank()) {
            member.put("nameEn", sanitizeMemberName(name));
        }
        String nameAr = resolveShareholderArabicName(lines, passportIdx, sectionStart);
        if (nameAr.isBlank() && shareholderCount <= 1 && !managerName.isBlank()
                && namesMatch(member.getOrDefault("nameEn", ""), managerName)) {
            nameAr = extractManagerArabicName(lines);
        }
        if (!nameAr.isBlank()) {
            member.put("nameAr", nameAr);
        }
        return member.containsKey("nameEn") ? member : Map.of();
    }

    private String resolveShareholderArabicName(String[] lines, int passportIdx, int sectionStart) {
        int blockStart = findPreviousPassportIndex(lines, passportIdx, sectionStart) + 1;
        int blockEnd = findNextPassportIndex(lines, passportIdx, lines.length);

        List<String> arabicParts = new ArrayList<>();
        String passportLineArabic = extractArabicFromShareholderLine(lines[passportIdx].trim());
        if (isValidArabicMemberName(passportLineArabic)) {
            arabicParts.add(passportLineArabic);
        }
        for (int i = blockStart; i < passportIdx; i++) {
            addArabicNamePartsFromLine(arabicParts, lines[i].trim());
        }
        for (int i = passportIdx + 1; i < Math.min(passportIdx + 4, blockEnd); i++) {
            String line = lines[i].trim();
            if (isShareholderNationality(line) || isSectionLabelLine(line) || containsPassportToken(line)
                    || line.matches("^\\d+(?:\\.\\d+)?%$")) {
                break;
            }
            addArabicNamePartsFromLine(arabicParts, line);
        }
        if (arabicParts.isEmpty()) {
            return "";
        }
        return arabicTextProcessor.normalizeArabic(String.join(" ", arabicParts));
    }

    private void addArabicNamePartsFromLine(List<String> arabicParts, String line) {
        if (line.isEmpty() || isAddressNoiseLine(line) || isSectionLabelLine(line) || line.matches("^\\d{10,16}$")) {
            return;
        }
        String arabic = extractArabicNamePart(line);
        if (isValidArabicMemberName(arabic) && !arabicParts.contains(arabic)) {
            arabicParts.add(arabic);
        }
    }

    private String extractArabicFromShareholderLine(String line) {
        String slashArabic = extractArabicNamePart(line);
        if (!slashArabic.isBlank()) {
            return slashArabic;
        }
        String segmentArabic = extractStandaloneArabic(extractArabicSegment(line));
        if (!segmentArabic.isBlank()) {
            return segmentArabic;
        }
        return extractStandaloneArabic(line);
    }

    private String extractArabicNamePart(String line) {
        int slashIdx = line.indexOf('/');
        if (slashIdx >= 0) {
            String afterSlash = extractStandaloneArabic(line.substring(slashIdx + 1));
            if (!afterSlash.isBlank()) {
                return afterSlash;
            }
            String beforeSlash = extractStandaloneArabic(line.substring(0, slashIdx));
            if (!beforeSlash.isBlank() && !beforeSlash.matches(".*[A-Za-z].*")) {
                return beforeSlash;
            }
            return "";
        }
        if (line.matches(".*[A-Za-z].*")) {
            return "";
        }
        return extractStandaloneArabic(line);
    }

    private String extractStandaloneArabic(String text) {
        if (!arabicTextProcessor.containsArabic(text)) {
            return "";
        }
        StringBuilder arabic = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z') {
                break;
            }
            String token = String.valueOf(ch);
            if (arabicTextProcessor.containsArabic(token) || ch == ' ') {
                arabic.append(ch);
            }
        }
        String cleaned = arabic.toString().replaceAll("\\s+", " ").trim();
        if (cleaned.length() < 3) {
            return "";
        }
        if (cleaned.contains("تاريخ") || cleaned.contains("رقم") || cleaned.contains("جنسية")
                || cleaned.contains("الهند") || cleaned.contains("باكستان") || cleaned.contains("باکستان")) {
            return "";
        }
        return cleaned;
    }

    private String extractManagerArabicName(String[] lines) {
        int idx = findLine(lines, "المدير");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String arabic = extractStandaloneArabic(lines[i]);
            if (!arabic.isBlank()) {
                return arabicTextProcessor.normalizeArabic(arabic);
            }
        }
        return "";
    }

    private String resolveShareholderName(String[] lines, int passportIdx, int sectionStart) {
        List<String> nameParts = new ArrayList<>();
        int blockStart = findPreviousPassportIndex(lines, passportIdx, sectionStart) + 1;
        int blockEnd = findNextPassportIndex(lines, passportIdx, lines.length);

        for (int i = passportIdx - 1; i >= blockStart; i--) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (isShareholderNameBoundary(line)) {
                if (!nameParts.isEmpty()) {
                    break;
                }
                continue;
            }
            if (isSectionLabelLine(line) || isAddressNoiseLine(line) || line.matches("^\\d{10,16}$")) {
                if (!nameParts.isEmpty()) {
                    break;
                }
                continue;
            }
            if (containsPassportToken(line) || line.matches("^\\d+(?:\\.\\d+)?%$")) {
                break;
            }
            String english = cleanName(line);
            if (looksLikeShareholderNameLine(english)) {
                nameParts.add(0, english);
            } else if (!nameParts.isEmpty()) {
                break;
            }
        }
        for (int i = passportIdx + 1; i < Math.min(passportIdx + 3, blockEnd); i++) {
            String line = lines[i].trim();
            if (isShareholderNationality(line) || isSectionLabelLine(line) || containsPassportToken(line)
                    || line.matches("^\\d+(?:\\.\\d+)?%$")) {
                break;
            }
            String english = cleanName(line);
            if (looksLikeShareholderNameLine(english) && english.split("\\s+").length == 1 && !nameParts.isEmpty()) {
                nameParts.add(english);
            } else if (!extractStandaloneArabic(line).isBlank()) {
                break;
            } else {
                break;
            }
        }
        return String.join(" ", nameParts);
    }

    private int findPreviousPassportIndex(String[] lines, int beforeIdx, int sectionStart) {
        for (int i = beforeIdx - 1; i >= sectionStart; i--) {
            if (containsPassportOnLine(lines[i].trim())) {
                return i;
            }
        }
        return sectionStart - 1;
    }

    private int findNextPassportIndex(String[] lines, int afterIdx, int sectionEnd) {
        for (int i = afterIdx + 1; i < sectionEnd; i++) {
            if (containsPassportOnLine(lines[i].trim())) {
                return i;
            }
        }
        return sectionEnd;
    }

    private boolean containsPassportOnLine(String line) {
        if (line.toLowerCase().contains("passport no")) {
            return false;
        }
        return PASSPORT.matcher(line).matches() || PASSPORT_IN_LINE.matcher(line).find();
    }

    private int countDistinctPassportsInSection(String[] lines, int sectionStart, int sectionEnd) {
        Set<String> passports = new HashSet<>();
        for (int i = sectionStart; i < sectionEnd; i++) {
            String line = lines[i].trim();
            if (PASSPORT.matcher(line).matches()) {
                passports.add(line);
            }
        }
        return passports.size();
    }

    private List<String> collectOrderedShares(String[] lines, int sectionStart, int sectionEnd) {
        List<String> shares = new ArrayList<>();
        for (int i = sectionStart; i < sectionEnd; i++) {
            String line = lines[i].trim();
            if (line.matches("^\\d+(?:\\.\\d+)?%$")) {
                shares.add(line);
            }
        }
        return shares;
    }

    private String findInlineShare(String[] lines, int passportIdx) {
        Matcher inlineShare = SHARE_PERCENT.matcher(lines[passportIdx].trim());
        if (inlineShare.find()) {
            return inlineShare.group(1) + "%";
        }
        for (int i = passportIdx + 1; i < Math.min(passportIdx + 2, lines.length); i++) {
            String line = lines[i].trim();
            if (PASSPORT.matcher(line).matches()) {
                break;
            }
            if (line.matches("^\\d+(?:\\.\\d+)?%$")) {
                return line;
            }
            Matcher shareMatcher = SHARE_PERCENT.matcher(line);
            if (shareMatcher.find() && line.contains(lines[passportIdx].trim())) {
                return shareMatcher.group(1) + "%";
            }
        }
        return "";
    }

    private boolean isValidArabicMemberName(String arabic) {
        if (arabic == null || arabic.isBlank()) {
            return false;
        }
        String normalized = arabicTextProcessor.normalizeArabic(arabic).trim();
        if (normalized.length() < 3) {
            return false;
        }
        if (normalized.contains("اسم الشركة") || normalized.equals("اسم") || normalized.contains("تفاصيل الرخصة")) {
            return false;
        }
        if (normalized.equals("ذمم") || normalized.contains("ذ.م.م") || normalized.contains("ش.م.ح")) {
            return false;
        }
        if (normalized.contains("رقم") || normalized.contains("جنسية") || normalized.contains("مساهمين")) {
            return false;
        }
        return true;
    }

    private String sanitizeMemberName(String name) {
        if (name == null || name.isBlank()) {
            return "";
        }
        return name
                .replaceAll("(?i)\\bowners\\s*/\\s*partners\\s*/\\s*managers\\b", " ")
                .replaceAll("(?i)\\bpartners\\s*/\\s*managers\\b", " ")
                .replaceAll("(?i)\\blicense\\s+shareholders\\b", " ")
                .replaceAll("(?i)^name\\s*/?\\s*", "")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private boolean isSectionLabelLine(String line) {
        return isShareholderHeader(line) || isOwnersPartnersHeader(line) || isArabicCompanyLabel(line);
    }

    private boolean isArabicCompanyLabel(String line) {
        return line.contains("إسم الشركة") || line.contains("اسم الشركة");
    }

    private boolean isOwnersPartnersHeader(String line) {
        String lower = line.toLowerCase();
        return lower.contains("owners / partners")
                || lower.contains("partners / managers")
                || lower.startsWith("name /")
                || lower.equals("name");
    }

    private Map<String, String> extractDesignationsByPassport(String[] lines) {
        Map<String, String> designations = new LinkedHashMap<>();
        Pattern designationPattern = Pattern.compile("([A-Z]{1,2}\\d{6,10})\\s+(Shareholder[^\\n]*)");
        for (String line : lines) {
            Matcher matcher = designationPattern.matcher(line);
            if (matcher.find()) {
                designations.put(matcher.group(1), matcher.group(2).trim());
            }
        }

        List<String> roles = extractDesignationRoles(lines);
        if (roles.isEmpty()) {
            return designations;
        }

        List<String> passports = extractShareholderPassportsInOrder(lines);
        for (int i = 0; i < Math.min(passports.size(), roles.size()); i++) {
            designations.putIfAbsent(passports.get(i), roles.get(i));
        }
        if (roles.size() == 1 && !passports.isEmpty()) {
            for (String passport : passports) {
                designations.putIfAbsent(passport, roles.get(0));
            }
        }
        return designations;
    }

    private List<String> extractDesignationRoles(String[] lines) {
        List<String> roles = new ArrayList<>();
        int designationIdx = findLine(lines, "(?i)designation /");
        if (designationIdx < 0) {
            return roles;
        }
        int end = findLineFrom(lines, designationIdx + 1, "(?i)remarks:|verification qr");
        if (end < 0) {
            end = Math.min(designationIdx + 8, lines.length);
        }
        for (int i = designationIdx + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.toLowerCase().startsWith("shareholder")) {
                roles.add(line);
            }
        }
        return roles;
    }

    private List<String> extractShareholderPassportsInOrder(String[] lines) {
        List<String> passports = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int sectionStart = findLine(lines, "(?i)license shareholders");
        int sectionEnd = sectionStart >= 0
                ? findLineFrom(lines, sectionStart + 1, "(?i)commercial register")
                : findLine(lines, "(?i)commercial register");
        if (sectionEnd < 0) {
            sectionEnd = lines.length;
        }
        int scanStart = sectionStart >= 0 ? sectionStart : 0;
        for (int i = scanStart; i < sectionEnd; i++) {
            String line = lines[i].trim();
            Matcher passportMatcher = PASSPORT_IN_LINE.matcher(line);
            if (!passportMatcher.find() || line.toLowerCase().contains("passport no")) {
                continue;
            }
            String passport = passportMatcher.group(1);
            if (seen.add(passport)) {
                passports.add(passport);
            }
        }
        return passports;
    }

    private void applyDesignation(Map<String, String> member, Map<String, String> designations, String managerName) {
        String passport = member.get("passport");
        if (passport != null && designations.containsKey(passport)) {
            member.put("role", designations.get(passport));
            return;
        }
        String memberName = member.getOrDefault("nameEn", "");
        if (!managerName.isBlank() && namesMatch(memberName, managerName)) {
            member.put("role", "Shareholder, Manager");
            return;
        }
        member.put("role", "Shareholder");
    }

    private boolean namesMatch(String memberName, String managerName) {
        String normalizedMember = normalizePersonName(memberName);
        String normalizedManager = normalizePersonName(managerName);
        return !normalizedMember.isBlank()
                && (normalizedMember.equals(normalizedManager)
                || normalizedManager.contains(normalizedMember)
                || normalizedMember.contains(normalizedManager));
    }

    private String normalizePersonName(String name) {
        return name.toLowerCase().replaceAll("[^a-z\\s]", " ").replaceAll("\\s+", " ").trim();
    }

    private String findNearestNationality(String[] lines, int passportIdx, int blockStart, int blockEnd) {
        for (int i = passportIdx - 1; i >= blockStart; i--) {
            String nationality = extractNationalityFromLine(lines[i].trim());
            if (!nationality.isBlank()) {
                return nationality;
            }
        }
        for (int i = passportIdx + 1; i < blockEnd; i++) {
            String nationality = extractNationalityFromLine(lines[i].trim());
            if (!nationality.isBlank()) {
                return nationality;
            }
        }
        return "";
    }

    private String extractNationalityFromLine(String line) {
        Matcher matcher = TradeLicenceParseSupport.NAT_EN.matcher(line);
        if (matcher.find()) {
            return normalizeNationality(matcher.group(1));
        }
        if (line.contains("الهند") || line.contains("اﻟﮭﻧد")) {
            return "India";
        }
        if (line.contains("باكستان") || line.contains("باکستان") || line.contains("ﺑﺎﻛﺳﺗﺎن")) {
            return "Pakistan";
        }
        if (line.contains("مصر")) {
            return "Egypt";
        }
        return "";
    }

    private String extractContactEmail(String text) {
        Matcher contact = Pattern.compile("(?is)Contact Details.*?Email\\s+([a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+)").matcher(text);
        if (contact.find()) {
            String email = contact.group(1).trim();
            if (!email.contains("ancfz.ae")) {
                return email;
            }
        }
        Matcher matcher = CONTACT_EMAIL.matcher(text);
        while (matcher.find()) {
            String email = matcher.group();
            if (!email.contains("ancfz.ae")) {
                return email;
            }
        }
        return "";
    }

    private String extractPhoneNo(String text) {
        Matcher matcher = PHONE.matcher(text);
        return matcher.find() ? matcher.group(1).trim() : "";
    }

    private String extractPoBox(String text) {
        Matcher matcher = PO_BOX.matcher(text);
        return matcher.find() ? matcher.group(1) : "";
    }

    private String extractAddress(String[] lines, boolean columnLayout) {
        for (int idx = 0; idx < lines.length; idx++) {
            if (!lines[idx].toLowerCase().contains("license address")) {
                continue;
            }
            String inline = lines[idx].replaceFirst("(?i).*license address\\s*", "").trim();
            inline = stripArabicSuffix(inline);
            if (!inline.isBlank() && !isAddressNoiseLine(inline) && inline.matches(".*[A-Za-z0-9].*")) {
                if (ADDRESS_CODE.matcher(inline).find()) {
                    return normalizeAddressLine(inline);
                }
            }
            StringBuilder address = new StringBuilder();
            for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
                String line = lines[i].trim();
                if (line.isEmpty() || isManagerBoundary(line) || line.toLowerCase().contains("manager")) {
                    break;
                }
                if (isAddressNoiseLine(line)) {
                    continue;
                }
                String english = stripArabicSuffix(line);
                if (!english.matches(".*[A-Za-z0-9].*")) {
                    continue;
                }
                if (!address.isEmpty()) {
                    address.append(", ");
                }
                address.append(english);
                if (english.toLowerCase().contains("ajman") || english.toLowerCase().contains("floor")) {
                    return address.toString().trim();
                }
            }
            if (!address.isEmpty()) {
                return address.toString().trim();
            }
        }
        return findAddressByCode(lines);
    }

    private String findAddressByCode(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (!line.contains("CWS-") && !ADDRESS_CODE.matcher(line).matches()) {
                continue;
            }
            StringBuilder address = new StringBuilder(normalizeAddressLine(line));
            if (i + 1 < lines.length) {
                String next = stripArabicSuffix(lines[i + 1].trim());
                if (!next.isBlank() && !isAddressNoiseLine(next) && next.toLowerCase().contains("floor")) {
                    address.append(", ").append(next);
                }
            }
            return address.toString().trim();
        }
        return "";
    }

    private String normalizeAddressLine(String line) {
        Matcher matcher = Pattern.compile("(CWS-[A-Z0-9\\-]+|[A-Z]{2,3}-[A-Z0-9\\-]+)").matcher(line);
        if (matcher.find()) {
            String code = matcher.group(1);
            String remainder = line.substring(matcher.end()).trim();
            if (!remainder.isBlank() && remainder.matches(".*[A-Za-z].*")) {
                return code + ", " + remainder.replaceAll("\\s+", " ").trim();
            }
            return code;
        }
        return line.trim();
    }

    private boolean isAddressNoiseLine(String line) {
        if (line.isBlank() || LICENSE_NO_LINE.matcher(line.trim()).matches()) {
            return true;
        }
        String lower = line.toLowerCase();
        return lower.contains("license details")
                || lower.equals("license address")
                || lower.contains("license number")
                || lower.contains("registration number")
                || lower.equals("company name")
                || isArabicCompanyLabel(line)
                || line.contains("تفاصيل الرخصة");
    }

    private String extractArabicAddress(String[] lines) {
        for (int idx = 0; idx < lines.length; idx++) {
            String current = lines[idx].trim();
            if (!current.toLowerCase().contains("license address")
                    && !current.contains("عنوان الرخصة")
                    && !current.equals("العنوان")) {
                continue;
            }
            for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
                String line = lines[i].trim();
                if (isAddressNoiseLine(line) || ADDRESS_CODE.matcher(line).matches()) {
                    continue;
                }
                String arabic = extractArabicSegment(line);
                if (!arabic.isBlank() && isValidArabicAddress(arabic)) {
                    return arabicTextProcessor.normalizeArabic(arabic);
                }
            }
        }
        for (String line : lines) {
            String arabic = extractArabicSegment(line.trim());
            if (!arabic.isBlank() && isValidArabicAddress(arabic)) {
                return arabicTextProcessor.normalizeArabic(arabic);
            }
        }
        return "";
    }

    private boolean isValidArabicAddress(String arabic) {
        String normalized = arabicTextProcessor.normalizeArabic(arabic);
        if (normalized.length() <= 8 || normalized.contains("تفاصيل الرخصة")) {
            return false;
        }
        return normalized.contains("طابق") || normalized.contains("برج") || normalized.contains("عجمان");
    }

    private String extractCapital(String[] lines) {
        int idx = findLine(lines, "(?i)capital details");
        if (idx < 0) {
            return "";
        }
        String nominated = "";
        String shares = "";
        for (int i = idx + 1; i < Math.min(idx + 12, lines.length); i++) {
            String line = lines[i].trim();
            if (line.toLowerCase().startsWith("nominated")) {
                Matcher matcher = Pattern.compile("(\\d[\\d,]*)").matcher(line);
                if (matcher.find()) {
                    nominated = matcher.group(1).replace(",", "");
                }
            } else if (line.toLowerCase().contains("no. of shares")) {
                Matcher matcher = Pattern.compile("(\\d+)").matcher(line);
                if (matcher.find()) {
                    shares = matcher.group(1);
                }
            } else if (nominated.isBlank() && line.matches("\\d[\\d,]*")) {
                nominated = line.replace(",", "");
            } else if (shares.isBlank() && line.matches("\\d+") && !line.equals(nominated)) {
                shares = line;
            }
            if (!nominated.isBlank() && !shares.isBlank()) {
                break;
            }
        }
        if (nominated.isBlank()) {
            return "";
        }
        return buildSimpleJson(linkedMap("nominated", nominated, "shares", shares, "currencyEn", "AED"));
    }

    private String extractArabicSegment(String line) {
        int arIdx = -1;
        for (int i = 0; i < line.length(); i++) {
            if (arabicTextProcessor.containsArabic(String.valueOf(line.charAt(i)))) {
                arIdx = i;
                break;
            }
        }
        if (arIdx < 0) {
            return "";
        }
        return line.substring(arIdx).replaceAll("(?i)(company name|legal status|start date|expiry date|license address|manager|nationality|activities|remarks|email|mobile).*", "").trim();
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

    private boolean looksLikeShareholderNameLine(String line) {
        if (line.isEmpty() || line.startsWith("/")) {
            return false;
        }
        if (isShareholderNationality(line) || line.contains("/ India") || line.contains("/ Pakistan")) {
            return false;
        }
        String cleaned = line.replaceFirst("^/+\\s*", "").replaceAll("/+$", "").trim();
        String lower = cleaned.toLowerCase();
        if (lower.equals("name")
                || lower.startsWith("name /")
                || lower.contains("owners / partners")
                || lower.contains("partners / managers")
                || lower.contains("free zone")
                || lower.contains("nuventures")
                || lower.contains("government")
                || lower.contains("applicable")
                || lower.contains("approval")
                || lower.contains("remarks")
                || lower.contains("activities")
                || COMPANY_LINE.matcher(cleaned).matches()) {
            return false;
        }
        return cleaned.matches("^[A-Za-z][A-Za-z'\\-.\\s]{2,}$")
                && !cleaned.equalsIgnoreCase("manager")
                && !lower.contains("license")
                && !lower.contains("nationality");
    }

    private boolean containsPassportToken(String line) {
        return PASSPORT.matcher(line).matches() || PASSPORT_IN_LINE.matcher(line).find();
    }

    private boolean isShareholderNationality(String line) {
        String lower = line.toLowerCase();
        return lower.equals("egypt")
                || lower.equals("india")
                || lower.equals("pakistan")
                || lower.equals("uae")
                || lower.contains("emirates")
                || lower.contains("india /")
                || lower.contains("pakistan /")
                || line.contains("مصر")
                || line.contains("الهند")
                || line.contains("باكستان")
                || line.contains("باکستان");
    }

    private String normalizeNationality(String value) {
        return switch (value.trim().toLowerCase()) {
            case "egypt" -> "Egypt";
            case "india" -> "India";
            case "pakistan" -> "Pakistan";
            case "uae" -> "United Arab Emirates";
            default -> value.trim();
        };
    }

    private boolean isLabelLine(String value) {
        String lower = value.toLowerCase();
        return lower.equals("legal status")
                || lower.equals("start date")
                || lower.equals("expiry date")
                || lower.equals("license address")
                || lower.equals("company name")
                || lower.equals("registration number")
                || lower.equals("license number");
    }

    private boolean looksLikeDate(String value) {
        return value.matches("(?i).*(january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2},\\s+\\d{4}.*");
    }

    private boolean isShareholderHeader(String line) {
        String lower = line.toLowerCase();
        return lower.contains("shareholder")
                || lower.contains("passport no")
                || lower.contains("share percentage")
                || lower.contains("designation")
                || lower.equals("name")
                || lower.equals("name /")
                || lower.startsWith("name /")
                || lower.contains("owners / partners")
                || lower.contains("partners / managers")
                || lower.equals("nationality")
                || line.contains("المساهم")
                || line.contains("رقم جواز السفر")
                || line.contains("نسبة الشراكة")
                || line.contains("الوظيفة");
    }

    private boolean isShareholderNameBoundary(String line) {
        String lower = line.toLowerCase();
        return lower.contains("verification qr")
                || lower.contains("remarks:")
                || lower.contains("commercial register")
                || lower.contains("license shareholders");
    }

    private boolean isShareholderNoise(String line) {
        String lower = line.toLowerCase();
        return lower.contains("verification qr")
                || lower.contains("www.")
                || lower.contains("remarks:")
                || lower.contains("license details")
                || lower.contains("license number")
                || lower.contains("registration number")
                || lower.contains("company name")
                || lower.contains("ajman nuventures")
                || lower.contains("government of ajman")
                || line.contains("حكومة")
                || line.contains("عجمان للمشاريع")
                || line.matches("^[\\.\\d]+$")
                || line.matches("^\\d{10,16}$");
    }
}
