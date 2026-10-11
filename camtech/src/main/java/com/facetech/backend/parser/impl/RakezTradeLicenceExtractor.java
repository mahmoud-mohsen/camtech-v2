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
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * RAKEZ trade licence extractor.
 * Supports embedded-PDF OCR (same-line values / {@code <<} activities) and Google Document AI OCR
 * (label-then-value / dumped value blocks).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RakezTradeLicenceExtractor {

    private static final Pattern LICENCE_NO_INLINE = Pattern.compile(
            "(?i)licen[cs]e\\s*no\\.?\\s*(\\d{6,12})");
    private static final Pattern LICENCE_NO_BEFORE_AR_TITLE = Pattern.compile(
            "(?m)^\\s*(\\d{6,12})\\s*$\\s*(?=رخصة)");
    private static final Pattern DOC_REF = Pattern.compile(
            "(?i)Document\\s+Reference\\s+no\\.?:\\s*([A-Za-z0-9-]+)");
    private static final Pattern ACTIVITY_MARKER = Pattern.compile("<<\\s*([^>\\n]+)");
    private static final Pattern DATE_TOKEN = Pattern.compile("\\b(\\d{1,2}[-/]\\d{1,2}[-/]\\d{4})\\b");
    private static final Pattern ADDRESS_CODE = Pattern.compile("^[A-Z]{2,6}\\d{3,6}$");
    private static final Pattern COMPANY_TOKEN = Pattern.compile(
            "(?i)\\b([A-Za-z][A-Za-z0-9&.,'\\-\\s]{2,80}?\\s(?:FZ-LLC|FZ LLC|FZE|FZCO))\\b");

    private static final Set<String> EN_LABELS = Set.of(
            "licence no", "license no", "type", "legal type", "licensee", "operating name",
            "address", "activity", "manager", "issue date", "expiry date", "remarks",
            "government of ras al khaimah", "registration & licensing department",
            "registrar of companies"
    );

    private static final Set<String> EN_NOISE = Set.of(
            "rakez", "ras al khaimah", "economic zone", "government of ras al khaimah",
            "freezone", "united arab emirates", "the licensee must obtain the required approvals",
            "from the uae competent government authorities, as", "applicable",
            "registration & licensing department", "registrar of companies",
            "this document is electronically issued by ras al khaimah economic zone authority"
    );

    private static final Set<String> AR_LABELS = Set.of(
            "رقم الرخصة", "التصنيف", "العنوان", "النشاط", "المدير",
            "تاريخ الإصدار", "تاريخ الاصدار", "تاريخ الإنتهاء", "تاريخ الانتهاء",
            "ملاحظات", "صاحب الرخصة", "الإسم التجاري", "الاسم التجاري", "الشكل القانوني"
    );

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String primary = firstLicenceSegment(normalized);
        String[] lines = normalized.split("\n", -1);
        String[] primaryLines = primary.split("\n", -1);

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(primary, primaryLines));
        addIfNotEmpty(result, "licenceType", extractLicenceType(primaryLines));
        addIfNotEmpty(result, "licenceCategory", "Freezone");
        addIfNotEmpty(result, "licenceTypeAr", extractArabicAfterLabel(primaryLines, "التصنيف"));
        addIfNotEmpty(result, "legalType", extractLegalType(primaryLines));
        addIfNotEmpty(result, "legalTypeAr", extractArabicPrefixed(primaryLines, "الشكل القانوني"));

        String company = extractCompany(primaryLines, "LICENSEE");
        if (company.isBlank()) {
            company = extractCompany(primaryLines, "OPERATING NAME");
        }
        addIfNotEmpty(result, "companyName", company);
        String business = extractCompany(primaryLines, "OPERATING NAME");
        addIfNotEmpty(result, "businessName", business.isBlank() ? company : business);

        addIfNotEmpty(result, "companyNameAr", extractArabicPrefixed(primaryLines, "صاحب الرخصة"));
        String businessAr = extractArabicPrefixed(primaryLines, "الإسم التجاري", "الاسم التجاري");
        if (businessAr.isBlank()) {
            businessAr = extractArabicPrefixed(primaryLines, "صاحب الرخصة");
        }
        addIfNotEmpty(result, "businessNameAr", businessAr);

        List<String> dates = extractOrderedDates(primary);
        if (dates.size() >= 1) {
            addIfNotEmpty(result, "issueDate", normalizeDate(dates.get(0)));
        }
        if (dates.size() >= 2) {
            addIfNotEmpty(result, "expiryDate", normalizeDate(dates.get(1)));
        }

        String manager = extractManager(primaryLines);
        addIfNotEmpty(result, "manager", manager);
        String managerAr = extractManagerArabic(lines);
        addIfNotEmpty(result, "address", extractAddress(primaryLines));
        addIfNotEmpty(result, "addressAr", extractArabicAddress(primaryLines));

        List<String> enActivities = new ArrayList<>();
        List<String> arActivities = new ArrayList<>();
        extractPairedActivities(normalized, lines, enActivities, arActivities);
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(enActivities, arActivities));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(buildManagerMember(manager, managerAr)));
        // Document reference sits in the page footer; do not limit to the first field block.
        addIfNotEmpty(result, "registerNo", firstGroup(DOC_REF, normalized));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("RAKEZ trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String firstLicenceSegment(String text) {
        int page2 = indexOfIgnoreCase(text, "--- PAGE 2 ---");
        if (page2 > 0) {
            return text.substring(0, page2);
        }
        // Google OCR multi-licence PDFs repeat the government header.
        int secondHeader = indexOfIgnoreCase(text, "Government of Ras Al Khaimah", 40);
        if (secondHeader > 200) {
            return text.substring(0, secondHeader);
        }
        return text;
    }

    private String extractLicenseNo(String primary, String[] lines) {
        String inline = firstGroup(LICENCE_NO_INLINE, primary);
        if (!inline.isBlank()) {
            return inline;
        }
        Matcher beforeTitle = LICENCE_NO_BEFORE_AR_TITLE.matcher(primary);
        if (beforeTitle.find()) {
            return beforeTitle.group(1);
        }
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("رقم الرخصة")) {
                continue;
            }
            for (int j = Math.max(0, i - 8); j < Math.min(lines.length, i + 4); j++) {
                String candidate = lines[j].trim();
                if (candidate.matches("\\d{6,12}")) {
                    return candidate;
                }
            }
        }
        // Dump layout: digits just before Arabic رخصة title
        for (int i = 0; i < lines.length - 1; i++) {
            String cur = lines[i].trim();
            String next = lines[i + 1].trim();
            if (cur.matches("\\d{6,12}") && next.startsWith("رخصة")) {
                return cur;
            }
        }
        return "";
    }

    private String extractLicenceType(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String trimmed = lines[i].trim();
            if (!trimmed.equalsIgnoreCase("TYPE") && !trimmed.matches("(?i)^TYPE\\s+.+")) {
                continue;
            }
            String inline = trimmed.replaceFirst("(?i)^TYPE\\s*", "").trim();
            String fromInline = licenceTypeValue(inline);
            if (!fromInline.isBlank()) {
                return fromInline;
            }
            for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                String next = licenceTypeValue(lines[j]);
                if (!next.isBlank()) {
                    return next;
                }
            }
        }
        return "Freezone";
    }

    private String licenceTypeValue(String raw) {
        String en = cleanEnglish(raw);
        if (en.isBlank() || isEnglishLabel(en)) {
            return "";
        }
        // Keep Freezone even though it is otherwise treated as OCR noise elsewhere.
        if (en.equalsIgnoreCase("Freezone") || en.toLowerCase(Locale.ROOT).startsWith("freezone")) {
            return "Freezone";
        }
        if (isNoiseEnglish(en) || en.toUpperCase(Locale.ROOT).startsWith("FREE ZONE")
                || en.toUpperCase(Locale.ROOT).contains("LIMITED LIABILITY")) {
            return "";
        }
        String[] parts = en.split("\\s+");
        return parts.length > 0 ? parts[0] : en;
    }

    private String extractLegalType(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String trimmed = lines[i].trim();
            if (!trimmed.toUpperCase(Locale.ROOT).startsWith("LEGAL TYPE")) {
                continue;
            }
            String inline = trimmed.replaceFirst("(?i)^LEGAL\\s*TYPE\\s*", "").trim();
            String en = cleanEnglish(inline);
            if (en.toUpperCase(Locale.ROOT).contains("FREE ZONE") || en.toUpperCase(Locale.ROOT).contains("FZ")) {
                return en;
            }
            for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                String next = cleanEnglish(lines[j]);
                if (next.toUpperCase(Locale.ROOT).contains("FREE ZONE")
                        || next.toUpperCase(Locale.ROOT).contains("FZ-LLC")
                        || next.toUpperCase(Locale.ROOT).contains("LIMITED LIABILITY")) {
                    return next;
                }
            }
        }
        return "";
    }

    private String extractCompany(String[] lines, String label) {
        String upperLabel = label.toUpperCase(Locale.ROOT);
        for (int i = 0; i < lines.length; i++) {
            String raw = lines[i];
            String upper = raw.toUpperCase(Locale.ROOT);
            int idx = upper.indexOf(upperLabel);
            if (idx < 0) {
                continue;
            }
            String after = raw.substring(idx + label.length()).replaceFirst("^[:\\s]+", "").trim();
            // OPERATING NAMEAviar... (missing space)
            if (after.isBlank() && upper.startsWith(upperLabel) && raw.length() > label.length()) {
                after = raw.substring(label.length()).trim();
            }
            String fromInline = companyFrom(after);
            if (!fromInline.isBlank()) {
                return fromInline;
            }
            for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                String next = companyFrom(lines[j]);
                if (!next.isBlank()) {
                    return next;
                }
            }
        }
        return "";
    }

    private String companyFrom(String line) {
        if (line == null || line.isBlank()) {
            return "";
        }
        String en = cleanEnglish(line);
        Matcher matcher = COMPANY_TOKEN.matcher(en);
        if (matcher.find()) {
            return matcher.group(1).replaceAll("\\s{2,}", " ").trim();
        }
        if (en.toUpperCase(Locale.ROOT).contains("FZ-LLC") || en.toUpperCase(Locale.ROOT).contains("FZE")) {
            return en;
        }
        return "";
    }

    private String extractManager(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String trimmed = lines[i].trim();
            if (!trimmed.toUpperCase(Locale.ROOT).startsWith("MANAGER")) {
                continue;
            }
            String inline = cleanEnglish(trimmed.replaceFirst("(?i)^MANAGER\\s*", ""));
            if (isPlausiblePersonName(inline)) {
                return inline;
            }
            for (int j = i + 1; j < Math.min(i + 8, lines.length); j++) {
                String next = lines[j].trim();
                String upper = next.toUpperCase(Locale.ROOT);
                if (upper.equals("ISSUE DATE") || upper.equals("EXPIRY DATE") || upper.equals("REMARKS")
                        || upper.equals("ACTIVITY") || upper.equals("ADDRESS") || upper.startsWith("LICENCE")) {
                    continue;
                }
                if (next.matches("\\d{6,12}") || next.startsWith("رخصة") || ADDRESS_CODE.matcher(next).matches()) {
                    continue;
                }
                if (next.toLowerCase(Locale.ROOT).contains("building")
                        || next.toLowerCase(Locale.ROOT).contains("emirates")
                        || next.toLowerCase(Locale.ROOT).contains("zone-fz")
                        || next.toLowerCase(Locale.ROOT).contains("road")) {
                    continue;
                }
                String en = cleanEnglish(next);
                if (isPlausiblePersonName(en)) {
                    return en;
                }
            }
        }
        // Dump layout: person name immediately before licence digits + رخصة
        for (int i = 0; i < lines.length - 1; i++) {
            if (!lines[i].trim().matches("\\d{6,12}")) {
                continue;
            }
            if (i + 1 < lines.length && lines[i + 1].trim().startsWith("رخصة") && i > 0) {
                String prev = cleanEnglish(lines[i - 1]);
                if (isPlausiblePersonName(prev) && !looksLikeActivity(prev)) {
                    return prev;
                }
            }
        }
        return "";
    }

    private boolean isPlausiblePersonName(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        if (isEnglishLabel(value) || isNoiseEnglish(value) || looksLikeActivity(value)) {
            return false;
        }
        if (value.toUpperCase(Locale.ROOT).contains("FZ-LLC") || value.toUpperCase(Locale.ROOT).contains("BUILDING")) {
            return false;
        }
        if (!value.matches("[A-Za-z][A-Za-z.'\\-\\s]{2,60}")) {
            return false;
        }
        String[] parts = value.trim().split("\\s+");
        return parts.length >= 2 && parts.length <= 6;
    }

    private boolean looksLikeActivity(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        return lower.contains("services")
                || lower.contains("trading")
                || lower.contains("management")
                || lower.contains("consult")
                || lower.contains("photography")
                || lower.contains("tourism")
                || lower.contains("marketing")
                || lower.contains("broker")
                || lower.contains("network")
                || lower.contains("destination");
    }

    private String extractAddress(String[] lines) {
        int addressIdx = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].trim().equalsIgnoreCase("ADDRESS")
                    || lines[i].trim().toUpperCase(Locale.ROOT).startsWith("ADDRESS ")) {
                addressIdx = i;
                break;
            }
        }
        if (addressIdx < 0) {
            return "";
        }

        List<String> parts = new ArrayList<>();
        String inline = lines[addressIdx].replaceFirst("(?i)^ADDRESS\\s*", "").trim();
        if (!inline.isBlank() && !isEnglishLabel(inline)) {
            String en = cleanEnglish(inline);
            if (!en.isBlank()) {
                parts.add(en);
            }
        }

        boolean sawContent = !parts.isEmpty();
        for (int i = addressIdx + 1; i < Math.min(addressIdx + 12, lines.length); i++) {
            String trimmed = lines[i].trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String upper = trimmed.toUpperCase(Locale.ROOT);
            if (upper.equals("ACTIVITY") || upper.equals("MANAGER") || upper.equals("ISSUE DATE")
                    || upper.equals("EXPIRY DATE") || upper.equals("REMARKS")
                    || upper.equals("TYPE") || upper.startsWith("LEGAL TYPE")) {
                if (sawContent) {
                    break;
                }
                continue;
            }
            if (trimmed.startsWith("<<") || trimmed.matches("\\d{6,12}") || trimmed.startsWith("رخصة")
                    || trimmed.contains("العنوان") || trimmed.contains("رقم الرخصة")) {
                if (sawContent) {
                    break;
                }
                continue;
            }
            if (arabicTextProcessor.containsArabic(trimmed) && !trimmed.matches(".*[A-Za-z]{3,}.*")) {
                if (sawContent) {
                    break;
                }
                continue;
            }
            if (isPlausiblePersonName(cleanEnglish(trimmed)) && sawContent) {
                break;
            }
            if (looksLikeActivity(cleanEnglish(trimmed)) && sawContent
                    && parts.stream().anyMatch(p -> p.toLowerCase(Locale.ROOT).contains("emirates")
                    || p.toLowerCase(Locale.ROOT).contains("zone"))) {
                break;
            }
            String en = cleanEnglish(trimmed);
            if (en.isBlank() || isNoiseEnglish(en)) {
                continue;
            }
            // Avoid duplicating address code when it reappears before Arabic block
            if (ADDRESS_CODE.matcher(en).matches() && parts.stream().anyMatch(p -> p.equalsIgnoreCase(en))) {
                break;
            }
            parts.add(en);
            sawContent = true;
            if (en.toLowerCase(Locale.ROOT).contains("united arab emirates")
                    || en.toLowerCase(Locale.ROOT).contains("ras al khaimah")
                    && parts.size() >= 3) {
                // keep going briefly for trailing Emirates line already included
                if (en.toLowerCase(Locale.ROOT).contains("united arab emirates")) {
                    break;
                }
            }
        }
        return String.join(", ", parts).replaceAll(",\\s*,", ",").trim();
    }

    private void extractPairedActivities(String text, String[] lines,
                                         List<String> enOut, List<String> arOut) {
        // Embedded PDF markers: <<Activity
        Matcher marker = ACTIVITY_MARKER.matcher(text);
        List<String> markerEn = new ArrayList<>();
        while (marker.find()) {
            String activity = cleanEnglish(marker.group(1));
            if (isValidActivity(activity)) {
                markerEn.add(activity);
            }
        }
        if (!markerEn.isEmpty()) {
            List<String> markerAr = extractArabicActivitiesBetweenLabels(lines, null);
            enOut.addAll(markerEn);
            // Align Arabic by index when counts match; otherwise append what we have.
            for (int i = 0; i < markerEn.size(); i++) {
                arOut.add(i < markerAr.size() ? markerAr.get(i) : "");
            }
            return;
        }

        // Google OCR / line layout: pair each ACTIVITY block with the following النشاط block.
        for (int i = 0; i < lines.length; i++) {
            String trimmed = lines[i].trim();
            if (!trimmed.equalsIgnoreCase("ACTIVITY")
                    && !trimmed.toUpperCase(Locale.ROOT).startsWith("ACTIVITY ")) {
                continue;
            }
            List<String> sectionEn = new ArrayList<>();
            String inline = trimmed.replaceFirst("(?i)^ACTIVITY\\s*", "").trim().replaceFirst("^<<\\s*", "");
            String inlineEn = cleanEnglish(inline);
            if (isValidActivity(inlineEn)) {
                sectionEn.add(inlineEn);
            }
            int end = Math.min(i + 30, lines.length);
            for (int j = i + 1; j < end; j++) {
                String line = lines[j].trim();
                if (line.isEmpty()) {
                    continue;
                }
                String upper = line.toUpperCase(Locale.ROOT);
                if (upper.equals("MANAGER") || upper.startsWith("MANAGER ")
                        || upper.equals("ISSUE DATE") || upper.startsWith("ISSUE DATE ")
                        || upper.equals("EXPIRY DATE") || upper.startsWith("EXPIRY DATE ")
                        || upper.equals("REMARKS") || upper.startsWith("REMARKS ")
                        || upper.equals("ADDRESS") || upper.equals("ACTIVITY")
                        || upper.startsWith("LICENCE") || upper.startsWith("LICENSE")
                        || upper.startsWith("LEGAL TYPE") || upper.equals("TYPE")
                        || ADDRESS_CODE.matcher(line).matches()) {
                    // Labels / address codes may appear before displaced activity values.
                    continue;
                }
                if (line.contains("النشاط") || line.contains("المدير") || line.contains("رقم الرخصة")
                        || line.matches("\\d{6,12}") || line.startsWith("رخصة")) {
                    break;
                }
                if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                    continue;
                }
                String en = cleanEnglish(line);
                if (en.toLowerCase(Locale.ROOT).contains("building")
                        || en.toLowerCase(Locale.ROOT).contains("zone-fz")
                        || en.toLowerCase(Locale.ROOT).contains("zone -")
                        || en.toLowerCase(Locale.ROOT).contains("emirates")
                        || en.toLowerCase(Locale.ROOT).contains("road")
                        || en.toLowerCase(Locale.ROOT).contains("united arab")
                        || en.toLowerCase(Locale.ROOT).contains("ras al khaimah")
                        || en.toLowerCase(Locale.ROOT).startsWith("the licensee")
                        || en.toLowerCase(Locale.ROOT).startsWith("from the uae")
                        || en.equalsIgnoreCase("applicable")) {
                    continue;
                }
                if (isPlausiblePersonName(en)) {
                    break;
                }
                if (isValidActivity(en)) {
                    sectionEn.add(en);
                }
            }

            List<String> sectionAr = extractArabicActivityBlockAfter(lines, i);
            if (sectionEn.isEmpty()) {
                continue;
            }
            int count = Math.max(sectionEn.size(), sectionAr.size());
            for (int k = 0; k < count; k++) {
                enOut.add(k < sectionEn.size() ? sectionEn.get(k) : "");
                arOut.add(k < sectionAr.size() ? sectionAr.get(k) : "");
            }
        }

        // Dump layout fallback (values after REMARKS before رخصة) when no ACTIVITY values found.
        if (enOut.isEmpty()) {
            List<String> dumped = extractActivities(text, lines);
            List<String> dumpedAr = extractArabicActivitiesBetweenLabels(lines, null);
            for (int i = 0; i < dumped.size(); i++) {
                enOut.add(dumped.get(i));
                arOut.add(i < dumpedAr.size() ? dumpedAr.get(i) : "");
            }
        }
    }

    /**
     * Arabic activities for the licence section starting at {@code fromIdx}.
     * Prefers lines under {@code النشاط}; if that block is empty (008 SERVICES layout),
     * falls back to Arabic lines immediately before {@code العنوان} (after the address).
     */
    private List<String> extractArabicActivityBlockAfter(String[] lines, int fromIdx) {
        for (int i = fromIdx; i < lines.length; i++) {
            if (!lines[i].contains("النشاط")) {
                continue;
            }
            List<String> between = new ArrayList<>();
            String same = stripArabicLabel(keepArabic(lines[i]), "النشاط");
            if (isValidArabicActivity(same)) {
                between.add(arabicTextProcessor.normalizeArabic(same));
            }
            int managerIdx = -1;
            for (int j = i + 1; j < Math.min(i + 12, lines.length); j++) {
                String trimmed = lines[j].trim();
                if (trimmed.contains("المدير") || trimmed.equalsIgnoreCase("MANAGER")) {
                    managerIdx = j;
                    break;
                }
                if (trimmed.contains("تاريخ") || trimmed.contains("ملاحظات")
                        || trimmed.toUpperCase(Locale.ROOT).startsWith("ISSUE")
                        || trimmed.toUpperCase(Locale.ROOT).startsWith("EXPIRY")) {
                    break;
                }
                if (trimmed.contains("العنوان") || isArabicLabelOnly(trimmed)) {
                    continue;
                }
                String arabic = stripArabicLabel(keepArabic(trimmed), "النشاط");
                if (isValidArabicActivity(arabic)) {
                    between.add(arabicTextProcessor.normalizeArabic(arabic));
                }
            }
            boolean nameAfterManager = false;
            if (managerIdx >= 0) {
                for (int j = managerIdx + 1; j < Math.min(managerIdx + 3, lines.length); j++) {
                    String trimmed = lines[j].trim();
                    if (trimmed.contains("تاريخ") || trimmed.contains("ملاحظات") || trimmed.contains("النشاط")) {
                        break;
                    }
                    String arabic = keepArabic(trimmed);
                    if (arabic.length() >= 3 && !isArabicLabelOnly(arabic)) {
                        nameAfterManager = true;
                        break;
                    }
                }
            }
            if (between.size() >= 2 && !nameAfterManager) {
                between.remove(between.size() - 1);
            }
            if (!between.isEmpty()) {
                return between;
            }
            // 008 SERVICES: Arabic activities sit above العنوان while النشاط is empty.
            List<String> beforeAddress = extractArabicActivitiesBeforeUnwan(lines, fromIdx, i);
            if (!beforeAddress.isEmpty()) {
                return beforeAddress;
            }
            return List.of();
        }
        return List.of();
    }

    /**
     * Collect Arabic activity lines between the Arabic address and {@code العنوان}.
     */
    private List<String> extractArabicActivitiesBeforeUnwan(String[] lines, int fromIdx, int nashatIdx) {
        int unwanIdx = -1;
        for (int i = nashatIdx; i >= fromIdx; i--) {
            if (lines[i].contains("العنوان")) {
                unwanIdx = i;
                break;
            }
        }
        if (unwanIdx < 0) {
            for (int i = fromIdx; i < Math.min(nashatIdx + 1, lines.length); i++) {
                if (lines[i].contains("العنوان")) {
                    unwanIdx = i;
                    break;
                }
            }
        }
        if (unwanIdx < 0) {
            return List.of();
        }

        List<String> collected = new ArrayList<>();
        for (int j = unwanIdx - 1; j >= fromIdx; j--) {
            String trimmed = lines[j].trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (ADDRESS_CODE.matcher(trimmed).matches()) {
                break;
            }
            if (trimmed.contains("صاحب الرخصة") || trimmed.contains("الإسم التجاري")
                    || trimmed.contains("الاسم التجاري") || trimmed.contains("الشكل القانوني")
                    || trimmed.contains("رقم الرخصة") || trimmed.contains("التصنيف")
                    || trimmed.matches("\\d{1,2}[-/]\\d{1,2}[-/]\\d{4}")
                    || trimmed.equalsIgnoreCase("REMARKS")
                    || trimmed.toUpperCase(Locale.ROOT).startsWith("MANAGER")
                    || trimmed.toUpperCase(Locale.ROOT).startsWith("ACTIVITY")) {
                break;
            }
            if (trimmed.matches(".*[A-Za-z]{3,}.*") && !arabicTextProcessor.containsArabic(trimmed)) {
                break;
            }
            String arabic = keepArabic(trimmed);
            if (arabic.length() >= 3 && !isArabicLabelOnly(arabic)) {
                collected.add(0, arabicTextProcessor.normalizeArabic(arabic));
            }
        }
        while (!collected.isEmpty() && looksLikeArabicAddressLine(collected.get(0))) {
            collected.remove(0);
        }
        return collected;
    }

    private boolean looksLikeArabicAddressLine(String arabic) {
        if (arabic == null || arabic.isBlank()) {
            return false;
        }
        String normalized = arabicTextProcessor.normalizeArabic(arabic);
        return normalized.contains("كومباس")
                || normalized.contains("الامارات")
                || normalized.contains("راس الخيمة")
                || normalized.contains("شارع")
                || (normalized.contains("منطقة") && normalized.contains("حرة")
                && (normalized.contains("صناعية") || normalized.contains("الحمرا") || normalized.contains("الحليلة")));
    }

    private List<String> extractArabicActivitiesBetweenLabels(String[] lines, String managerAr) {
        LinkedHashSet<String> activities = new LinkedHashSet<>();
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("النشاط")) {
                continue;
            }
            List<String> block = new ArrayList<>();
            String same = stripArabicLabel(keepArabic(lines[i]), "النشاط");
            if (isValidArabicActivity(same)) {
                block.add(arabicTextProcessor.normalizeArabic(same));
            }
            for (int j = i + 1; j < Math.min(i + 12, lines.length); j++) {
                String trimmed = lines[j].trim();
                if (trimmed.contains("المدير") || trimmed.contains("تاريخ") || trimmed.contains("ملاحظات")
                        || trimmed.equalsIgnoreCase("MANAGER")
                        || trimmed.toUpperCase(Locale.ROOT).startsWith("ISSUE")
                        || trimmed.toUpperCase(Locale.ROOT).startsWith("EXPIRY")) {
                    break;
                }
                if (isArabicLabelOnly(trimmed)) {
                    continue;
                }
                String arabic = stripArabicLabel(keepArabic(trimmed), "النشاط");
                if (!isValidArabicActivity(arabic)) {
                    continue;
                }
                String normalizedAr = arabicTextProcessor.normalizeArabic(arabic);
                if (managerAr != null && !managerAr.isBlank() && normalizedAr.equals(managerAr)) {
                    break;
                }
                block.add(normalizedAr);
            }
            if (block.size() >= 2 && (managerAr == null || managerAr.isBlank())) {
                boolean nameAfterManager = false;
                for (int j = i + 1; j < Math.min(i + 14, lines.length); j++) {
                    if (!lines[j].contains("المدير")) {
                        continue;
                    }
                    for (int k = j + 1; k < Math.min(j + 3, lines.length); k++) {
                        String ar = keepArabic(lines[k].trim());
                        if (ar.length() >= 3 && !isArabicLabelOnly(ar)
                                && !lines[k].contains("تاريخ") && !lines[k].contains("ملاحظات")) {
                            nameAfterManager = true;
                            break;
                        }
                    }
                    break;
                }
                if (!nameAfterManager) {
                    block.remove(block.size() - 1);
                }
            }
            activities.addAll(block);
        }
        return new ArrayList<>(activities);
    }

    private String extractManagerArabic(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("المدير")) {
                continue;
            }
            String same = stripArabicLabel(keepArabic(lines[i]), "المدير");
            if (same.length() >= 3) {
                return arabicTextProcessor.normalizeArabic(same);
            }
            // Prefer name below المدير (5b4 Google OCR: النشاط / activity / المدير / name)
            for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                String trimmed = lines[j].trim();
                if (trimmed.contains("تاريخ") || trimmed.contains("ملاحظات") || trimmed.contains("النشاط")) {
                    break;
                }
                String arabic = keepArabic(trimmed);
                if (arabic.length() >= 3 && !isArabicLabelOnly(arabic)) {
                    return arabicTextProcessor.normalizeArabic(arabic);
                }
            }
            // Fallback: name above المدير only when there are multiple Arabic lines between
            // النشاط and المدير (last line is the manager; earlier lines are activities).
            int nashatIdx = -1;
            for (int j = i - 1; j >= Math.max(0, i - 10); j--) {
                if (lines[j].contains("النشاط")) {
                    nashatIdx = j;
                    break;
                }
            }
            if (nashatIdx >= 0) {
                List<String> between = new ArrayList<>();
                for (int j = nashatIdx + 1; j < i; j++) {
                    String arabic = keepArabic(lines[j].trim());
                    if (arabic.length() >= 3 && !isArabicLabelOnly(arabic)) {
                        between.add(arabicTextProcessor.normalizeArabic(arabic));
                    }
                }
                if (between.size() >= 2) {
                    return between.get(between.size() - 1);
                }
                // Single line between النشاط and المدير is the activity, not the manager.
            }
        }
        return "";
    }

    private List<String> extractActivities(String text, String[] lines) {
        LinkedHashSet<String> activities = new LinkedHashSet<>();
        Matcher marker = ACTIVITY_MARKER.matcher(text);
        while (marker.find()) {
            String activity = cleanEnglish(marker.group(1));
            if (isValidActivity(activity)) {
                activities.add(activity);
            }
        }
        if (!activities.isEmpty()) {
            return new ArrayList<>(activities);
        }

        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].trim().equalsIgnoreCase("ACTIVITY")
                    && !lines[i].trim().toUpperCase(Locale.ROOT).startsWith("ACTIVITY ")) {
                continue;
            }
            String inline = lines[i].replaceFirst("(?i)^ACTIVITY\\s*", "").trim()
                    .replaceFirst("^<<\\s*", "");
            String inlineEn = cleanEnglish(inline);
            if (isValidActivity(inlineEn)) {
                activities.add(inlineEn);
            }
            for (int j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                String trimmed = lines[j].trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                String upper = trimmed.toUpperCase(Locale.ROOT);
                if (upper.equals("MANAGER") || upper.startsWith("MANAGER ")
                        || upper.equals("ISSUE DATE") || upper.startsWith("ISSUE DATE ")
                        || upper.equals("EXPIRY DATE") || upper.startsWith("EXPIRY DATE ")
                        || upper.equals("REMARKS") || upper.startsWith("REMARKS ")
                        || upper.equals("ADDRESS") || upper.equals("ACTIVITY")
                        || upper.startsWith("LICENCE") || upper.startsWith("LICENSE")
                        || upper.startsWith("LEGAL TYPE") || upper.equals("TYPE")) {
                    break;
                }
                if (trimmed.matches("\\d{6,12}") || trimmed.startsWith("رخصة") || trimmed.contains("رقم الرخصة")
                        || trimmed.contains("النشاط") || trimmed.contains("المدير")
                        || isEnglishLabel(trimmed) || ADDRESS_CODE.matcher(trimmed).matches()) {
                    break;
                }
                if (arabicTextProcessor.containsArabic(trimmed) && !trimmed.matches(".*[A-Za-z]{3,}.*")) {
                    continue;
                }
                String en = cleanEnglish(trimmed);
                if (isPlausiblePersonName(en)) {
                    break;
                }
                if (isValidActivity(en)) {
                    activities.add(en);
                }
            }
        }

        // Dump layout (page-1 of 008): values after REMARKS before رخصة
        if (activities.isEmpty()) {
            for (int i = 0; i < lines.length; i++) {
                if (!lines[i].trim().equalsIgnoreCase("REMARKS")) {
                    continue;
                }
                boolean afterAddressCode = false;
                for (int j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                    String trimmed = lines[j].trim();
                    if (trimmed.startsWith("رخصة") || trimmed.matches("\\d{6,12}")) {
                        break;
                    }
                    if (ADDRESS_CODE.matcher(trimmed).matches()) {
                        afterAddressCode = true;
                        continue;
                    }
                    String en = cleanEnglish(trimmed);
                    if (!afterAddressCode) {
                        continue;
                    }
                    if (en.toLowerCase(Locale.ROOT).contains("building")
                            || en.toLowerCase(Locale.ROOT).contains("zone")
                            || en.toLowerCase(Locale.ROOT).contains("emirates")
                            || en.toLowerCase(Locale.ROOT).contains("road")
                            || en.toLowerCase(Locale.ROOT).contains("ras al khaimah")) {
                        continue;
                    }
                    if (isPlausiblePersonName(en)) {
                        break;
                    }
                    if (isValidActivity(en)) {
                        activities.add(en);
                    }
                }
                break;
            }
        }
        return new ArrayList<>(activities);
    }

    private boolean isValidActivity(String value) {
        if (value == null || value.isBlank() || value.length() < 5) {
            return false;
        }
        if (isEnglishLabel(value) || isNoiseEnglish(value) || isPlausiblePersonName(value)) {
            return false;
        }
        if (value.matches("\\d+") || ADDRESS_CODE.matcher(value).matches()) {
            return false;
        }
        String upper = value.toUpperCase(Locale.ROOT);
        if (upper.endsWith(" LICENCE") || upper.endsWith(" LICENSE")
                || upper.startsWith("MANAGER ") || upper.startsWith("ISSUE ")
                || upper.startsWith("EXPIRY ") || upper.startsWith("REMARKS ")) {
            return false;
        }
        return value.matches(".*[A-Za-z]{3,}.*");
    }

    private boolean isValidArabicActivity(String value) {
        if (value == null || value.isBlank() || value.length() < 4) {
            return false;
        }
        for (String label : AR_LABELS) {
            if (value.equals(label)) {
                return false;
            }
        }
        return !value.contains("على المرخص") && !value.contains("الموافقات");
    }

    private String extractArabicAddress(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("العنوان")) {
                continue;
            }
            List<String> parts = new ArrayList<>();
            for (int j = Math.max(0, i - 6); j < i; j++) {
                String trimmed = lines[j].trim();
                if (ADDRESS_CODE.matcher(trimmed).matches()) {
                    parts.clear();
                    continue;
                }
                if (trimmed.contains("صاحب الرخصة") || trimmed.contains("الإسم التجاري")
                        || trimmed.contains("الاسم التجاري") || trimmed.contains("الشكل القانوني")
                        || trimmed.contains("رقم الرخصة") || trimmed.contains("التصنيف")) {
                    parts.clear();
                    continue;
                }
                String arabic = keepArabic(trimmed);
                if (arabic.length() >= 4 && !isArabicLabelOnly(arabic)) {
                    parts.add(arabicTextProcessor.normalizeArabic(arabic.replaceAll("[,،]+$", "").trim()));
                }
            }
            if (!parts.isEmpty()) {
                return String.join("، ", parts);
            }
        }
        return "";
    }

    private String extractArabicPrefixed(String[] lines, String... labels) {
        for (String line : lines) {
            for (String label : labels) {
                if (!line.contains(label)) {
                    continue;
                }
                String arabic = keepArabic(line);
                arabic = stripArabicLabel(arabic, label);
                int labelIdx = line.indexOf(label);
                if (labelIdx > 0) {
                    String before = keepArabic(line.substring(0, labelIdx));
                    if (before.length() >= 4) {
                        arabic = before;
                    }
                }
                if (arabic.length() >= 4) {
                    return arabicTextProcessor.normalizeArabic(arabic);
                }
            }
        }
        return extractArabicFromEnglishLabelLine(lines, labels);
    }

    private String extractArabicFromEnglishLabelLine(String[] lines, String... arabicLabels) {
        boolean wantLicensee = false;
        boolean wantOperating = false;
        for (String label : arabicLabels) {
            if (label.contains("صاحب")) {
                wantLicensee = true;
            }
            if (label.contains("التجاري")) {
                wantOperating = true;
            }
        }
        for (String line : lines) {
            String upper = line.toUpperCase(Locale.ROOT);
            if (wantLicensee && upper.contains("LICENSEE")) {
                String arabic = keepArabic(line);
                if (arabic.length() >= 4) {
                    return arabicTextProcessor.normalizeArabic(arabic);
                }
            }
            if (wantOperating && upper.contains("OPERATING")) {
                String arabic = keepArabic(line);
                if (arabic.length() >= 4) {
                    return arabicTextProcessor.normalizeArabic(arabic);
                }
            }
        }
        return "";
    }

    private String extractArabicAfterLabel(String[] lines, String label) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains(label)) {
                continue;
            }
            String same = stripArabicLabel(keepArabic(lines[i]), label);
            if (same.length() >= 3) {
                return arabicTextProcessor.normalizeArabic(same);
            }
            for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                String arabic = keepArabic(lines[j].trim());
                if (arabic.length() >= 3 && !isArabicLabelOnly(arabic)) {
                    return arabicTextProcessor.normalizeArabic(arabic);
                }
            }
        }
        return "";
    }

    private List<String> extractOrderedDates(String text) {
        List<String> dates = new ArrayList<>();
        Matcher matcher = DATE_TOKEN.matcher(text);
        while (matcher.find()) {
            String date = matcher.group(1);
            if (!dates.contains(date)) {
                dates.add(date);
            }
            if (dates.size() >= 2) {
                break;
            }
        }
        return dates;
    }

    private List<Map<String, String>> buildManagerMember(String manager, String managerAr) {
        if ((manager == null || manager.isBlank()) && (managerAr == null || managerAr.isBlank())) {
            return List.of();
        }
        Map<String, String> person = new LinkedHashMap<>();
        if (manager != null && !manager.isBlank()) {
            person.put("nameEn", manager);
        }
        if (managerAr != null && !managerAr.isBlank()) {
            person.put("nameAr", managerAr);
        }
        person.put("role", "Manager");
        return List.of(person);
    }

    private String firstGroup(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).trim() : "";
    }

    private String cleanEnglish(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        return value
                .replaceAll("[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]+", " ")
                .replaceAll("[^A-Za-z0-9&.,'/\\-\\s]", " ")
                .replaceAll("\\s{2,}", " ")
                .trim();
    }

    private String keepArabic(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < value.length(); ) {
            int cp = value.codePointAt(i);
            if (Character.UnicodeScript.of(cp) == Character.UnicodeScript.ARABIC
                    || Character.isWhitespace(cp)
                    || cp == '-' || cp == '–' || cp == '.' || cp == '،' || cp == ',') {
                sb.appendCodePoint(cp);
            }
            i += Character.charCount(cp);
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private String stripArabicLabel(String arabic, String label) {
        if (arabic == null || arabic.isBlank()) {
            return "";
        }
        return arabic.replace(label, " ").replaceAll("\\s{2,}", " ").trim();
    }

    private boolean isArabicLabelOnly(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            return true;
        }
        for (String label : AR_LABELS) {
            if (trimmed.equals(label) || trimmed.equals(label + " ")) {
                return true;
            }
        }
        return false;
    }

    private boolean isEnglishLabel(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        String lower = value.toLowerCase(Locale.ROOT).trim();
        if (EN_LABELS.contains(lower)) {
            return true;
        }
        return lower.matches("licen[cs]e\\s*no\\.?")
                || lower.equals("operating name")
                || lower.equals("legal type");
    }

    private boolean isNoiseEnglish(String value) {
        String lower = value.toLowerCase(Locale.ROOT).trim();
        if (EN_NOISE.contains(lower)) {
            return true;
        }
        return lower.startsWith("this document is electronically")
                || lower.startsWith("for verification purpose")
                || lower.startsWith("issued by ras al khaimah")
                || lower.equals("a");
    }

    private int indexOfIgnoreCase(String text, String needle) {
        return indexOfIgnoreCase(text, needle, 0);
    }

    private int indexOfIgnoreCase(String text, String needle, int from) {
        return text.toLowerCase(Locale.ROOT).indexOf(needle.toLowerCase(Locale.ROOT), from);
    }
}
