package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractEmail;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLineFrom;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class AbuDhabiDedTradeLicenceExtractor {

    private static final Pattern LICENCE_NO = Pattern.compile("\\bCN-\\d{5,10}\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern UNIFIED_REG = Pattern.compile("\\b\\d{3}-\\d{4}-\\d{9}\\b");
    private static final Pattern UNIFIED_LICENCE = Pattern.compile("\\b\\d{3}-\\d{4}-\\d{9}\\b");
    private static final Pattern MOBILE = Pattern.compile("\\+971\\d{9}");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Z0-9'\\-.\\s]{8,}$");
    private static final Pattern ADCCI = Pattern.compile("^\\d{5,8}$");
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = normalized.split("\n");

        addIfNotEmpty(result, "licenseNo", extractLicenceNo(normalized));
        addIfNotEmpty(result, "licenceType", extractLicenceType(lines));
        addIfNotEmpty(result, "licenceCategory", extractLicenceCategory(lines));
        addIfNotEmpty(result, "licenceTypeAr", extractArabicLicenceType(lines));
        addIfNotEmpty(result, "licenceCategoryAr", extractArabicLicenceCategory(lines));
        addIfNotEmpty(result, "registerNo", extractUnifiedRegistration(normalized));
        addIfNotEmpty(result, "unifiedLicenceNo", extractUnifiedLicence(normalized));
        addIfNotEmpty(result, "companyName", extractTradeName(lines));
        addIfNotEmpty(result, "businessName", extractTradeName(lines));
        addIfNotEmpty(result, "companyNameAr", extractArabicTradeName(lines));
        addIfNotEmpty(result, "businessNameAr", extractArabicTradeName(lines));
        addIfNotEmpty(result, "legalType", extractLegalForm(lines));
        addIfNotEmpty(result, "legalTypeAr", extractArabicLegalForm(lines));
        extractDocumentDates(lines, result);
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(extractActivities(lines), extractArabicActivities(lines)));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(extractMembers(lines)));
        String address = extractAddress(lines);
        addIfNotEmpty(result, "address", address);
        addIfNotEmpty(result, "addressAr", address);
        addIfNotEmpty(result, "email", extractEmail(normalized));
        addIfNotEmpty(result, "mobileNo", extractMobile(normalized));
        Map<String, String> additionalInfo = extractAdditionalInformation(lines);
        addIfNotEmpty(result, "dcciNo", additionalInfo.getOrDefault("dcci", ""));
        addIfNotEmpty(result, "mohreEstablishmentCardNo", additionalInfo.getOrDefault("mohre", ""));
        addIfNotEmpty(result, "icpEstablishmentCardNo", additionalInfo.getOrDefault("icp", ""));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Abu Dhabi DED trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String extractLicenceType(String[] lines) {
        for (String line : lines) {
            if (line.trim().equalsIgnoreCase("business")) {
                return "Business";
            }
        }
        if (findLine(lines, "تجارية") >= 0) {
            return "Business";
        }
        return "";
    }

    private String extractLicenceCategory(String[] lines) {
        for (String line : lines) {
            if (line.trim().equalsIgnoreCase("normal")) {
                return "Normal";
            }
        }
        if (findLine(lines, "عادية") >= 0) {
            return "Normal";
        }
        return "";
    }

    private String extractArabicLicenceType(String[] lines) {
        int idx = findLine(lines, "نوع الرخصة");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("تجارية")) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractArabicLicenceCategory(String[] lines) {
        int idx = findLine(lines, "فئة الرخصة");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("عادية")) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractLicenceNo(String text) {
        Matcher matcher = LICENCE_NO.matcher(text);
        if (matcher.find()) {
            return matcher.group().toUpperCase();
        }
        return "";
    }

    private String extractUnifiedRegistration(String text) {
        Matcher matcher = UNIFIED_REG.matcher(text);
        if (matcher.find()) {
            return matcher.group();
        }
        return "";
    }

    private String extractUnifiedLicence(String text) {
        Matcher matcher = UNIFIED_LICENCE.matcher(text);
        if (matcher.find()) {
            String first = matcher.group();
            if (matcher.find()) {
                return matcher.group();
            }
            return first;
        }
        return "";
    }

    private String extractTradeName(String[] lines) {
        int idx = findLine(lines, "(?i)\\btrade name\\b|الإسم التجاري");
        if (idx < 0) {
            return "";
        }
        List<String> candidates = new ArrayList<>();
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isHeading(line)) {
                continue;
            }
            if (line.toLowerCase().contains("ownership") || line.contains("الملكية")) {
                break;
            }
            if (line.matches(".*[A-Za-z].*") && line.length() > 5) {
                candidates.add(line);
            }
        }
        for (String candidate : candidates) {
            if (!looksLikeLegalForm(candidate)) {
                return candidate;
            }
        }
        return candidates.isEmpty() ? "" : candidates.get(candidates.size() - 1);
    }

    private boolean looksLikeLegalForm(String line) {
        String lower = line.toLowerCase();
        return lower.contains("limited liability")
                || lower.contains("sole proprietorship")
                || lower.contains("company -");
    }

    private boolean looksLikeArabicLegalForm(String line) {
        return line.contains("مسؤولية") || line.contains("الشخص الواحد") || line.contains("شخص واحد");
    }

    private String extractArabicTradeName(String[] lines) {
        int idx = findLine(lines, "الإسم التجاري");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("الملكية") || line.contains("الممثلين")) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line)
                    && !isHeading(line)
                    && !looksLikeArabicLegalForm(line)
                    && !looksLikeArabicAddress(line)
                    && line.length() > 4) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String extractLegalForm(String[] lines) {
        int idx = findLine(lines, "(?i)^legal form$|الشكل القانوني");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
            String line = lines[i].trim();
            if (line.matches(".*[A-Za-z].*") && line.length() > 5 && !isHeading(line)) {
                return line;
            }
        }
        return "";
    }

    private String extractArabicLegalForm(String[] lines) {
        int idx = findLine(lines, "الشكل القانوني");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (arabicTextProcessor.containsArabic(line)
                    && !line.matches(".*[A-Za-z].*")
                    && line.length() > 5
                    && looksLikeArabicLegalForm(line)) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private void extractDocumentDates(String[] lines, DocumentFieldsDto result) {
        List<String> dates = new ArrayList<>();
        for (String line : lines) {
            if (line.toLowerCase().contains("print date")) {
                continue;
            }
            String date = firstDate(line);
            if (date.isEmpty()) {
                continue;
            }
            String normalized = normalizeDate(date);
            if (!dates.contains(normalized)) {
                dates.add(normalized);
            }
        }
        if (dates.isEmpty()) {
            return;
        }
        dates.sort(Comparator.comparing(this::parseDateSafe));
        addIfNotEmpty(result, "establishmentDate", dates.get(0));
        if (dates.size() == 1) {
            return;
        }
        if (dates.size() == 2) {
            addIfNotEmpty(result, "issueDate", dates.get(1));
            return;
        }
        addIfNotEmpty(result, "issueDate", dates.get(1));
        addIfNotEmpty(result, "expiryDate", dates.get(dates.size() - 1));
    }

    private LocalDate parseDateSafe(String value) {
        try {
            return LocalDate.parse(value, DATE_FORMAT);
        } catch (Exception ignored) {
            return LocalDate.MIN;
        }
    }

    private List<String> extractActivities(String[] lines) {
        int start = findLine(lines, "(?i)licence activities|license activities");
        int end = findLine(lines, "(?i)^address$|official email|العنوان");
        if (start < 0 || end < 0 || end <= start) {
            return List.of();
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.matches(".*[A-Za-z].*") && line.length() > 4 && !isHeading(line)
                    && !line.equalsIgnoreCase("manager") && !line.equalsIgnoreCase("owner")
                    && !line.equalsIgnoreCase("india")) {
                activities.add(line);
            }
        }
        return activities;
    }

    private List<String> extractArabicActivities(String[] lines) {
        int start = findLine(lines, "الأنشطة المرخصة");
        int end = findLine(lines, "العنوان");
        if (start < 0 || end < 0 || end <= start) {
            return List.of();
        }
        List<String> activities = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim().replaceFirst("^-\\s*", "");
            if (arabicTextProcessor.containsArabic(line) && line.length() > 3) {
                activities.add(arabicTextProcessor.normalizeArabic(line));
            }
        }
        return activities;
    }

    private List<Map<String, String>> extractMembers(String[] lines) {
        LinkedHashMap<String, Map<String, String>> membersByKey = new LinkedHashMap<>();
        Set<String> roles = new LinkedHashSet<>();
        String nationality = "";

        int ownershipStart = findLine(lines, "(?i)ownership and representatives|الملكية والممثلين");
        int nameIdx = findLine(lines, "(?i)^name$|الاسم");
        int end = nameIdx >= 0
                ? findLineFrom(lines, nameIdx + 1, "الأنشطة المرخصة|(?i)licence activities")
                : findLine(lines, "الأنشطة المرخصة");
        if (end < 0) {
            end = lines.length;
        }

        int roleScanEnd = nameIdx > 0 ? nameIdx : end;
        if (ownershipStart >= 0) {
            for (int i = ownershipStart; i < roleScanEnd; i++) {
                String line = lines[i].trim();
                if (line.equalsIgnoreCase("owner") || line.equals("مالك")) {
                    roles.add("Owner");
                } else if (line.equalsIgnoreCase("manager") || line.contains("مدیر") || line.contains("مدير")) {
                    roles.add("Manager");
                }
                String parsedNationality = parseNationality(line);
                if (!parsedNationality.isBlank()) {
                    nationality = parsedNationality;
                }
            }
        }

        String pendingArabic = "";
        int scanFrom = nameIdx >= 0 ? nameIdx + 1 : Math.max(0, ownershipStart);
        for (int i = scanFrom; i < end; i++) {
            String line = lines[i].trim();
            if (line.equalsIgnoreCase("name") || line.equals("الاسم") || isMemberHeading(line)) {
                continue;
            }
            if (EN_NAME.matcher(line).matches()) {
                String key = normalizePersonKey(line);
                Map<String, String> member = membersByKey.computeIfAbsent(key, ignored -> {
                    Map<String, String> created = new LinkedHashMap<>();
                    created.put("nameEn", line);
                    return created;
                });
                if (!nationality.isBlank()) {
                    member.put("nationality", nationality);
                }
                if (!roles.isEmpty()) {
                    member.put("role", String.join(", ", roles));
                }
                if (!pendingArabic.isBlank() && !member.containsKey("nameAr")) {
                    member.put("nameAr", pendingArabic);
                    pendingArabic = "";
                }
            } else if (isArabicPersonName(line)) {
                pendingArabic = arabicTextProcessor.normalizeArabic(line);
            }
        }

        if (!pendingArabic.isBlank() && membersByKey.size() == 1) {
            membersByKey.values().iterator().next().putIfAbsent("nameAr", pendingArabic);
        }
        return new ArrayList<>(membersByKey.values());
    }

    private String extractAddress(String[] lines) {
        int tradeIdx = findLine(lines, "الإسم التجاري");
        int nameIdx = findLine(lines, "الاسم");
        if (tradeIdx >= 0 && nameIdx > tradeIdx) {
            for (int i = tradeIdx + 1; i < nameIdx; i++) {
                String line = lines[i].trim();
                if (looksLikeArabicAddress(line)) {
                    return arabicTextProcessor.normalizeArabic(line);
                }
            }
        }

        for (int idx = 0; idx < lines.length; idx++) {
            if (!lines[idx].trim().equalsIgnoreCase("address") && !lines[idx].trim().equals("العنوان")) {
                continue;
            }
            for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
                String line = lines[i].trim();
                if (!line.isEmpty() && !isHeading(line) && !line.contains("@") && !line.startsWith("+971")) {
                    if (looksLikeArabicAddress(line) || line.contains(",")) {
                        return arabicTextProcessor.containsArabic(line)
                                ? arabicTextProcessor.normalizeArabic(line)
                                : line;
                    }
                }
            }
        }
        return "";
    }

    private String extractMobile(String text) {
        Matcher matcher = MOBILE.matcher(text);
        if (matcher.find()) {
            return matcher.group();
        }
        return "";
    }

    private Map<String, String> extractAdditionalInformation(String[] lines) {
        Map<String, String> cards = new LinkedHashMap<>();
        List<CardHeading> headings = cardHeadings();
        for (CardHeading heading : headings) {
            cards.put(heading.key, "");
        }

        for (CardHeading heading : headings) {
            String inline = firstNonBlank(
                    extractCardInlineAfterHeading(lines, heading.englishPattern),
                    extractCardInlineAfterHeading(lines, heading.arabicPattern));
            if (!inline.isBlank()) {
                cards.put(heading.key, inline);
            }
        }

        List<String> columnValues = extractColumnValuesForCardHeadings(lines, headings);
        int valueIndex = 0;
        for (CardHeading heading : headings) {
            if (!cards.get(heading.key).isBlank()) {
                continue;
            }
            if (valueIndex < columnValues.size()) {
                cards.put(heading.key, columnValues.get(valueIndex));
                valueIndex++;
            }
        }
        return cards;
    }

    private record CardHeading(String key, String englishPattern, String arabicPattern) {
    }

    private List<CardHeading> cardHeadings() {
        return List.of(
                new CardHeading("dcci", "(?i)adcci no", "رقم عضوية الغرفة"),
                new CardHeading("mohre", "(?i)mohre establishment card", "وزارة الموارد البشرية"),
                new CardHeading("icp", "(?i)icp establishment card", "الهيئة الاتحادية للهوية")
        );
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String extractCardInlineAfterHeading(String[] lines, String headingPattern) {
        int labelIdx = findLine(lines, headingPattern);
        return extractCardInlineAfterLabel(lines, labelIdx);
    }

    private List<String> extractColumnValuesForCardHeadings(String[] lines, List<CardHeading> headings) {
        if (!hasArabicCardHeadings(lines)) {
            return extractEnglishAdditionalInfoColumnValues(lines, headings);
        }
        return extractArabicAdditionalInfoColumnValues(lines);
    }

    private boolean hasArabicCardHeadings(String[] lines) {
        return findLine(lines, "رقم عضوية الغرفة") >= 0
                || findLine(lines, "وزارة الموارد البشرية") >= 0
                || findLine(lines, "الهيئة الاتحادية للهوية") >= 0;
    }

    private List<String> extractArabicAdditionalInfoColumnValues(String[] lines) {
        int sectionStart = findLine(lines, "الإسم التجاري");
        int sectionEnd = findLineFrom(lines, Math.max(0, sectionStart), "(?i)^name$|^الاسم$");
        if (sectionStart < 0 || sectionEnd <= sectionStart) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        for (int i = sectionStart + 1; i < sectionEnd; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isCardHeadingLine(line) || isAdditionalInfoSectionHeading(line)) {
                continue;
            }
            if (looksLikeArabicLegalForm(line) || looksLikeArabicAddress(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !isEstablishmentCardValue(line)) {
                continue;
            }
            if (isEstablishmentCardValue(line)) {
                values.add(line);
            }
        }
        return values;
    }

    private List<String> extractEnglishAdditionalInfoColumnValues(String[] lines, List<CardHeading> headings) {
        int sectionStart = findLine(lines, "(?i)additional information");
        if (sectionStart < 0) {
            return List.of();
        }
        int lastHeadingIdx = sectionStart;
        for (CardHeading heading : headings) {
            int idx = findLineFrom(lines, sectionStart, heading.englishPattern);
            if (idx > lastHeadingIdx) {
                lastHeadingIdx = idx;
            }
        }
        List<String> values = new ArrayList<>();
        for (int i = lastHeadingIdx + 1; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.contains("@") || line.startsWith("+971") || line.toLowerCase().contains("print date")) {
                break;
            }
            if (isCardHeadingLine(line) || isAdditionalInfoSectionHeading(line)) {
                break;
            }
            if (isEstablishmentCardValue(line)) {
                values.add(line);
            }
        }
        return values;
    }

    private String extractCardInlineAfterLabel(String[] lines, int labelIdx) {
        if (labelIdx < 0) {
            return "";
        }
        for (int i = labelIdx + 1; i < Math.min(labelIdx + 4, lines.length); i++) {
            String line = lines[i].trim();
            if (isEstablishmentCardValue(line)) {
                return line;
            }
            if (isCardHeadingLine(line) || isAdditionalInfoBoundary(line)) {
                break;
            }
        }
        return "";
    }

    private boolean isCardHeadingLine(String line) {
        String lower = line.toLowerCase();
        return lower.contains("adcci no")
                || lower.contains("mohre establishment card")
                || lower.contains("icp establishment card")
                || line.contains("رقم عضوية الغرفة")
                || line.contains("وزارة الموارد البشرية")
                || line.contains("الهيئة الاتحادية للهوية");
    }

    private boolean isAdditionalInfoSectionHeading(String line) {
        String lower = line.toLowerCase();
        return lower.contains("additional information")
                || line.contains("معلومات إضافية")
                || lower.equals("address")
                || line.equals("العنوان");
    }

    private boolean isEstablishmentCardValue(String line) {
        return ADCCI.matcher(line).matches();
    }

    private boolean isAdditionalInfoBoundary(String line) {
        String lower = line.toLowerCase();
        return lower.contains("adcci")
                || lower.contains("mohre")
                || lower.contains("icp")
                || lower.contains("official email")
                || lower.contains("official mobile")
                || line.contains("عضوية الغرفة")
                || line.contains("بطاقة المنشأة")
                || line.startsWith("www.")
                || !firstDate(line).isEmpty();
    }

    private boolean looksLikeArabicAddress(String line) {
        return arabicTextProcessor.containsArabic(line)
                && (line.contains(",") || line.contains("جزيرة") || line.contains("مبنى") || line.contains("شارع"))
                && line.length() > 12;
    }

    private boolean isArabicPersonName(String line) {
        return arabicTextProcessor.containsArabic(line)
                && line.length() > 8
                && !line.contains("الدور")
                && !line.contains("الجنسية")
                && !line.contains("الملكية")
                && !line.contains("الممثلين")
                && !looksLikeArabicLegalForm(line)
                && !looksLikeArabicAddress(line)
                && !line.matches("^\\d{5,8}$");
    }

    private String parseNationality(String line) {
        String lower = line.toLowerCase();
        if (lower.equals("india") || line.contains("الهند")) {
            return "India";
        }
        if (lower.equals("uae") || lower.contains("emirates") || line.contains("الإمارات")) {
            return "United Arab Emirates";
        }
        if (lower.equals("pakistan") || line.contains("باكستان")) {
            return "Pakistan";
        }
        if (lower.equals("egypt") || line.contains("مصر")) {
            return "Egypt";
        }
        return "";
    }

    private String normalizePersonKey(String name) {
        return name.toLowerCase().replaceAll("[^a-z\\s]", " ").replaceAll("\\s+", " ").trim();
    }

    private boolean isMemberHeading(String line) {
        String lower = line.toLowerCase();
        return lower.contains("representative")
                || lower.contains("role/position")
                || lower.contains("nationality")
                || line.contains("ممثل عن")
                || line.contains("الدور")
                || line.contains("المنصب");
    }

    private boolean isHeading(String line) {
        String lower = line.toLowerCase();
        return lower.contains("licence")
                || lower.contains("license")
                || lower.contains("unified")
                || lower.contains("establishment")
                || lower.contains("issuance")
                || lower.contains("expiry")
                || lower.contains("legal form")
                || lower.contains("trade name")
                || lower.contains("ownership")
                || lower.contains("representative")
                || lower.contains("nationality")
                || lower.contains("role")
                || line.contains("تفاصيل")
                || line.contains("الرخصة")
                || line.contains("الشكل")
                || line.contains("الإسم");
    }
}
