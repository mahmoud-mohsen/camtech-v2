package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.model.DocumentType;
import com.facetech.backend.model.TradeLicenceFormat;
import com.facetech.backend.parser.DocumentParser;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import com.facetech.backend.parser.util.ConfidenceCalculator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@RequiredArgsConstructor
@Slf4j
public class TradeLicenceParser implements DocumentParser {

    private final ArabicTextProcessor arabicTextProcessor;
    private final ConfidenceCalculator confidenceCalculator;
    private final SeddTradeLicenceExtractor seddTradeLicenceExtractor;
    private final JafzaTradeLicenceExtractor jafzaTradeLicenceExtractor;
    private final AbuDhabiDedTradeLicenceExtractor abuDhabiDedTradeLicenceExtractor;
    private final AjmanDedTradeLicenceExtractor ajmanDedTradeLicenceExtractor;
    private final AjmanFzaTradeLicenceExtractor ajmanFzaTradeLicenceExtractor;
    private final AjmanAncfzTradeLicenceExtractor ajmanAncfzTradeLicenceExtractor;
    private final RasAlKhaimahDedTradeLicenceExtractor rasAlKhaimahDedTradeLicenceExtractor;
    private final RakezTradeLicenceExtractor rakezTradeLicenceExtractor;
    private final UmmAlQuwainDedTradeLicenceExtractor ummAlQuwainDedTradeLicenceExtractor;
    private final UmmAlQuwainFreeZoneTradeLicenceExtractor ummAlQuwainFreeZoneTradeLicenceExtractor;
    private final FujairahDedTradeLicenceExtractor fujairahDedTradeLicenceExtractor;
    private final FujairahDibbaDedTradeLicenceExtractor fujairahDibbaDedTradeLicenceExtractor;
    private final FujairahMediaZoneCreativeCityTradeLicenceExtractor fujairahMediaZoneCreativeCityTradeLicenceExtractor;
    private final SharjahAirportInternationalFreeZoneTradeLicenceExtractor sharjahAirportInternationalFreeZoneTradeLicenceExtractor;
    private final SharjahMediaCityFreeZoneTradeLicenceExtractor sharjahMediaCityFreeZoneTradeLicenceExtractor;
    private final SharjahPublishingCityTradeLicenceExtractor sharjahPublishingCityTradeLicenceExtractor;
    private final SharjahResearchTechnologyInnovationParkTradeLicenceExtractor sharjahResearchTechnologyInnovationParkTradeLicenceExtractor;

    private static final Pattern ACTIVITY_SUFFIX_LINE = Pattern.compile("(?i).+[A-Za-z].+\\s+Activity\\s*$");
    private static final Pattern DATE_PATTERN        = Pattern.compile("\\b(\\d{2})/(\\d{2})/(\\d{4})\\b");
    private static final Pattern LICENCE_NO_PATTERN  = Pattern.compile("(?i)licen[cs]e\\s*(?:no\\.?|number)?\\s*[:\\s]\\s*(\\d{4,10})");
    private static final Pattern DUNS_PATTERN        = Pattern.compile("(?i)d[- &]u[- ]n[- ]s[\\s\\S]{0,20}?(\\d{2}-\\d{3}-\\d{4}|\\d{9,12})");
    private static final Pattern PHONE_PATTERN       = Pattern.compile("(?i)(?:phone|tel)\\s*(?:no\\.?)?\\s*[:\\s]\\s*([+\\d][\\d\\s\\-]{5,20})");
    private static final Pattern FAX_PATTERN         = Pattern.compile("(?i)fax\\s*(?:no\\.?)?\\s*[:\\s]\\s*([+\\d][\\d\\s\\-]{5,20})");
    private static final Pattern MOBILE_PATTERN      = Pattern.compile("(?i)mobile\\s*(?:no\\.?)?\\s*[:\\s]\\s*([+\\d][\\d\\s\\-]{5,20})");
    private static final Pattern EMAIL_PATTERN       = Pattern.compile("[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}");
    private static final Pattern POBOX_PATTERN       = Pattern.compile("(?i)p\\.?\\s*o\\.?\\s*box\\s*[:\\s]?\\s*(\\d{3,10})");
    private static final Pattern PARCEL_PATTERN      = Pattern.compile("(?i)parcel\\s*id\\s*:?\\s*([A-Z0-9]{4,20})");
    private static final Pattern DCCI_PATTERN        = Pattern.compile("(?i)dcci\\s*(?:no\\.?)?\\s*[:\\s]?\\s*(\\d{4,10})");
    private static final Pattern REGISTER_PATTERN    = Pattern.compile("(?i)register\\s*(?:no\\.?|number)?\\s*[:\\s]?\\s*(\\d{4,10})");
    private static final Pattern MAIN_LICENSE_PATTERN = Pattern.compile("(?i)main\\s*licen[cs]e\\s*(?:no\\.?)?\\s*[:\\s]?\\s*(\\d{4,10})");

    /** Fixed section headings on Dubai DET trade licences (Arabic labels are stable). */
    private static final Pattern MEMBERS_HEADING = Pattern.compile(
            "(?i)license\\s*members?|الأطراف|الاطراف|الطراف");
    private static final Pattern PARTNERS_HEADING = Pattern.compile(
            "(?i)license\\s*partners?|اصحاب\\s*الرخص[ةه]|أصحاب\\s*الرخص[ةه]|ملحق\\s*الشركاء");
    private static final Pattern SECTION_END = Pattern.compile(
            "(?i).*(receipt\\s*no|print\\s*date|يمكنك|now\\s*you|get\\s*free|zoho|وثيقة|register\\s*detail|capital\\s*detail|commercial\\s*register|أنشطة\\s*الرخصة|license\\s*activit|status\\s*activity|activity\\s*status|address|p\\.o\\.).*");
    private static final Pattern COLUMN_HEADER = Pattern.compile(
            "(?i)^(share|role|nationality|name|sr\\.?\\s*no|no\\.?\\s*of\\s*shares|الحصص|الصفة|الجنسية|الاسم|مسلسل|رقم\\s*الشخص)$|"
                    + ".*(share.*role|role.*share|nationality.*name|name.*nationality).*");
    private static final Pattern SRNO_ONLY = Pattern.compile("^(\\d{5,10})$");
    private static final Pattern SHARE_ONLY = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*%\\s*$");
    /** Compact member row: ArabicName + Nationality + SrNo e.g. "نصار احمد...خانباكستان 830753" */
    private static final Pattern MEMBER_AR_NAT_SRNO = Pattern.compile(
            "^(.+?)(باكستان|پاکستان|باکستان|باكستان|الامارات|الإمارات|السعودية|مصر|الأردن|الاردن|الهند|عمان|الكويت|البحرين|قطر|لبنان)\\s*(\\d{5,10})\\s*$");
    /** Partner row: SrNo + Name + Share% — greedy name capture before trailing percentage. */
    private static final Pattern PARTNER_SRNO_NAME_SHARE = Pattern.compile(
            "^(\\d{5,10})\\s+(.+)\\s+(\\d+(?:\\.\\d+)?)\\s*%\\s*$", Pattern.CASE_INSENSITIVE);
    /** Partner row without share: SrNo + Name e.g. "666808 Farough Abdulrahman Abbas Khushnood" */
    private static final Pattern PARTNER_SRNO_NAME = Pattern.compile(
            "^(\\d{5,10})\\s+(.+)$");
    private static final Pattern NAT_EN = Pattern.compile(
            "(?i)\\b(united arab emirates|uae|pakistan|saudi arabia|egypt|jordan|india|oman|kuwait|bahrain|qatar|lebanon)\\b");
    private static final Pattern NAT_AR = Pattern.compile(
            "(الامارات|الإمارات|پاکستان|باکستان|باكستان|السعودية|مصر|الأردن|الاردن|الهند|عمان|الكويت|البحرين|قطر|لبنان)");
    private static final Pattern ROLE = Pattern.compile("(?i)\\b(manager|director|partner|owner)\\b");

    @Override
    public DocumentFieldsDto parse(String ocrText) {
        return parse(ocrText, null);
    }

    public DocumentFieldsDto parse(String ocrText, TradeLicenceFormat format) {
        TradeLicenceFormat resolved = format != null ? format : TradeLicenceFormatDetector.detect(ocrText);
        log.debug("Trade licence format {} ({})", resolved, format != null ? "requested by caller" : "auto-detected");
        if (resolved == TradeLicenceFormat.SHARJAH_DED) {
            return seddTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.JAFZA) {
            return jafzaTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.ABU_DHABI_DED) {
            return abuDhabiDedTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.AJMAN_DED) {
            return ajmanDedTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.AJMAN_FZA) {
            return ajmanFzaTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.AJMAN_ANCFZ) {
            return ajmanAncfzTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.RAS_AL_KHAIMAH_DED) {
            return rasAlKhaimahDedTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.RAS_AL_KHAIMAH_ECONOMIC_ZONE_RAKEZ) {
            return rakezTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.UMM_AL_QUWAIN_DED) {
            return ummAlQuwainDedTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.UMM_AL_QUWAIN_FREE_ZONE) {
            return ummAlQuwainFreeZoneTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.FUJAIRAH_DED) {
            return fujairahDedTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.FUJAIRAH_DIBBA_DED) {
            return fujairahDibbaDedTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.FUJAIRAH_MEDIA_ZONE_CREATIVE_CITY) {
            return fujairahMediaZoneCreativeCityTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.SHARJAH_AIRPORT_INTERNATIONAL_FREE_ZONE) {
            return sharjahAirportInternationalFreeZoneTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.SHARJAH_MEDIA_CITY_FREE_ZONE) {
            return sharjahMediaCityFreeZoneTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.SHARJAH_PUBLISHING_CITY) {
            return sharjahPublishingCityTradeLicenceExtractor.extract(ocrText);
        }
        if (resolved == TradeLicenceFormat.SHARJAH_RESEARCH_TECHNOLOGY_AND_INNOVATION_PARK) {
            return sharjahResearchTechnologyInnovationParkTradeLicenceExtractor.extract(ocrText);
        }
        log.debug("Using DET (generic) trade licence parser for format {}", resolved);
        return parseDet(ocrText);
    }

    private DocumentFieldsDto parseDet(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);

        if (ocrText == null || ocrText.isEmpty()) {
            log.warn("Trade licence (DET) parse skipped: OCR text is empty");
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");

        // ── License No. ───────────────────────────────────────────────────
        // Prefer standalone number line after "License No." label (not "Main License No")
        addIfNotEmpty(result, "licenseNo",      extractLicenseNo(normalized));

        // ── Company Name ──────────────────────────────────────────────────
        // Value is on same line: "Company Name ASIREALESTATE DEVELOPMENT LLC"
        addIfNotEmpty(result, "companyName",    extractSameLineSuffix(normalized, "company name"));
        addIfNotEmpty(result, "companyNameAr",  extractArabicRtlLabeledLine(normalized, "اسم الشركة", "اسم المنشأة"));

        // ── Business Name ─────────────────────────────────────────────────
        addIfNotEmpty(result, "businessName",   extractSameLineSuffix(normalized, "business name", "trade name"));
        addIfNotEmpty(result, "businessNameAr", extractArabicNextLine(normalized, "الإسم التجاري", "الاسم التجاري"));

        // ── Legal Type ────────────────────────────────────────────────────
        // Value is on the NEXT line after "Legal Type" (because OCR layout splits them)
        addIfNotEmpty(result, "legalType",      extractNextNonLabelLine(normalized, "legal type", "legal form"));
        addIfNotEmpty(result, "legalTypeAr",    extractArabicNextLine(normalized, "الشكل القانوني", "النوع القانوني"));

        // ── Dates ─────────────────────────────────────────────────────────
        addIfNotEmpty(result, "issueDate",      extractDateAfterLabel(normalized, "issue date", "issued on", "تاريخ الإصدار", "date\n26"));
        addIfNotEmpty(result, "expiryDate",     extractDateAfterLabel(normalized, "expiry date", "expiry", "تاريخ الانتهاء", "لتاريخ الانتهاء"));

        // ── Registration Numbers ──────────────────────────────────────────
        addIfNotEmpty(result, "dunbNumber",     extractDunsNumber(normalized));
        addIfNotEmpty(result, "registerNo",     extractNumberAfterLabel(normalized, "register no", "رقم السجل التجاري", "رقم السجل", "رقم القيد"));
        addIfNotEmpty(result, "dcciNo",         extractDociNo(normalized));
        addIfNotEmpty(result, "mainLicenseNo",  extractNumberAfterLabel(normalized, "main license no", "رقم الرخصة الأم"));

        // ── License Activities ────────────────────────────────────────────
        addIfNotEmpty(result, "licenseActivities", extractActivities(normalized));

        // ── Contact ───────────────────────────────────────────────────────
        addIfNotEmpty(result, "phoneNo",        extractContactAfterLabel(normalized, "phone no", "هاتف"));
        addIfNotEmpty(result, "faxNo",          extractContactAfterLabel(normalized, "fax no", "فاكس"));
        addIfNotEmpty(result, "mobileNo",       extractContactAfterLabel(normalized, "mobile no", "هاتف متحرك"));
        addIfNotEmpty(result, "email",          extractEmail(normalized));
        addIfNotEmpty(result, "poBox",          extractPoBox(normalized));
        addIfNotEmpty(result, "parcelId",       extractParcelId(normalized));
        extractAddressFields(normalized, result);
        extractRegisterSections(normalized, result);

        // ── Members / Partners ────────────────────────────────────────────
        String[] memberPartnerSplit = extractPartners(normalized);
        addIfNotEmpty(result, "licenseMembers",  memberPartnerSplit[0]);
        addIfNotEmpty(result, "licensePartners", memberPartnerSplit[1]);

        // ── Confidence ────────────────────────────────────────────────────
        int filled = (int) result.getFields().keySet().stream()
                .filter(k -> !k.endsWith("_confidence")).count();
        result.setOverallConfidence(BigDecimal.valueOf(Math.min(1.0, filled / 8.0)));

        log.debug("Trade Licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String extractByPattern(String text, Pattern pattern, int group) {
        Matcher m = pattern.matcher(text);
        if (m.find()) return m.group(group).trim();
        return "";
    }

    /** License No: find the standalone number after "License No." label (not "Main License No") */
    private String extractLicenseNo(String text) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            if (lo.contains("license no") && !lo.contains("main")) {
                // Value may be inline after the label
                String same = lines[i].replaceFirst("(?i).*licen[cs]e\\s*no\\.?\\s*", "").trim();
                if (same.matches("\\d{4,10}")) return same;
                // Scan ahead up to 10 lines — skip Arabic/header/section lines
                for (int j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                    String t = lines[j].trim();
                    if (t.matches("\\d{4,10}")) return t;
                    // Stop only if we hit another major English label section
                    if (t.matches("(?i)(company name|business name|legal type|expiry|issue date|partner|address|phone|print date).*")) break;
                }
            }
        }
        // Fallback: رقم الرخصة label
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains("رقم الرخصة") && !lines[i].contains("الأم")) {
                String same = lines[i].replaceFirst(".*رقم الرخصة\\s*", "").trim();
                if (same.matches("\\d{4,10}")) return same;
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    String t = lines[j].trim();
                    if (t.matches("\\d{4,10}")) return t;
                }
            }
        }
        return "";
    }

    /** Extract value after the label on the same line, with optional wrapped continuation on next line */
    private String extractSameLineSuffix(String text, String... labels) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        String[] lines = noArabic.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            for (String label : labels) {
                if (lo.startsWith(label.toLowerCase())) {
                    String val = lines[i].replaceFirst("(?i)" + Pattern.quote(label) + "\\s*:?\\s*", "").trim();
                    if (val.length() >= 2) {
                        // Append continuation line if it looks like a wrapped value
                        if (i + 1 < lines.length) {
                            String next = lines[i + 1].trim();
                            if (!next.isEmpty()
                                    && next.matches(".*[A-Za-z].*")
                                    && !next.toLowerCase().matches("(?i)(legal type|expiry|issue|register|d&b|phone|fax|mobile|email|address|partner|activity|print|license no|company|business|main).*")) {
                                val = val + " " + next;
                            }
                        }
                        return val;
                    }
                    // Label is standalone — value is on next line
                    if (i + 1 < lines.length) {
                        String next = lines[i + 1].trim();
                        if (next.length() >= 2
                                && !next.toLowerCase().matches("(?i)(legal type|expiry|issue|register|d&b|phone|fax|mobile|email|address|partner|print|license no|main).*")) {
                            return next;
                        }
                    }
                }
            }
        }
        return "";
    }

    /** Extract the next Arabic-only line that follows a given Arabic label line */
    private String extractArabicNextLine(String text, String... arabicLabels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            for (String label : arabicLabels) {
                // Line must START with the label (not be a value line that contains it)
                if (lines[i].trim().startsWith(label)) {
                    // Check same line for inline value after colon
                    if (lines[i].contains(":")) {
                        String val = lines[i].substring(lines[i].lastIndexOf(':') + 1).trim();
                        if (val.length() >= 2 && arabicTextProcessor.containsArabic(val)) {
                            return arabicTextProcessor.normalizeArabic(val);
                        }
                    }
                    // Next Arabic line
                    for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                        String next = lines[j].trim();
                        if (arabicTextProcessor.containsArabic(next) && !next.startsWith(label)) {
                            return arabicTextProcessor.normalizeArabic(next);
                        }
                    }
                }
            }
        }
        return "";
    }

    /** Existing Arabic labeled line extractor (used for company name AR) */
    private String extractArabicLabeledLine(String text, String... arabicLabels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            for (String label : arabicLabels) {
                if (lines[i].contains(label)) {
                    if (lines[i].contains(":")) {
                        String val = lines[i].substring(lines[i].lastIndexOf(':') + 1).trim();
                        if (val.length() >= 2 && arabicTextProcessor.containsArabic(val)) {
                            return arabicTextProcessor.normalizeArabic(val);
                        }
                    }
                    for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                        String next = lines[j].trim();
                        if (arabicTextProcessor.containsArabic(next)) {
                            return arabicTextProcessor.normalizeArabic(next);
                        }
                    }
                }
            }
        }
        return "";
    }

    /** Next non-empty line after label that doesn't look like another label */
    private String extractNextNonLabelLine(String text, String... labels) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        String[] lines = noArabic.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            for (String label : labels) {
                if (lo.equals(label.toLowerCase()) || lo.startsWith(label.toLowerCase() + " ") || lo.startsWith(label.toLowerCase() + ":")) {
                    for (int j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                        String t = lines[j].trim();
                        if (t.isEmpty()) continue;
                        // Skip lines that look like other labels or registration codes
                        if (t.matches("(?i)(expiry|register|d[-\\s]?u[-\\s]?n[-\\s]?s|dd-un-sn|dcci|doci|main|date|issue|license|print).*")) continue;
                        if (t.matches("[A-Z]{2,3}-[A-Z]{2,3}-[A-Z]{2,3}.*")) continue;
                        if (t.length() >= 3) return t;
                    }
                }
            }
        }
        return "";
    }

    private String extractDateAfterLabel(String text, String... labels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase();
            for (String label : labels) {
                if (lo.contains(label.toLowerCase())) {
                    Matcher m = DATE_PATTERN.matcher(lines[i]);
                    if (m.find()) return m.group();
                    for (int j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                        m = DATE_PATTERN.matcher(lines[j]);
                        if (m.find()) return m.group();
                    }
                }
            }
        }
        return "";
    }

    /** Extract numeric value after a label — scans ahead, skips non-digit lines, stops at next section label */
    private String extractNumberAfterLabel(String text, String... labels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase();
            for (String label : labels) {
                if (lo.contains(label.toLowerCase())) {
                    // Check same line after colon/space
                    String same = lines[i].replaceFirst("(?i).*" + Pattern.quote(label) + "\\s*\\.?\\s*", "").trim();
                    if (same.matches("\\d{4,15}")) return same;
                    // Scan ahead up to 8 lines, skip non-digit lines, stop at next section header
                    for (int j = i + 1; j < Math.min(i + 8, lines.length); j++) {
                        String t = lines[j].trim();
                        if (t.isEmpty()) continue;
                        if (t.matches("\\d{4,15}")) return t;
                        // Stop at the next clearly different section
                        if (t.matches("(?i)(license member|partner|address|phone|fax|mobile|email|activities|remarks|print date|يمكنك|now you).*")) break;
                    }
                }
            }
        }
        return "";
    }

    /** Extract phone/fax/mobile: same line or next line, strip non-digits except +/- */
    private String extractContactAfterLabel(String text, String... labels) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        String[] lines = noArabic.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            for (String label : labels) {
                if (lo.contains(label.toLowerCase())) {
                    // Value after colon on same line
                    if (lines[i].contains(":")) {
                        String val = lines[i].substring(lines[i].indexOf(':') + 1).trim();
                        if (val.matches("[+\\d][\\d\\s\\-]{4,20}")) return val;
                    }
                    // Same line suffix
                    String same = lines[i].replaceFirst("(?i)" + Pattern.quote(label) + "\\s*:?\\s*", "").trim();
                    if (same.matches("[+\\d][\\d\\s\\-]{4,20}")) return same;
                    // Next line
                    for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                        String t = lines[j].trim();
                        if (t.matches("[+\\d][\\d\\s\\-]{4,20}")) return t;
                        if (!t.isEmpty()) break;
                    }
                }
            }
        }
        return "";
    }

    /** Parcel ID: inline after label or in the next column block (Google OCR columnar layout). */
    private String extractParcelId(String text) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            String lo = line.toLowerCase();
            if (lo.startsWith("parcel id") || lo.startsWith("parcel no")) {
                String inline = line.replaceFirst("(?i)parcel\\s*(id|no)\\.?\\s*:?\\s*", "").trim();
                if (isParcelIdValue(inline)) {
                    return sanitizeParcelId(inline);
                }
                String scanned = scanParcelValue(lines, i + 1, Math.min(i + 18, lines.length));
                if (!scanned.isEmpty()) {
                    return sanitizeParcelId(scanned);
                }
            }
            if (line.equals("رقم القطعة")) {
                String scanned = scanParcelValue(lines, i + 1, Math.min(i + 18, lines.length));
                if (!scanned.isEmpty()) {
                    return sanitizeParcelId(scanned);
                }
            }
        }
        Matcher m = PARCEL_PATTERN.matcher(arabicTextProcessor.removeArabicText(text));
        if (m.find()) {
            String val = m.group(1).trim();
            if (isParcelIdValue(val)) {
                return val;
            }
        }
        return "";
    }

    private String sanitizeParcelId(String value) {
        if (value == null || value.isBlank() || !isParcelIdValue(value)) {
            return "";
        }
        return value;
    }

    private String scanParcelValue(String[] lines, int from, int to) {
        boolean inActivities = false;
        for (int i = from; i < to; i++) {
            String t = lines[i].trim();
            if (t.isEmpty()) {
                continue;
            }
            if (isLicenseActivitiesHeading(t)) {
                inActivities = true;
                continue;
            }
            if (isAddressSectionHeading(t)) {
                inActivities = false;
                continue;
            }
            if (inActivities || isAddressSectionLabel(t) || isLicenceFooterAnchor(t)) {
                continue;
            }
            if (isParcelIdValue(t)) {
                return t;
            }
        }
        return "";
    }

    private boolean isParcelIdValue(String value) {
        if (!value.matches(".*\\d.*")) {
            return false;
        }
        return value.matches("(?i)\\d{3,6}-\\d{3,6}")
                || value.matches("(?i)[A-Z0-9]{2,10}-\\d{2,6}");
    }

    /** Main licence address block on the first page. Register-page fields are handled separately. */
    private void extractAddressFields(String text, DocumentFieldsDto result) {
        String[] lines = text.split("\n");
        String address = extractMainLicenseAddress(lines);
        if (!address.isEmpty()) {
            addAddressFields(result, address);
        }
    }

    /** Register page sections: details, capital, addresses, activities, and receipt. */
    private void extractRegisterSections(String text, DocumentFieldsDto result) {
        String[] lines = text.split("\n");
        addIfNotEmpty(result, "registerDetails", extractRegisterDetailsBlock(lines));
        addIfNotEmpty(result, "capitalDetails", extractCapitalDetailsBlock(lines));
        extractRegisterAddresses(lines, result);
        addIfNotEmpty(result, "registerActivities", extractRegisterActivitiesBlock(lines));
        addIfNotEmpty(result, "receipt", extractReceiptBlock(lines));
    }

    private String extractRegisterDetailsBlock(String[] lines) {
        int start = findSectionHeading(lines, "register details", "تفاصيل القيد");
        if (start < 0) {
            return "";
        }
        int end = findSectionHeading(lines, start + 1, "capital details", "تفاصيل راس المال");
        if (end < 0) {
            end = Math.min(start + 40, lines.length);
        }

        Map<String, String> details = new LinkedHashMap<>();
        putIfNotBlank(details, "registerNo",
                findValueAfterLabel(lines, start, end, "رقم القيد", this::isPlainNumber));
        putIfNotBlank(details, "mainLicenseNo",
                findValueAfterLabel(lines, start, end, "main lice", "main license", this::isPlainNumber));
        putIfNotBlank(details, "businessNameEn",
                findValueAfterLabel(lines, start, end, "business name", this::isEnglishBusinessValue));
        putIfNotBlank(details, "businessNameAr",
                findValueAfterLabel(lines, start, end, "الاسم التجاري", this::isArabicBusinessValue));
        putIfNotBlank(details, "legalTypeEn",
                findValueAfterLabel(lines, start, end, "legal type", this::isEnglishBusinessValue));
        putIfNotBlank(details, "legalTypeAr",
                findValueAfterLabel(lines, start, end, "الشكل القانوني", this::isArabicBusinessValue));
        putIfNotBlank(details, "issueDate",
                findValueAfterLabel(lines, start, end, "تاريخ الإصدار", this::isDateValue));
        putIfNotBlank(details, "expiryDate",
                findValueAfterLabel(lines, start, end, "expiry date", this::isDateValue));
        putIfNotBlank(details, "dunsNumber",
                findValueAfterLabel(lines, start, end, "d-u-n-s", "d&b", this::isDunsValue));
        return buildSimpleJson(details);
    }

    private String extractCapitalDetailsBlock(String[] lines) {
        int start = findSectionHeading(lines, "capital details", "تفاصيل راس المال");
        if (start < 0) {
            return "";
        }
        int end = findSectionHeading(lines, start + 1,
                "license address", "عنوان الرخصة", "commerce address", "عنوان السجل");
        if (end < 0) {
            end = Math.min(start + 18, lines.length);
        }

        List<String> numericValues = collectCapitalNumerics(lines, start, end);
        String currencyAr = "";
        String currencyEn = "";
        for (int i = Math.max(0, start - 15); i < end; i++) {
            String t = lines[i].trim();
            if (t.toLowerCase().contains("dirham") || t.contains("درهم")) {
                if (arabicTextProcessor.containsArabic(t)) {
                    currencyAr = arabicTextProcessor.normalizeArabic(t);
                } else {
                    currencyEn = t;
                }
            }
        }

        Map<String, String> capital = new LinkedHashMap<>();
        assignCapitalAmounts(capital, numericValues);
        putIfNotBlank(capital, "currencyAr", currencyAr);
        putIfNotBlank(capital, "currencyEn", currencyEn);
        return buildSimpleJson(capital);
    }

    private List<String> collectCapitalNumerics(String[] lines, int start, int end) {
        List<String> postValues = new ArrayList<>();
        List<String> preValues = new ArrayList<>();
        for (int i = Math.max(0, start - 12); i < start; i++) {
            collectCapitalNumeric(lines[i].trim(), preValues);
        }
        for (int i = start + 1; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isCapitalLabel(t)) {
                continue;
            }
            collectCapitalNumeric(t, postValues);
        }
        return postValues.isEmpty() ? preValues : postValues;
    }

    private void assignCapitalAmounts(Map<String, String> capital, List<String> values) {
        if (values.isEmpty()) {
            return;
        }
        for (String value : values) {
            if (capital.containsKey("nominated")) {
                break;
            }
            if (value.contains(",") || value.matches("\\d{4,}")) {
                capital.put("nominated", value);
            }
        }
        for (String value : values) {
            if (value.equals(capital.get("nominated"))) {
                continue;
            }
            if (!capital.containsKey("paid")
                    && (value.equals("-1") || value.equals("0") || value.equals("0.00") || value.matches("\\d+[.]\\d{2}"))) {
                capital.put("paid", value);
            }
        }
        for (String value : values) {
            if (value.equals(capital.get("nominated")) || value.equals(capital.get("paid"))) {
                continue;
            }
            if (!capital.containsKey("shares") && value.matches("\\d+")) {
                capital.put("shares", value);
            }
        }
        if (!capital.containsKey("nominated") && !values.isEmpty()) {
            capital.put("nominated", values.get(0));
        }
    }

    private String extractRegisterActivitiesBlock(String[] lines) {
        int start = findSectionHeading(lines, "register activities", "أنشطة السجل");
        if (start < 0) {
            return "";
        }

        List<String> arActivities = new ArrayList<>();
        for (int i = start + 1; i < Math.min(start + 25, lines.length); i++) {
            String t = lines[i].trim();
            if (t.contains("Dear Merchants") || t.contains("عزيزي التاجر")) {
                break;
            }
            if (i > start + 3 && (t.contains("GOVERNMENT OF DUBAI") || t.contains("حكومة دبي"))) {
                break;
            }
            if (t.isEmpty() || isRegisterActivitiesNoise(t) || isLicenceFooterAnchor(t)
                    || t.toLowerCase().contains("zoho")) {
                continue;
            }
            if (looksLikeArabicActivityPhrase(t)) {
                arActivities.add(arabicTextProcessor.normalizeArabic(
                        arabicTextProcessor.extractArabicText(t)));
            }
        }
        return buildActivitiesJson(List.of(), arActivities, List.of());
    }

    private String extractReceiptBlock(String[] lines) {
        int start = findReceiptSectionStart(lines);
        if (start < 0) {
            return "";
        }
        int end = Math.min(start + 45, lines.length);
        for (int i = start + 5; i < end; i++) {
            if (lines[i].contains("GOVERNMENT OF DUBAI") || lines[i].contains("حكومة دبي")) {
                end = i;
                break;
            }
        }

        Map<String, String> receipt = new LinkedHashMap<>();
        putIfNotBlank(receipt, "receiptNo",
                findValueAfterLabel(lines, start, end, "رقم الإيصال", this::isReceiptNumber));
        if (!receipt.containsKey("receiptNo")) {
            putIfNotBlank(receipt, "receiptNo",
                    scanNextInRange(lines, start + 1, Math.min(start + 8, end), this::isReceiptNumber));
        }
        putIfNotBlank(receipt, "receiptDate",
                findValueAfterLabel(lines, start, end, "receipt date", "تاريخ الإيصال", this::isDateValue));
        if (!receipt.containsKey("receiptDate")) {
            putIfNotBlank(receipt, "receiptDate", scanNextInRange(lines, start, end, this::isDateValue));
        }
        putIfNotBlank(receipt, "businessNameAr",
                findValueAfterLabel(lines, start, end, "اسم الشخص", this::isArabicBusinessValue));
        putIfNotBlank(receipt, "businessNameEn",
                findValueAfterLabel(lines, start, end, "business name", this::isEnglishBusinessValue));
        putIfNotBlank(receipt, "procedure",
                findValueAfterLabel(lines, start, end, "procedure", "نوع الاجراء", this::isProcedureValue));
        putIfNotBlank(receipt, "paymentVoucherNo",
                findValueAfterLabel(lines, start, end, "p.v.nr", "p.v. nr", this::isPlainNumber));
        putIfNotBlank(receipt, "licenseNo",
                findValueAfterLabel(lines, start, end, "license nr", "رقم إذن الدفع", this::isPlainNumber));
        putIfNotBlank(receipt, "paymentMode",
                findValueAfterLabel(lines, start, end, "payment mode", "كيفية الدفع", this::isPaymentModeValue));

        String amountAr = scanAmountInWords(lines, start, end, true);
        String amountEn = scanAmountInWords(lines, start, end, false);
        putIfNotBlank(receipt, "amountInWordsAr", amountAr);
        putIfNotBlank(receipt, "amountInWordsEn", amountEn);
        return buildSimpleJson(receipt);
    }

    private int findSectionHeading(String[] lines, String... markers) {
        return findSectionHeading(lines, 0, markers);
    }

    private int findSectionHeading(String[] lines, int from, String... markers) {
        for (int i = from; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            String ar = arabicTextProcessor.normalizeArabic(lines[i].trim());
            for (String marker : markers) {
                String markerLo = marker.toLowerCase();
                String markerAr = arabicTextProcessor.normalizeArabic(marker);
                if (lo.contains(markerLo) || ar.contains(markerAr)) {
                    return i;
                }
            }
        }
        return -1;
    }

    private int findReceiptSectionStart(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            String lo = t.toLowerCase();
            if (t.contains("الرصيد") && lo.contains("receipt") && !lo.startsWith("receipt no")) {
                return i;
            }
        }
        return -1;
    }

    private String findValueAfterLabel(
            String[] lines, int from, int to, String label, Predicate<String> accept) {
        return findValueAfterLabel(lines, from, to, new String[] {label}, accept);
    }

    private String findValueAfterLabel(
            String[] lines, int from, int to, String label1, String label2, Predicate<String> accept) {
        return findValueAfterLabel(lines, from, to, new String[] {label1, label2}, accept);
    }

    private String findValueAfterLabel(
            String[] lines, int from, int to, String[] labels, Predicate<String> accept) {
        for (int i = from; i < to; i++) {
            if (!lineMatchesLabel(lines[i].trim(), labels)) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 5, to); j++) {
                String value = lines[j].trim();
                if (value.isEmpty() || lineMatchesLabel(value, REGISTER_DETAIL_LABELS)) {
                    continue;
                }
                if (accept.test(value)) {
                    return normalizeFieldValue(value, accept);
                }
            }
        }
        return "";
    }

    private String scanNextInRange(String[] lines, int from, int to, Predicate<String> accept) {
        for (int i = from; i < to; i++) {
            String value = lines[i].trim();
            if (value.isEmpty()) {
                continue;
            }
            if (accept.test(value)) {
                return normalizeFieldValue(value, accept);
            }
        }
        return "";
    }

    private String scanAmountInWords(String[] lines, int from, int to, boolean arabic) {
        for (int i = from; i < to; i++) {
            String t = lines[i].trim();
            if (t.isEmpty()) {
                continue;
            }
            boolean hasArabic = arabicTextProcessor.containsArabic(t);
            if (arabic && hasArabic && (t.contains("درهم") || t.contains("درهما"))) {
                return arabicTextProcessor.normalizeArabic(t);
            }
            if (!arabic && !hasArabic && t.toLowerCase().contains("dirham")) {
                return t;
            }
        }
        return "";
    }

    private void collectCapitalNumeric(String line, List<String> numericValues) {
        if (line.matches("[\\d,\\.\\-]+") && !line.matches("\\d{2}/\\d{2}/\\d{4}")) {
            numericValues.add(line);
        }
    }

    private boolean lineMatchesLabel(String line, String... labels) {
        String lo = line.toLowerCase().trim();
        String ar = arabicTextProcessor.normalizeArabic(line.trim());
        for (String label : labels) {
            String labelLo = label.toLowerCase();
            String labelAr = arabicTextProcessor.normalizeArabic(label);
            if (lo.equals(labelLo) || lo.startsWith(labelLo + " ") || lo.contains(labelLo)
                    || ar.equals(labelAr) || ar.startsWith(labelAr) || ar.contains(labelAr)) {
                return true;
            }
        }
        return false;
    }

    private static final String[] REGISTER_DETAIL_LABELS = {
            "رقم القيد", "main lice", "main license", "business name", "legal type", "expiry date",
            "الاسم التجاري", "الشكل القانوني", "تاريخ الإصدار", "d-u-n-s", "d&b", "register no",
            "reg. date", "nominated", "paid", "no. of shares", "currency", "receipt date",
            "procedure", "payment mode", "p.v.nr", "license nr", "اسم الشخص", "رقم الإيصال"
    };

    private boolean isCapitalLabel(String line) {
        return lineMatchesLabel(line, "الإسمى", "المدفوع", "عدد الأسهم", "العملة",
                "nominated", "paid", "no. of shares", "currency");
    }

    private boolean isRegisterActivitiesNoise(String line) {
        String lo = line.toLowerCase().trim();
        String ar = arabicTextProcessor.normalizeArabic(line);
        return lo.startsWith("receipt no")
                || lo.contains("print date")
                || line.contains("تاريخ الطباعة")
                || isLicenceFooterAnchor(line)
                || ar.contains("للسنة")
                || ar.contains("زوهو")
                || ar.contains("اولى")
                || lineMatchesLabel(line, "register activities", "أنشطة السجل");
    }

    private boolean isPlainNumber(String value) {
        return value.matches("\\d{4,12}");
    }

    private boolean isReceiptNumber(String value) {
        return value.matches("\\d{6,12}");
    }

    private boolean isDateValue(String value) {
        return DATE_PATTERN.matcher(value).find();
    }

    private boolean isDunsValue(String value) {
        return value.matches("\\d{2}-\\d{3}-\\d{4}") || value.matches("\\d{9,12}");
    }

    private boolean isEnglishBusinessValue(String value) {
        String lo = value.toLowerCase();
        return value.length() >= 3
                && !arabicTextProcessor.containsArabic(value)
                && !lo.matches("(?i)(receipt date|business name|procedure|payment mode|license nr|print date).*")
                && !isDateValue(value)
                && !isPlainNumber(value);
    }

    private boolean isArabicBusinessValue(String value) {
        return arabicTextProcessor.containsArabic(value)
                && value.length() >= 4
                && !isRegisterActivitiesNoise(value);
    }

    private boolean isProcedureValue(String value) {
        return value.length() >= 4
                && !isDateValue(value)
                && !isPlainNumber(value)
                && !lineMatchesLabel(value, "procedure", "نوع الاجراء");
    }

    private boolean isPaymentModeValue(String value) {
        return value.length() >= 4
                && !isDateValue(value)
                && !lineMatchesLabel(value, "payment mode", "كيفية الدفع");
    }

    private String normalizeFieldValue(String value, Predicate<String> accept) {
        if (isDateValue(value)) {
            Matcher m = DATE_PATTERN.matcher(value);
            return m.find() ? m.group() : value;
        }
        if (arabicTextProcessor.containsArabic(value)) {
            return arabicTextProcessor.normalizeArabic(value);
        }
        return value.trim();
    }

    private void putIfNotBlank(Map<String, String> map, String key, String value) {
        if (value != null && !value.isBlank()) {
            map.put(key, value);
        }
    }

    private String buildSimpleJson(Map<String, String> fields) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> entry : fields.entrySet()) {
            if (entry.getValue() == null || entry.getValue().isBlank()) {
                continue;
            }
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('"').append(entry.getKey()).append("\":\"")
                    .append(entry.getValue().replace("\\", "\\\\").replace("\"", "'"))
                    .append('"');
        }
        sb.append('}');
        return first ? "" : sb.toString();
    }

    private String extractMainLicenseAddress(String[] lines) {
        int scanLimit = findSectionHeading(lines, "register details", "تفاصيل القيد", "commercial register");
        if (scanLimit < 0) {
            scanLimit = findSectionHeading(lines, "capital details", "تفاصيل راس المال");
        }
        if (scanLimit < 0) {
            scanLimit = lines.length;
        }

        for (int i = 0; i < scanLimit; i++) {
            if (isMainAddressSectionHeading(lines[i].trim())) {
                String address = scanAddressValue(lines, i + 1, Math.min(i + 15, scanLimit));
                if (!address.isEmpty()) {
                    return address;
                }
            }
        }
        return "";
    }

    private String scanAddressValue(String[] lines, int from, int to) {
        String best = "";
        int bestScore = -1;
        boolean inActivities = false;
        for (int i = from; i < to; i++) {
            String t = lines[i].trim();
            if (t.isEmpty()) {
                continue;
            }
            if (isLicenseActivitiesHeading(t)) {
                inActivities = true;
                continue;
            }
            if (isMainAddressSectionHeading(t)) {
                inActivities = false;
                continue;
            }
            if (inActivities || isAddressSectionLabel(t)) {
                continue;
            }
            if (isLicenceFooterAnchor(t) || t.toLowerCase().startsWith("remarks")
                    || isRegisterSectionHeading(t)) {
                break;
            }
            if (EMAIL_PATTERN.matcher(t).find() || t.matches("\\d{3,10}") || isParcelIdValue(t)) {
                continue;
            }
            int score = scoreAddressCandidate(t);
            if (score >= 0 && score > bestScore) {
                bestScore = score;
                best = t;
            }
        }
        return best;
    }

    private int scoreAddressCandidate(String line) {
        if (line.contains("Register Activities") || line.contains("أنشطة السجل")
                || line.contains("Register Details") || line.contains("Capital Details")) {
            return -1;
        }
        if (DATE_PATTERN.matcher(line).find() && !line.contains("مكتب") && !line.contains("office")) {
            return -1;
        }
        int score = 0;
        if (line.contains("مكتب") || line.contains("ملك") || line.contains("القوز")
                || line.contains("صناع") || line.toLowerCase().contains("office")) {
            score += 20;
        }
        if (arabicTextProcessor.containsArabic(line)) {
            score += 10;
        }
        if (line.contains("/")) {
            score += 2;
        }
        return score > 0 ? score + Math.min(line.length(), 40) : -1;
    }

    private boolean isMainAddressSectionHeading(String line) {
        String t = line.trim();
        String lo = t.toLowerCase();
        return lo.equals("address / العنوان") || t.equals("العنوان / Address")
                || lo.matches("(?i)^address\\s*/\\s*العنوان\\s*$");
    }

    private boolean isRegisterSectionHeading(String line) {
        String lo = line.toLowerCase();
        return lo.contains("register activities") || lo.contains("register details")
                || lo.contains("capital details") || lo.contains("license address")
                || lo.contains("commerce address") || line.contains("أنشطة السجل")
                || line.contains("تفاصيل القيد") || line.contains("تفاصيل راس المال")
                || line.contains("عنوان الرخصة") || line.contains("عنوان السجل");
    }

    private void extractRegisterAddresses(String[] lines, DocumentFieldsDto result) {
        int capStart = findSectionHeading(lines, "capital details", "تفاصيل راس المال");
        if (capStart < 0) {
            return;
        }
        int end = findSectionHeading(lines, capStart + 1, "register activities", "أنشطة السجل");
        if (end < 0) {
            end = Math.min(capStart + 20, lines.length);
        }

        for (int i = capStart; i < end; i++) {
            String t = lines[i].trim();
            if (t.contains("License Address") || t.contains("عنوان الرخصة")) {
                addIfNotEmpty(result, "licenseAddress", readNextRegisterAddress(lines, i + 1, end));
            }
            if (t.contains("Commerce Address") || t.contains("عنوان السجل التجاري")) {
                addIfNotEmpty(result, "commerceAddress", readNextRegisterAddress(lines, i + 1, end));
            }
        }
    }

    private String readNextRegisterAddress(String[] lines, int from, int to) {
        for (int i = from; i < Math.min(from + 6, to); i++) {
            String t = lines[i].trim();
            if (t.isEmpty()) {
                continue;
            }
            if (t.contains("License Address") || t.contains("Commerce Address")
                    || t.contains("عنوان الرخصة") || t.contains("عنوان السجل التجاري")
                    || t.contains("Register Activities") || t.contains("أنشطة السجل")
                    || t.toLowerCase().startsWith("receipt no")) {
                continue;
            }
            if (isRegisterAddressLine(t) || looksLikeAddressValue(t)) {
                return t;
            }
        }
        return "";
    }

    private boolean isRegisterAddressLine(String line) {
        if (line.length() < 12 || isRegisterSectionHeading(line)) {
            return false;
        }
        return arabicTextProcessor.containsArabic(line)
                && (line.contains("مكتب") || line.contains("ملك") || line.contains("القوز")
                || line.contains("صناع") || line.contains("شارع"));
    }

    private void addAddressFields(DocumentFieldsDto result, String raw) {
        String trimmed = raw.trim();
        addIfNotEmpty(result, "address", trimmed);
        if (!trimmed.contains("/")) {
            if (arabicTextProcessor.containsArabic(trimmed)) {
                addIfNotEmpty(result, "addressAr", arabicTextProcessor.normalizeArabic(trimmed));
            } else {
                addIfNotEmpty(result, "addressEn", trimmed);
            }
            return;
        }
        String[] parts = trimmed.split("\\s*/\\s*", 2);
        if (parts.length != 2) {
            return;
        }
        String left = parts[0].trim();
        String right = parts[1].trim();
        boolean leftAr = arabicTextProcessor.containsArabic(left);
        boolean rightAr = arabicTextProcessor.containsArabic(right);
        if (leftAr && !rightAr) {
            addIfNotEmpty(result, "addressAr", arabicTextProcessor.normalizeArabic(left));
            addIfNotEmpty(result, "addressEn", right);
        } else if (!leftAr && rightAr) {
            addIfNotEmpty(result, "addressEn", left);
            addIfNotEmpty(result, "addressAr", arabicTextProcessor.normalizeArabic(right));
        } else if (leftAr) {
            addIfNotEmpty(result, "addressAr", arabicTextProcessor.normalizeArabic(trimmed));
        } else {
            addIfNotEmpty(result, "addressEn", trimmed);
        }
    }

    private boolean isAddressSectionHeading(String line) {
        String t = line.trim();
        String lo = t.toLowerCase();
        return lo.matches("(?i).*address\\s*/\\s*العنوان.*")
                || t.matches(".*العنوان\\s*/\\s*address.*")
                || lo.equals("address / العنوان")
                || t.equals("العنوان / Address");
    }

    private boolean isAddressSectionLabel(String line) {
        String t = line.trim();
        String lo = t.toLowerCase();
        return lo.equals("p.o. box") || lo.equals("po box") || lo.matches("(?i)p\\.?o\\.?\\s*box")
                || lo.equals("parcel id") || lo.equals("parcel no") || lo.equals("email")
                || isAddressSectionHeading(t)
                || t.equals("صندوق بريد") || t.equals("رقم القطعة")
                || t.equals("البريد الإلكتروني") || lo.contains("email /") || lo.contains("/ email");
    }

    private boolean isLicenseActivitiesHeading(String line) {
        String lo = line.toLowerCase().trim();
        return lo.contains("license activities") || line.contains("نشاط الرخصة");
    }

    private boolean looksLikeAddressValue(String line) {
        if (line.length() < 10) {
            return false;
        }
        if (isLicenceFooterAnchor(line) || isActivityHardStop(line) || isActivityContactLabel(line)) {
            return false;
        }
        if (arabicTextProcessor.containsArabic(line)) {
            String ar = arabicTextProcessor.normalizeArabic(line);
            if (ar.matches("^(صندوق|رقم|البريد|تليفون|فاكس|هاتف|العنوان|الملاحظات|نشاط|فعال).*")) {
                return false;
            }
            return ar.contains("مكتب") || ar.contains("القوز") || ar.contains("دبي")
                    || ar.contains("ملك") || ar.contains("شارع") || ar.contains("منطقة")
                    || ar.contains("صناع") || ar.contains("بريد") || line.contains("/");
        }
        return line.matches("(?i).*(office|building|street|road|dubai|plot|warehouse|industrial).*");
    }

    private String extractEmail(String text) {
        Matcher m = EMAIL_PATTERN.matcher(text);
        if (m.find()) return m.group().trim();
        return "";
    }

    /** P.O. Box: value may be inline or on the next line after the label */
    private String extractPoBox(String text) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        String[] lines = noArabic.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            if (lo.startsWith("p.o. box") || lo.startsWith("p.o.box") || lo.startsWith("po box")) {
                // Inline: "P.O. Box 1457 - Dubai"
                Matcher m = Pattern.compile("(\\d{3,10})").matcher(lines[i]);
                if (m.find()) return m.group(1);
                // Scan next several lines for a standalone number (labels and values may be interleaved)
                for (int j = i + 1; j < Math.min(i + 8, lines.length); j++) {
                    String t = lines[j].trim();
                    if (t.isEmpty()) continue;
                    if (t.matches("\\d{3,10}")) return t;
                    // Stop only at real section breaks
                    if (t.toLowerCase().matches("(?i)(receipt no|print date|phone no|fax no|mobile no|remarks|يمكنك|now you).*")) break;
                }
            }
        }
        // Fallback: inline anywhere e.g. "P.O. Box 1457 - Dubai, U.A.E."
        Matcher m = POBOX_PATTERN.matcher(noArabic);
        if (m.find()) return m.group(1);
        return "";
    }

    /**
     * Extract license activities as a JSON array:
     * [{"en":"...","ar":"...","status":"Active"}, ...]
     *
     * Supports single-activity licences, multi-row Activity/Status tables, and Arabic lists.
     * Ignores Dubai Chamber certificate pages and register-only sections.
     */
    private String extractActivities(String text) {
        String[] lines = text.split("\n");
        int scanLimit = findActivitiesScanLimit(lines);
        boolean singleLicence = isSingleActivityLicence(lines, scanLimit);

        List<String> enActivities = new ArrayList<>();
        List<String> enStatuses = new ArrayList<>();
        List<String> arActivities = new ArrayList<>();

        extractSingleCommercialActivity(lines, scanLimit, enActivities, arActivities);
        if (!singleLicence && enActivities.isEmpty()) {
            extractMultiActivityTable(lines, scanLimit, enActivities, enStatuses);
        }
        if (!singleLicence && enActivities.isEmpty()) {
            extractActivityWithoutStatusColumn(lines, scanLimit, enActivities);
        }
        if (enActivities.isEmpty()) {
            extractEnglishActivitySuffixLine(lines, lines.length, enActivities);
        }
        if (enActivities.isEmpty()) {
            findEnglishActivityForSingleLicence(lines, enActivities);
        }
        if (enActivities.isEmpty()) {
            findBestStructuralActivityCandidate(lines, scanLimit, enActivities);
        }
        if (!singleLicence && arActivities.isEmpty()) {
            extractArabicLicenseActivities(lines, scanLimit, arActivities);
        }
        if (arActivities.isEmpty() && enActivities.size() == 1) {
            extractRegisterActivityArabic(lines, arActivities);
        }
        if (arActivities.isEmpty() && enActivities.size() == 1) {
            extractArabicFromActivityTypeHeading(lines, arActivities);
        }

        enActivities.removeIf(this::isActivityNoiseLine);
        if (singleLicence) {
            normalizeSingleLicenceActivities(enActivities, arActivities, enStatuses);
        }
        return buildActivitiesJson(enActivities, arActivities, enStatuses);
    }

    private boolean isSingleActivityLicence(String[] lines, int scanLimit) {
        for (int i = 0; i < scanLimit; i++) {
            if (isSingleLicenseActivityHeading(lines[i].trim())) {
                return true;
            }
        }
        return false;
    }

    private void normalizeSingleLicenceActivities(
            List<String> enActivities, List<String> arActivities, List<String> enStatuses) {
        if (enActivities.size() <= 1 && arActivities.size() <= 1) {
            return;
        }
        String bestEn = enActivities.stream()
                .filter(s -> !s.isBlank() && looksLikeActivityPhrase(s))
                .findFirst()
                .orElse(enActivities.stream().filter(s -> !s.isBlank()).findFirst().orElse(""));
        String bestAr = arActivities.stream()
                .filter(this::looksLikeArabicActivityPhrase)
                .findFirst()
                .orElse("");
        String status = enStatuses.isEmpty() ? "" : enStatuses.get(0);
        enActivities.clear();
        arActivities.clear();
        enStatuses.clear();
        if (!bestEn.isEmpty() || !bestAr.isEmpty()) {
            enActivities.add(bestEn);
            arActivities.add(bestAr);
            enStatuses.add(status);
        }
    }

    private void extractSingleCommercialActivity(
            String[] lines, int scanLimit,
            List<String> enActivities, List<String> arActivities) {
        for (int i = 0; i < scanLimit; i++) {
            String line = lines[i].trim();
            if (!isSingleLicenseActivityHeading(line)) {
                continue;
            }
            int end = Math.min(i + 25, scanLimit);
            for (int j = i + 1; j < end; j++) {
                String t = lines[j].trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (isActivityHardStop(t)) {
                    break;
                }
                if (isActivityContactLabel(t)) {
                    continue;
                }
                String enPart = normalizeActivityEnglish(t);
                if (looksLikeActivityPhrase(enPart) && enActivities.isEmpty()) {
                    enActivities.add(enPart);
                }
                if (looksLikeArabicActivityPhrase(t) && arActivities.isEmpty()) {
                    arActivities.add(arabicTextProcessor.normalizeArabic(
                            arabicTextProcessor.extractArabicText(t)));
                }
                if (!enActivities.isEmpty()) {
                    break;
                }
            }
            if (!enActivities.isEmpty()) {
                break;
            }
        }
    }

    private void extractActivityWithoutStatusColumn(
            String[] lines, int scanLimit, List<String> enActivities) {
        for (int i = 0; i < scanLimit; i++) {
            String lo = lines[i].toLowerCase().trim();
            if (!lo.equals("activity")) {
                continue;
            }
            if (nextNonEmptyLineEquals(lines, i + 1, scanLimit, "status")) {
                continue;
            }
            for (int j = i + 1; j < scanLimit; j++) {
                String t = lines[j].trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (isActivityHardStop(t)) {
                    break;
                }
                if (isActivityContactLabel(t)) {
                    continue;
                }
                String enOnly = normalizeActivityEnglish(t);
                if (looksLikeActivityPhrase(enOnly)) {
                    enActivities.add(enOnly);
                    return;
                }
            }
        }
    }

    private void extractEnglishActivitySuffixLine(String[] lines, int searchLimit, List<String> enActivities) {
        int excludeFrom = findChamberMembershipActivityListStart(lines);
        for (int i = 0; i < searchLimit; i++) {
            if (excludeFrom >= 0 && i >= excludeFrom) {
                break;
            }
            if (isInPageFooterBlock(lines, i)) {
                continue;
            }
            String raw = lines[i].trim();
            if (!ACTIVITY_SUFFIX_LINE.matcher(raw).matches()) {
                continue;
            }
            String enPart = normalizeActivityEnglish(raw);
            if (looksLikeActivityPhrase(enPart)) {
                enActivities.add(enPart);
                return;
            }
        }
    }

    /**
     * Picks the best English activity candidate between the licence-activity heading and the
     * page footer (Print Date / Receipt / SMS renewal block) using phrase shape and proximity.
     */
    private void findBestStructuralActivityCandidate(String[] lines, int scanLimit, List<String> enActivities) {
        int headingIdx = -1;
        for (int i = 0; i < scanLimit; i++) {
            if (isSingleLicenseActivityHeading(lines[i].trim())) {
                headingIdx = i;
                break;
            }
        }
        if (headingIdx < 0) {
            return;
        }

        int footerStart = findPageFooterStart(lines, headingIdx);
        int searchEnd = footerStart >= 0 ? footerStart : Math.min(headingIdx + 25, scanLimit);

        String best = null;
        int bestScore = Integer.MIN_VALUE;
        for (int i = headingIdx + 1; i < searchEnd; i++) {
            if (isActivityContactLabel(lines[i]) || isInPageFooterBlock(lines, i)) {
                continue;
            }
            String enPart = normalizeActivityEnglish(lines[i].trim());
            if (!looksLikeActivityPhrase(enPart)) {
                continue;
            }
            int score = scoreStructuralActivityCandidate(enPart, i - headingIdx);
            if (score > bestScore) {
                bestScore = score;
                best = enPart;
            }
        }
        if (best != null) {
            enActivities.add(best);
        }
    }

    private int findChamberMembershipActivityListStart(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase();
            if (!lo.contains("membership certificate") && !lines[i].contains("شهادة تسجيل العضوية")) {
                continue;
            }
            for (int j = i + 1; j < lines.length; j++) {
                if (lines[j].trim().equalsIgnoreCase("Activity")
                        && !nextNonEmptyLineEquals(lines, j + 1, lines.length, "status")
                        && isChamberMultiActivityList(lines, j)) {
                    return j;
                }
            }
        }
        return -1;
    }

    private boolean isChamberMultiActivityList(String[] lines, int activityIdx) {
        int activityLines = 0;
        for (int k = activityIdx + 1; k < Math.min(activityIdx + 20, lines.length); k++) {
            String t = lines[k].trim();
            if (t.isEmpty()) {
                continue;
            }
            if (t.toLowerCase().contains("member since")) {
                break;
            }
            String en = normalizeActivityEnglish(t);
            if (looksLikeActivityTableEntry(en)) {
                activityLines++;
            }
        }
        return activityLines > 1;
    }

    private boolean isActivityContactLabel(String line) {
        String tlo = line.toLowerCase().trim();
        return tlo.matches("(?i)(phone no|mobile no|fax no|email|address|p\\.o\\. box|tel|mobile|phone|fax)")
                || tlo.equals("تليفون")
                || tlo.equals("هاتف متحرك")
                || line.trim().equals("البريد اللكتروني")
                || line.trim().equals("العنوان")
                || line.trim().equals("الملحظات");
    }

    private boolean isActivityHardStop(String line) {
        if (isLicenceFooterAnchor(line) || isNonActivityProse(line)) {
            return true;
        }
        String tlo = line.toLowerCase();
        return tlo.contains("commercial register")
                || line.contains("شهادة شهر قيد")
                || line.contains("ملحق الشركاء")
                || tlo.contains("member since")
                || tlo.contains("membership certificate")
                || line.contains("شهادة تسجيل العضوية");
    }

    private boolean isLicenceFooterAnchor(String line) {
        String lo = line.toLowerCase().trim();
        String ar = line.trim();
        return ar.contains("يمكنك") || lo.startsWith("now you can")
                || lo.contains("get free") || lo.contains("certified e-document")
                || lo.contains("certified e document")
                || lo.contains("verify the certificate");
    }

    private int findPageStart(String[] lines, int idx) {
        for (int i = idx; i >= 0; i--) {
            if (lines[i].matches("(?i).*===\\s*page\\s*\\d+\\s*===.*")
                    || lines[i].contains("GOVERNMENT OF DUBAI")
                    || lines[i].contains("حكومة دبي")) {
                return i;
            }
        }
        return 0;
    }

    private int findPageEnd(String[] lines, int from) {
        for (int i = from + 1; i < lines.length; i++) {
            if (lines[i].matches("(?i).*===\\s*page\\s*\\d+\\s*===.*")
                    || lines[i].contains("GOVERNMENT OF DUBAI")
                    || lines[i].contains("حكومة دبي")) {
                return i;
            }
        }
        return lines.length;
    }

    private int findPageFooterStart(String[] lines, int idx) {
        int pageStart = findPageStart(lines, idx);
        for (int i = pageStart; i <= idx; i++) {
            if (isLicenceFooterAnchor(lines[i])) {
                return i;
            }
        }
        for (int i = idx + 1; i < findPageEnd(lines, idx); i++) {
            if (isLicenceFooterAnchor(lines[i])) {
                return i;
            }
        }
        return -1;
    }

    private boolean isInPageFooterBlock(String[] lines, int idx) {
        int pageStart = findPageStart(lines, idx);
        int pageEnd = findPageEnd(lines, idx);
        int footerStart = -1;
        for (int i = pageStart; i < pageEnd; i++) {
            if (isLicenceFooterAnchor(lines[i])) {
                footerStart = i;
                break;
            }
        }
        return footerStart >= 0 && idx >= footerStart && idx < pageEnd;
    }

    private void findEnglishActivityForSingleLicence(String[] lines, List<String> enActivities) {
        int chamberMultiList = findChamberMembershipActivityListStart(lines);

        for (int i = 0; i < lines.length; i++) {
            if (chamberMultiList >= 0 && i >= chamberMultiList) {
                break;
            }
            if (!lines[i].trim().equalsIgnoreCase("Activity")) {
                continue;
            }
            if (nextNonEmptyLineEquals(lines, i + 1, lines.length, "status")) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                String en = normalizeActivityEnglish(lines[j].trim());
                if (looksLikeActivityPhrase(en)) {
                    enActivities.add(en);
                    return;
                }
            }
        }

        String best = null;
        int bestScore = Integer.MIN_VALUE;
        for (int i = 0; i < lines.length; i++) {
            if (chamberMultiList >= 0 && i >= chamberMultiList) {
                break;
            }
            if (isInPageFooterBlock(lines, i) || isActivityContactLabel(lines[i])) {
                continue;
            }
            String en = normalizeActivityEnglish(lines[i].trim());
            if (!looksLikeActivityPhrase(en)) {
                continue;
            }
            int score = scoreStructuralActivityCandidate(en, i);
            if (score > bestScore) {
                bestScore = score;
                best = en;
            }
        }
        if (best != null) {
            enActivities.add(best);
        }
    }

    private void extractRegisterActivityArabic(String[] lines, List<String> arActivities) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("أنشطة السجل")) {
                continue;
            }
            int sectionEnd = Math.min(i + 25, lines.length);
            for (int j = i + 1; j < sectionEnd; j++) {
                String t = lines[j].trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (t.contains("Dear Merchants") || t.contains("عزيزي التاجر")) {
                    break;
                }
                if (!looksLikeArabicActivityPhrase(t)) {
                    continue;
                }
                arActivities.add(arabicTextProcessor.normalizeArabic(
                        arabicTextProcessor.extractArabicText(t)));
                return;
            }
            return;
        }
    }

    private void extractArabicFromActivityTypeHeading(String[] lines, List<String> arActivities) {
        for (int i = 0; i < lines.length; i++) {
            String ar = lines[i].trim();
            if (!ar.equals("نوع النشاط") && !ar.endsWith("نوع النشاط")) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                String t = lines[j].trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (!looksLikeArabicActivityPhrase(t)) {
                    continue;
                }
                arActivities.add(arabicTextProcessor.normalizeArabic(
                        arabicTextProcessor.extractArabicText(t)));
                return;
            }
        }
    }

    private String normalizeActivityEnglish(String line) {
        return arabicTextProcessor.removeArabicText(line).trim()
                .replaceAll("(?i)\\s*activity\\s*$", "").trim();
    }

    private int scoreStructuralActivityCandidate(String en, int distanceFromHeading) {
        int words = en.split("\\s+").length;
        int score = Math.min(en.length(), 45);
        if (words >= 2 && words <= 6) {
            score += 30;
        }
        score += (int) (titleCaseWordRatio(en) * 25);
        score -= Math.max(0, distanceFromHeading - 2) * 8;
        if (en.equals(en.toUpperCase()) && isDocumentHeaderLine(en)) {
            score -= 100;
        }
        return score;
    }

    private boolean isDocumentHeaderLine(String line) {
        String lo = line.toLowerCase();
        return lo.matches("(?i).*(government|emirates|economy and tourism|dubai\\s*$).*")
                && !lo.contains("development");
    }

    private double titleCaseWordRatio(String en) {
        String[] words = en.split("\\s+");
        if (words.length == 0) {
            return 0;
        }
        int titled = 0;
        for (String w : words) {
            if (!w.isEmpty() && Character.isUpperCase(w.charAt(0))) {
                titled++;
            }
        }
        return (double) titled / words.length;
    }

    /** Table row entries may span multiple OCR lines — allow longer merged text. */
    private boolean looksLikeActivityTableEntry(String text) {
        if (text == null || text.isBlank() || text.length() > 120) {
            return false;
        }
        if (!text.matches(".*[A-Za-z].*")) {
            return false;
        }
        if (isSentenceLikeProse(text) || isFieldLabelLine(text) || isLegalTypeLine(text)) {
            return false;
        }
        if (text.contains("@") || text.matches("(?i).*(https?://|www\\.).*")) {
            return false;
        }
        return true;
    }

    /** Short descriptive phrase — not a sentence, label, code, or legal-type line. */
    private boolean looksLikeActivityPhrase(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        String en = text.trim();
        if (en.length() < 3 || en.length() > 60) {
            return false;
        }
        if (!en.matches(".*[A-Za-z].*")) {
            return false;
        }
        int words = en.split("\\s+").length;
        if (words < 1 || words > 7) {
            return false;
        }
        if (isNonActivityProse(en) || isFieldLabelLine(en) || isLegalTypeLine(en)) {
            return false;
        }
        if (en.startsWith("/") || en.startsWith("\\")) {
            return false;
        }
        if (isDocumentHeaderLine(en)) {
            return false;
        }
        if (en.matches("(?i)^\\d{3}-\\d{3}$") || en.matches("(?i)^\\d+$")) {
            return false;
        }
        if (en.contains("@") || en.matches("(?i).*(https?://|www\\.).*")) {
            return false;
        }
        if (DATE_PATTERN.matcher(en).find() && words <= 3) {
            return false;
        }
        long letters = en.chars().filter(Character::isLetter).count();
        long digits = en.chars().filter(Character::isDigit).count();
        return digits == 0 || digits < letters / 2;
    }

    /** Sentence-like OCR lines (disclaimers, instructions) — not activity names. */
    private boolean isNonActivityProse(String text) {
        return isSentenceLikeProse(text) || text.split("\\s+").length > 7;
    }

    private boolean isSentenceLikeProse(String text) {
        String lo = text.toLowerCase().trim();
        int words = lo.split("\\s+").length;
        if (lo.matches("(?i)^(this|the|for|now|kindly|please|without|send|visit|get|you|it|a|an|verify)\\s+.*")) {
            return true;
        }
        if (text.contains(".") && words > 4) {
            return true;
        }
        if (!text.isEmpty() && Character.isLowerCase(text.charAt(0)) && words >= 4) {
            return true;
        }
        return lo.matches("(?i).*( shall | issued | authorization | voucher | signature ).*");
    }

    private boolean isFieldLabelLine(String line) {
        String lo = line.toLowerCase().trim();
        if (line.trim().endsWith("/")) {
            return true;
        }
        return lo.matches("(?i)(phone|fax|mobile|email|address|parcel|status|remarks|tel)\\s*(no\\.?|id)?\\.?")
                || lo.matches("(?i)(phone no|mobile no|fax no|p\\.o\\. box).*")
                || lo.matches("(?i)^receipt\\s*no\\.?$")
                || lo.matches("(?i)^print\\s*date.*")
                || lo.matches("(?i).*(license|register)\\s+(activities|details|members|partners|no).*")
                || lo.equals("activity") || lo.equals("status") || lo.equals("partners");
    }

    private boolean isLegalTypeLine(String line) {
        return line.matches("(?i).*(\\(llc\\)|l\\.l\\.c|limited liability|ذات مسئولية|ذات مسؤولية).*");
    }

    private void extractMultiActivityTable(
            String[] lines, int scanLimit,
            List<String> enActivities, List<String> enStatuses) {
        for (int i = 0; i < scanLimit; i++) {
            String lo = lines[i].toLowerCase().trim();
            if (!lo.equals("activity") && !lo.equals("activity status")) {
                continue;
            }
            if (lo.equals("activity") && !nextNonEmptyLineEquals(lines, i + 1, scanLimit, "status")) {
                continue;
            }
            int start = lo.equals("activity") ? i + 2 : i + 1;
            boolean prevWasStatus = false;
            for (int j = start; j < scanLimit; j++) {
                String t = lines[j].trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (isActivitySectionEnd(t) || isActivityNoiseLine(t)) {
                    break;
                }
                String tlo = t.toLowerCase();
                if (tlo.equals("active") || tlo.equals("inactive")) {
                    if (!enActivities.isEmpty()) {
                        enStatuses.set(enStatuses.size() - 1, tlo.equals("active") ? "Active" : "Inactive");
                    }
                    prevWasStatus = true;
                    continue;
                }
                String enOnly = normalizeActivityEnglish(t)
                        .replaceAll("(?i)\\s*(active|inactive)\\s*$", "").trim();
                if (!looksLikeActivityTableEntry(enOnly)) {
                    prevWasStatus = false;
                    continue;
                }
                if (prevWasStatus && !enActivities.isEmpty()) {
                    int k = j + 1;
                    while (k < scanLimit && lines[k].trim().isEmpty()) {
                        k++;
                    }
                    boolean ownNextIsStatus = k < scanLimit
                            && (lines[k].trim().equalsIgnoreCase("active")
                            || lines[k].trim().equalsIgnoreCase("inactive"));
                    if (!ownNextIsStatus) {
                        enActivities.set(enActivities.size() - 1,
                                enActivities.get(enActivities.size() - 1) + " " + enOnly);
                        prevWasStatus = false;
                        continue;
                    }
                }
                enActivities.add(enOnly);
                enStatuses.add("");
                prevWasStatus = false;
            }
            break;
        }
    }

    private void extractArabicLicenseActivities(String[] lines, int scanLimit, List<String> arActivities) {
        for (int i = 0; i < scanLimit; i++) {
            String line = lines[i];
            String lo = line.toLowerCase();
            boolean pluralHeading = line.contains("أنشطة الرخصة");
            boolean licenseActivitiesHeading = lo.contains("license activities");
            if (!pluralHeading && !licenseActivitiesHeading) {
                continue;
            }
            if (!pluralHeading && !hasArabicActivityTableHeaders(lines, i, scanLimit)) {
                continue;
            }
            boolean singleHeading = line.contains("نشاط الرخصة") && !line.contains("أنشطة الرخصة");
            for (int j = i + 1; j < scanLimit; j++) {
                String t = lines[j].trim();
                if (t.isEmpty()) {
                    continue;
                }
                if (isActivitySectionEnd(t)) {
                    break;
                }
                if (t.equals("النشاط") || t.equals("الحالة")) {
                    continue;
                }
                if (t.equals("فعال") || t.equals("غير فعال")) {
                    continue;
                }
                String tlo = t.toLowerCase();
                if (tlo.matches("(status|activity|active|inactive)")) {
                    continue;
                }
                if (!looksLikeArabicActivityPhrase(t)) {
                    continue;
                }
                String arOnly = arabicTextProcessor.normalizeArabic(
                        arabicTextProcessor.extractArabicText(t));
                arActivities.add(arOnly);
                if (singleHeading) {
                    return;
                }
            }
            break;
        }
    }

    private boolean hasArabicActivityTableHeaders(String[] lines, int headingIdx, int limit) {
        for (int j = headingIdx + 1; j < Math.min(headingIdx + 8, limit); j++) {
            String t = lines[j].trim();
            if (t.equals("النشاط") || t.equals("الحالة")) {
                return true;
            }
        }
        return false;
    }

    private boolean isArabicContactLabel(String line) {
        String ar = arabicTextProcessor.normalizeArabic(
                arabicTextProcessor.extractArabicText(line)).trim();
        if (ar.isEmpty()) {
            return false;
        }
        if (isActivityContactLabel(line)) {
            return true;
        }
        if (ar.length() <= 22 && ar.matches("^(البريد|تليفون|العنوان|الملحظات|مكتب|هاتف|فاكس).*")) {
            return true;
        }
        if (ar.matches("^رقم\\s+.+") && ar.length() <= 28) {
            return true;
        }
        return ar.length() <= 18 && ar.matches(".*صندوق.*بريد.*");
    }

    private boolean looksLikeArabicActivityPhrase(String line) {
        if (!arabicTextProcessor.containsArabic(line) || containsLatinName(line)) {
            return false;
        }
        if (isArabicContactLabel(line)) {
            return false;
        }
        String ar = arabicTextProcessor.normalizeArabic(
                arabicTextProcessor.extractArabicText(line)).trim();
        if (ar.length() < 4 || ar.length() > 80) {
            return false;
        }
        int words = ar.split("\\s+").length;
        if (words < 2 || words > 8) {
            return false;
        }
        if (ar.matches("^(رقم|صندوق|مكتب|هاتف|فاكس|تليفون|البريد|العنوان|الملاحظات|تاريخ).*")) {
            return false;
        }
        if (ar.contains("تاريخ") || ar.contains("طباعة") || ar.contains("إيصال")) {
            return false;
        }
        if (isArabicNonActivityProse(ar) || isArabicDocumentHeader(ar)) {
            return false;
        }
        return true;
    }

    private boolean isArabicDocumentHeader(String ar) {
        return ar.equals("حكومة دبي")
                || ar.equals("الإمارات")
                || (ar.contains("حكومة") && ar.split("\\s+").length <= 3);
    }

    private boolean isArabicNonActivityProse(String ar) {
        if (ar.startsWith("للحصول") || ar.startsWith("يمكنك") || ar.startsWith("احصل")) {
            return true;
        }
        if (ar.contains("اذن الدفع") || ar.contains("رخصتك") || ar.contains("رسائل") || ar.contains("مجانا")) {
            return true;
        }
        return ar.split("\\s+").length > 6;
    }

    private String buildActivitiesJson(
            List<String> enActivities, List<String> arActivities, List<String> enStatuses) {
        int count = Math.max(enActivities.size(), arActivities.size());
        if (count == 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (int i = 0; i < count; i++) {
            String en = i < enActivities.size() ? enActivities.get(i) : "";
            String ar = i < arActivities.size() ? arActivities.get(i) : "";
            String st = i < enStatuses.size() ? enStatuses.get(i) : "";
            if (en.isEmpty() && ar.isEmpty()) {
                continue;
            }
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append("{\"en\":\"").append(en.replace("\"", "'"))
                    .append("\",\"ar\":\"").append(ar.replace("\"", "'"))
                    .append("\",\"status\":\"").append(st)
                    .append("\"}");
        }
        sb.append(']');
        return first ? "" : sb.toString();
    }

    private boolean isSingleLicenseActivityHeading(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String ar = arabicTextProcessor.normalizeArabic(arabicTextProcessor.extractArabicText(line));
        return ar.contains("نشاط الرخصة") && !ar.contains("أنشطة الرخصة");
    }

    private int findActivitiesScanLimit(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase();
            String ar = lines[i];
            if (lo.contains("dubai chamber") || lo.contains("dubaichamber")
                    || lo.contains("member since")
                    || ar.contains("ملحق الشركاء")
                    || ar.contains("شهادة شهر قيد")
                    || lo.contains("commercial register")
                    || lo.contains("dear merchants")) {
                return i;
            }
        }
        return lines.length;
    }

    private boolean nextNonEmptyLineEquals(String[] lines, int from, int limit, String expected) {
        for (int i = from; i < limit; i++) {
            String t = lines[i].trim();
            if (t.isEmpty()) {
                continue;
            }
            return t.equalsIgnoreCase(expected);
        }
        return false;
    }

    private boolean isActivitySectionEnd(String line) {
        return isActivityHardStop(line) || isActivityContactLabel(line);
    }

    private boolean isActivityNoiseLine(String line) {
        if (line == null || line.isBlank()) {
            return true;
        }
        if (looksLikeActivityPhrase(line) || looksLikeActivityTableEntry(line)) {
            return false;
        }
        if (isNonActivityProse(line) || isFieldLabelLine(line) || isLegalTypeLine(line)
                || isLicenceFooterAnchor(line)) {
            return true;
        }
        String lo = line.toLowerCase().trim();
        if (lo.matches("^\\d{2}/\\d{2}/\\d{4}.*") || lo.matches("^\\d+$") || lo.equals("...")) {
            return true;
        }
        if (lo.matches("^\\d{3}-\\d{3}$")) {
            return true;
        }
        if (lo.contains("http://") || lo.contains("https://") || lo.contains("www.")) {
            return true;
        }
        if (lo.contains("dubai chamber") || lo.contains("member since") || lo.contains("dubaichamber")) {
            return true;
        }
        if (lo.contains("date of issue") || lo.contains("expiry date") || lo.equals("remarks")) {
            return true;
        }
        if (lo.contains("certificate shall be invalid") || lo.contains("online verification")
                || lo.contains("without chamber") || lo.contains("authorization")) {
            return true;
        }
        if (lo.matches("(?i)^(activity|status|legal type|issue date|register no|license no).*")) {
            return true;
        }
        return false;
    }

    private boolean containsLatinName(String line) {
        return line.matches(".*[A-Za-z]{3,}.*");
    }

    /**
     * Extract license members and partners as JSON arrays.
     *
     * Sections are located by fixed DET headings (not person-specific values):
     *   Members  → "License Members" / "الأطراف" / "الطراف"
     *   Partners → "License Partners" / "اصحاب الرخصة"
     */
    private String[] extractPartners(String text) {
        String[] lines = text.split("\n");
        DetTradeLicencePeopleExtractor peopleExtractor = new DetTradeLicencePeopleExtractor(arabicTextProcessor);
        List<java.util.Map<String, String>> members = peopleExtractor.extractMembers(lines);
        List<java.util.Map<String, String>> partners = peopleExtractor.extractPartners(lines);
        enrichMembersFromPartners(members, partners);
        enrichMembersFromLegalText(text, members);
        log.debug("Trade licence people: {} members, {} partners extracted", members.size(), partners.size());
        return new String[]{toPersonJson(members, false), toPersonJson(partners, true)};
    }

    private void enrichMembersFromLegalText(String text, List<java.util.Map<String, String>> members) {
        for (java.util.Map<String, String> member : members) {
            if (member.containsKey("nameEn") && !member.get("nameEn").isBlank()) {
                continue;
            }
            String srNo = member.get("srNo");
            if (srNo == null || srNo.isBlank()) {
                continue;
            }
            Pattern nearPerson = Pattern.compile(
                    "(?i)(?:Person|Mr\\.?|Ms\\.?)\\s+([A-Z][A-Z0-9\\s'\\-\\.]{8,})[\\s\\S]{0,120}?"
                            + Pattern.quote(srNo));
            Matcher m = nearPerson.matcher(text);
            if (m.find()) {
                member.put("nameEn", m.group(1).trim().replaceAll("\\s{2,}", " ").toUpperCase());
            }
        }
    }

    private void enrichMembersFromPartners(
            List<java.util.Map<String, String>> members,
            List<java.util.Map<String, String>> partners) {
        if (members.isEmpty() || partners.isEmpty()) return;
        java.util.Map<String, java.util.Map<String, String>> bySrNo = new java.util.LinkedHashMap<>();
        for (java.util.Map<String, String> p : partners) {
            if (p.containsKey("srNo")) {
                bySrNo.put(p.get("srNo"), p);
            }
        }
        for (java.util.Map<String, String> m : members) {
            if (m.containsKey("nameEn") && !m.get("nameEn").isBlank()) continue;
            java.util.Map<String, String> match = bySrNo.get(m.get("srNo"));
            if (match != null && match.containsKey("nameEn")) {
                m.put("nameEn", match.get("nameEn").toUpperCase());
            }
        }
    }

    private List<java.util.Map<String, String>> extractLicenseMembers(String[] lines) {
        List<java.util.Map<String, String>> members = new ArrayList<>();
        boolean stripRole = false;
        for (int i = 0; i < lines.length; i++) {
            if (!isMembersSectionHeading(lines[i])) continue;
            stripRole = isCompactMembersHeading(lines[i]);
            int end = findSectionEnd(lines, i + 1);
            members.addAll(parseMembersCompact(lines, i + 1, end));
            if (members.isEmpty()) {
                members.addAll(parseMembersTabular(lines, i + 1, end));
            }
            break;
        }
        if (stripRole) {
            for (java.util.Map<String, String> m : members) {
                m.remove("role");
            }
        }
        return members;
    }

    /** الطراف block on page 1 has no role column — strip role unless explicit License Members table. */
    private boolean isCompactMembersHeading(String line) {
        if (line == null || line.isBlank()) return false;
        String lo = line.toLowerCase();
        String ar = arabicTextProcessor.normalizeArabic(arabicTextProcessor.extractArabicText(line.trim()));
        if (ar.contains("طراف") || ar.contains("اطراف")) return true;
        return !lo.contains("license members");
    }

    private List<java.util.Map<String, String>> extractLicensePartners(String[] lines) {
        List<java.util.Map<String, String>> partners = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            if (!isPartnersSectionHeading(lines[i])) continue;
            int end = findSectionEnd(lines, i + 1);
            partners.addAll(parsePartnersBlock(lines, i + 1, end));
            break;
        }
        if (partners.isEmpty()) {
            partners.addAll(scanPartnerShareLines(lines));
        }
        return partners;
    }

    /** Fallback when OCR splits/relabels the اصحاب الرخصة heading — scan for srNo+name+share rows. */
    private List<java.util.Map<String, String>> scanPartnerShareLines(String[] lines) {
        List<java.util.Map<String, String>> partners = new ArrayList<>();
        java.util.Map<String, String> pending = null;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isPartnerScanNoise(t)) continue;

            Matcher full = PARTNER_SRNO_NAME_SHARE.matcher(t);
            if (full.matches()) {
                if (pending != null && pending.containsKey("srNo")) partners.add(pending);
                pending = buildPartnerRecord(full.group(1), full.group(2).trim(), full.group(3) + "%", null);
                if (i + 1 < lines.length && isArabicPersonNameLine(lines[i + 1].trim())) {
                    pending.put("nameAr", arabicTextProcessor.normalizeArabic(lines[i + 1].trim()));
                    i++;
                }
                partners.add(pending);
                pending = null;
                continue;
            }

            Matcher shareOnly = SHARE_ONLY.matcher(t);
            if (shareOnly.matches() && pending != null && pending.containsKey("srNo") && !pending.containsKey("share")) {
                pending.put("share", shareOnly.group(1) + "%");
                partners.add(pending);
                pending = null;
                continue;
            }

            Matcher srName = PARTNER_SRNO_NAME.matcher(t);
            if (srName.matches() && looksLikeEnglishName(srName.group(2))) {
                if (pending != null && pending.containsKey("srNo")) partners.add(pending);
                pending = buildPartnerRecord(srName.group(1), srName.group(2).trim(), null, null);
                continue;
            }

            if (pending != null && isArabicPersonNameLine(t)) {
                pending.put("nameAr", arabicTextProcessor.normalizeArabic(t));
            }
        }
        if (pending != null && pending.containsKey("srNo") && pending.containsKey("share")) {
            partners.add(pending);
        }
        return partners;
    }

    private boolean isPartnerScanNoise(String line) {
        if (SECTION_END.matcher(line).matches()) return true;
        String lo = line.toLowerCase();
        if (lo.matches("(?i).*(receipt|print date|يمكنك|now you|zoho|commercial register|amendment|memorandum|preamble|article).*")) {
            return true;
        }
        return isSkippableHeaderLine(line);
    }

    private boolean isMembersSectionHeading(String line) {
        if (line == null || line.isBlank()) return false;
        String trimmed = line.trim();
        if (MEMBERS_HEADING.matcher(trimmed).find()) return true;
        String ar = arabicTextProcessor.normalizeArabic(arabicTextProcessor.extractArabicText(trimmed));
        return "الاطراف".equals(ar) || "الطراف".equals(ar) || ar.endsWith("الاطراف") || ar.endsWith("الطراف");
    }

    private boolean isPartnersSectionHeading(String line) {
        if (line == null || line.isBlank()) return false;
        String trimmed = line.trim();
        if (PARTNERS_HEADING.matcher(trimmed).find()) return true;
        String ar = arabicTextProcessor.normalizeArabic(arabicTextProcessor.extractArabicText(trimmed));
        return (ar.contains("اصحاب") || ar.contains("أصحاب")) && ar.contains("رخص")
                || ar.contains("ملحق") && ar.contains("شرك");
    }

    private int findSectionEnd(String[] lines, int start) {
        for (int i = start; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.isEmpty()) continue;
            if (SECTION_END.matcher(t).matches()) return i;
            if (isPartnersSectionHeading(t) && i > start) return i;
            if (isMembersSectionHeading(t) && i > start) return i;
        }
        return lines.length;
    }

    private boolean isSkippableHeaderLine(String line) {
        if (line == null || line.isBlank()) return true;
        String t = line.trim();
        if (t.length() > 80) return false;
        if (COLUMN_HEADER.matcher(t).matches()) return true;
        String tlo = t.toLowerCase();
        return tlo.matches("(?i).*(license\\s*no|رقم\\s*الرخصة|d&b|الرقم\\s*العالمي|license\\s*details|تفاصيل\\s*الرخصة|ملحق\\s*الشركاء).*");
    }

    private List<java.util.Map<String, String>> parseMembersCompact(String[] lines, int start, int end) {
        List<java.util.Map<String, String>> members = new ArrayList<>();
        for (int i = start; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isSkippableHeaderLine(t)) continue;

            java.util.Map<String, String> rec = parseCompactMemberLine(t);
            if (rec == null) continue;

            if (i + 1 < end) {
                String next = lines[i + 1].trim();
                if (isEnglishPersonNameLine(next)) {
                    rec.put("nameEn", next);
                    i++;
                }
            }
            members.add(rec);
        }
        return members;
    }

    private java.util.Map<String, String> parseCompactMemberLine(String line) {
        if (!arabicTextProcessor.containsArabic(line)) return null;

        Matcher strict = MEMBER_AR_NAT_SRNO.matcher(line);
        if (strict.matches()) {
            return compactMemberRecord(strict.group(1).trim(), strict.group(2), strict.group(3));
        }

        Matcher srAtEnd = Pattern.compile("^(.*\\S)\\s+(\\d{5,10})\\s*$").matcher(line);
        if (!srAtEnd.matches()) return null;

        String body = srAtEnd.group(1).trim();
        String srNo = srAtEnd.group(2);
        Matcher natSuffix = Pattern.compile(
                "^(.+?)\\s*(باكستان|پاکستان|باکستان|باكستان|الامارات|الإمارات|السعودية|مصر|الأردن|الاردن|الهند|عمان|الكويت|البحرين|قطر|لبنان)\\s*$"
        ).matcher(body);
        if (natSuffix.matches()) {
            return compactMemberRecord(natSuffix.group(1).trim(), natSuffix.group(2), srNo);
        }

        natSuffix = Pattern.compile(
                "^(.+?)(باكستان|پاکستان|باکستان|باكستان|الامارات|الإمارات|السعودية|مصر|الأردن|الاردن|الهند|عمان|الكويت|البحرين|قطر|لبنان)$"
        ).matcher(body.replaceAll("\\s+", ""));
        if (natSuffix.matches()) {
            return compactMemberRecord(natSuffix.group(1).trim(), natSuffix.group(2), srNo);
        }
        return null;
    }

    private java.util.Map<String, String> compactMemberRecord(String nameAr, String nationalityAr, String srNo) {
        java.util.Map<String, String> rec = new java.util.LinkedHashMap<>();
        rec.put("nameAr", arabicTextProcessor.normalizeArabic(nameAr));
        rec.put("nationalityAr", nationalityAr);
        rec.put("nationality", mapNationalityArToEn(nationalityAr));
        rec.put("srNo", srNo);
        return rec;
    }

    private List<java.util.Map<String, String>> parseMembersTabular(String[] lines, int start, int end) {
        List<java.util.Map<String, String>> members = new ArrayList<>();
        java.util.Map<String, String> pending = null;

        for (int i = start; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isSkippableHeaderLine(t)) continue;

            Matcher shareOnly = SHARE_ONLY.matcher(t);
            if (shareOnly.matches()) {
                if (pending != null) pending.put("share", shareOnly.group(1) + "%");
                continue;
            }

            Matcher srNoOnly = SRNO_ONLY.matcher(t);
            if (srNoOnly.matches()) {
                if (pending == null) pending = new java.util.LinkedHashMap<>();
                pending.put("srNo", srNoOnly.group(1));
                continue;
            }

            String rawEn = arabicTextProcessor.removeArabicText(t).replaceAll("[/|]+", " ").replaceAll("\\s+", " ").trim();
            String rawAr = extractArabicOnly(t);

            Matcher role = ROLE.matcher(rawEn);
            if (role.find() && isRoleLabelLine(t)) {
                if (pending != null && hasMemberIdentity(pending)) members.add(pending);
                pending = new java.util.LinkedHashMap<>();
                pending.put("role", capitalize(role.group(1)));
                continue;
            }

            Matcher natEn = NAT_EN.matcher(rawEn);
            if (natEn.find()) {
                if (pending == null) pending = new java.util.LinkedHashMap<>();
                pending.put("nationality", capitalize(natEn.group(1)));
                Matcher natAr = NAT_AR.matcher(t);
                if (natAr.find()) pending.put("nationalityAr", natAr.group(1));
                continue;
            }

            if (!rawAr.isEmpty() && rawEn.isEmpty()) {
                String cleaned = stripNationalityFromArabic(rawAr);
                if (cleaned.length() >= 3) {
                    if (pending == null) pending = new java.util.LinkedHashMap<>();
                    pending.merge("nameAr", cleaned, (a, b) -> a.length() >= b.length() ? a : b);
                }
                continue;
            }

            if (!rawEn.isEmpty() && rawAr.isEmpty() && isEnglishPersonNameLine(rawEn)) {
                if (pending == null) pending = new java.util.LinkedHashMap<>();
                pending.put("nameEn", rawEn);
                if (pending.containsKey("srNo") || pending.containsKey("nameAr")) {
                    members.add(pending);
                    pending = null;
                }
            }
        }

        if (pending != null && hasMemberIdentity(pending)) {
            members.add(pending);
        }
        return members;
    }

    private boolean isRoleLabelLine(String line) {
        String lo = line.toLowerCase().trim();
        if (lo.matches("(?i)^(manager|director|partner|owner)\\s*/.*")) return true;
        if (lo.matches("(?i).*(manager|director|partner|owner)\\s*/\\s*.*")) {
            return line.length() < 40;
        }
        return false;
    }

    private List<java.util.Map<String, String>> parsePartnersBlock(String[] lines, int start, int end) {
        List<java.util.Map<String, String>> partners = new ArrayList<>();
        java.util.Map<String, String> pending = null;

        for (int i = start; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isSkippableHeaderLine(t)) continue;

            Matcher full = PARTNER_SRNO_NAME_SHARE.matcher(t);
            if (full.matches()) {
                if (pending != null && hasPartnerIdentity(pending)) partners.add(pending);
                pending = buildPartnerRecord(full.group(1), full.group(2).trim(), full.group(3) + "%", null);
                if (i + 1 < end && isArabicPersonNameLine(lines[i + 1].trim())) {
                    pending.put("nameAr", arabicTextProcessor.normalizeArabic(extractArabicOnly(lines[i + 1])));
                    i++;
                }
                partners.add(pending);
                pending = null;
                continue;
            }

            Matcher shareOnly = SHARE_ONLY.matcher(t);
            if (shareOnly.matches()) {
                if (pending != null && !pending.containsKey("share")) {
                    pending.put("share", shareOnly.group(1) + "%");
                    partners.add(pending);
                    pending = null;
                }
                continue;
            }

            Matcher srName = PARTNER_SRNO_NAME.matcher(t);
            if (srName.matches() && looksLikeEnglishName(srName.group(2))) {
                if (pending != null && hasPartnerIdentity(pending)) partners.add(pending);
                pending = buildPartnerRecord(srName.group(1), srName.group(2).trim(), null, null);
                continue;
            }

            if (pending != null) {
                if (isArabicPersonNameLine(t)) {
                    pending.put("nameAr", arabicTextProcessor.normalizeArabic(t.trim()));
                    continue;
                }
            }
        }

        if (pending != null && hasPartnerIdentity(pending) && pending.containsKey("srNo")) {
            partners.add(pending);
        }
        return partners;
    }

    private java.util.Map<String, String> buildPartnerRecord(String srNo, String nameEn, String share, String nameAr) {
        java.util.Map<String, String> rec = new java.util.LinkedHashMap<>();
        rec.put("srNo", srNo);
        rec.put("nameEn", nameEn);
        if (share != null) rec.put("share", share);
        if (nameAr != null) rec.put("nameAr", nameAr);
        return rec;
    }

    private boolean parsePartnerSlashLine(String line, List<java.util.Map<String, String>> partners) {
        String[] parts = line.split("\\s*/\\s*");
        if (parts.length < 2) return false;

        java.util.Map<String, String> rec = new java.util.LinkedHashMap<>();
        StringBuilder nameEn = new StringBuilder();
        StringBuilder nameAr = new StringBuilder();
        for (String part : parts) {
            String p = part.trim();
            String pEn = arabicTextProcessor.removeArabicText(p).trim();
            String pAr = extractArabicOnly(p);
            Matcher nep = NAT_EN.matcher(pEn);
            Matcher nap = NAT_AR.matcher(p);
            if (nep.find()) {
                rec.put("nationality", capitalize(nep.group(1)));
                continue;
            }
            if (nap.find() && pEn.isEmpty()) {
                rec.put("nationalityAr", nap.group(1));
                continue;
            }
            if (!pEn.isEmpty()) nameEn.append(pEn).append(' ');
            if (!pAr.isEmpty()) nameAr.append(pAr).append(' ');
        }

        String en = nameEn.toString().trim();
        String ar = nameAr.toString().trim();
        if (en.isEmpty() && ar.isEmpty()) return false;
        if (!en.isEmpty()) rec.put("nameEn", en);
        if (!ar.isEmpty()) rec.put("nameAr", arabicTextProcessor.normalizeArabic(ar));
        partners.add(rec);
        return true;
    }

    private boolean hasMemberIdentity(java.util.Map<String, String> rec) {
        return rec.containsKey("srNo") || rec.containsKey("nameEn") || rec.containsKey("nameAr");
    }

    private boolean hasPartnerIdentity(java.util.Map<String, String> rec) {
        String ne = rec.getOrDefault("nameEn", "");
        String na = rec.getOrDefault("nameAr", "");
        return ne.matches(".*[A-Za-z]{3,}.*") || na.length() >= 3;
    }

    private boolean isEnglishPersonNameLine(String line) {
        if (line == null || line.isBlank()) return false;
        if (arabicTextProcessor.containsArabic(line)) return false;
        return looksLikeEnglishName(line);
    }

    private boolean isArabicPersonNameLine(String line) {
        if (line == null || line.isBlank()) return false;
        if (!arabicTextProcessor.containsArabic(line)) return false;
        String en = arabicTextProcessor.removeArabicText(line).trim();
        return en.isEmpty() && extractArabicOnly(line).length() >= 3;
    }

    private boolean looksLikeEnglishName(String text) {
        if (text == null || text.isBlank()) return false;
        String cleaned = text
                .replaceAll("(?i)\\b(united arab emirates|uae|pakistan|saudi arabia|egypt|jordan|india|oman|kuwait|bahrain|qatar|lebanon)\\b", "")
                .replaceAll("(?i)\\b(manager|director|partner|owner|name|share|nationality|sr|no)\\b", "")
                .replaceAll("\\b\\d{5,10}\\b", "")
                .replaceAll("\\d+(?:\\.\\d+)?\\s*%", "")
                .replaceAll("\\s{2,}", " ")
                .trim();
        return cleaned.matches(".*[A-Za-z]{3,}.*");
    }

    private String extractArabicOnly(String line) {
        return line.replaceAll("[A-Za-z0-9/|.%@+\\-\\s:()]+", " ").replaceAll("\\s+", " ").trim();
    }

    private String stripNationalityFromArabic(String rawAr) {
        return rawAr.replaceAll("(الامارات|الإمارات|پاکستان|باکستان|باكستان|السعودية|مصر|الأردن|الاردن|الهند|عمان|الكويت|البحرين|قطر|لبنان)", "")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private String mapNationalityArToEn(String nationalityAr) {
        if (nationalityAr == null) return "";
        String n = arabicTextProcessor.normalizeArabic(nationalityAr);
        if (n.contains("باك") || n.contains("پاک") || n.contains("باک")) return "Pakistan";
        if (n.contains("الامارات") || n.contains("الإمارات")) return "United Arab Emirates";
        if (n.contains("السعود")) return "Saudi Arabia";
        if (n.contains("مصر")) return "Egypt";
        if (n.contains("الارد") || n.contains("الأرد")) return "Jordan";
        if (n.contains("الهند")) return "India";
        if (n.contains("عمان")) return "Oman";
        if (n.contains("الكويت")) return "Kuwait";
        if (n.contains("البحر")) return "Bahrain";
        if (n.contains("قطر")) return "Qatar";
        if (n.contains("لبنان")) return "Lebanon";
        return nationalityAr;
    }

    private String toPersonJson(List<java.util.Map<String, String>> people, boolean requireSrNo) {
        if (people == null || people.isEmpty()) return "";
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (java.util.Map<String, String> rec : people) {
            if (requireSrNo && !rec.containsKey("srNo")) continue;
            String ne = rec.getOrDefault("nameEn", "");
            String na = rec.getOrDefault("nameAr", "");
            if (!ne.matches(".*[A-Za-z]{3,}.*") && na.length() < 3) continue;
            if (ne.toLowerCase().matches("^(no|name|role|share|nationality|sr).*") && ne.length() < 15) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            boolean ff = true;
            for (java.util.Map.Entry<String, String> e : rec.entrySet()) {
                if (!ff) sb.append(',');
                ff = false;
                sb.append('"').append(e.getKey()).append("\":\"")
                        .append(e.getValue().replace("\"", "'").replaceAll("\\s{2,}", " ").trim())
                        .append('"');
            }
            sb.append('}');
        }
        sb.append(']');
        return first ? "" : sb.toString();
    }


    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1).toLowerCase();
    }

    /** D&B D-U-N-S: look for the actual number pattern (XX-XXX-XXXX) or standalone near "D-U-N-S" label */
    private String extractDunsNumber(String text) {
        // Try formatted D-U-N-S number pattern first (e.g. 51-060-4783)
        Matcher m = DUNS_PATTERN.matcher(text);
        if (m.find()) return m.group(1).trim();
        // Look for "D&B D-U-N-S No." label and get next standalone numeric line
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase();
            if ((lo.contains("d&b") || lo.contains("d-u-n-s") || lo.contains("dab d-uns")) && !lo.contains("license")) {
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    String t = lines[j].trim();
                    if (t.isEmpty()) continue;
                    // Must look like a D-U-N-S number or standalone digits — not a license/register number
                    if (t.matches("\\d{2}-\\d{3}-\\d{4}")) return t;
                    if (t.matches("\\d{9,12}")) return t;
                    // If it's "0" or similar, skip (not a real D-U-N-S)
                    if (!t.isEmpty()) break;
                }
            }
        }
        return "";
    }

    /** DOCI No: appears as "DOCI No.\n<mainLicenseNo>\n<dociNo>" — return the second number */
    private String extractDociNo(String text) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase().trim();
            if (lo.matches("(?i)(doci|dcci)\\s*no\\.?.*")) {
                // Collect up to 3 digit-only lines after the label
                List<String> nums = new ArrayList<>();
                for (int j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                    String t = lines[j].trim();
                    if (t.isEmpty()) continue;
                    if (t.matches("\\d{4,10}")) {
                        nums.add(t);
                        if (nums.size() == 2) break;
                    } else {
                        break;
                    }
                }
                // The DOCI number is the last one collected (second distinct number)
                if (nums.size() >= 2) return nums.get(1);
                if (nums.size() == 1) return nums.get(0);
            }
        }
        return "";
    }

    /** Company name AR: in RTL documents the Arabic name appears BEFORE the label on the same line */
    private String extractArabicRtlLabeledLine(String text, String... arabicLabels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            for (String label : arabicLabels) {
                if (lines[i].contains(label)) {
                    // In RTL layout, value may be the prefix before the label
                    String prefix = lines[i].substring(0, lines[i].indexOf(label)).trim();
                    if (prefix.length() >= 2 && arabicTextProcessor.containsArabic(prefix)) {
                        return arabicTextProcessor.normalizeArabic(prefix);
                    }
                    // Or value after colon
                    if (lines[i].contains(":")) {
                        String val = lines[i].substring(lines[i].lastIndexOf(':') + 1).trim();
                        if (val.length() >= 2 && arabicTextProcessor.containsArabic(val)) {
                            return arabicTextProcessor.normalizeArabic(val);
                        }
                    }
                    // Or next Arabic line
                    for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                        String next = lines[j].trim();
                        if (arabicTextProcessor.containsArabic(next)) {
                            return arabicTextProcessor.normalizeArabic(next);
                        }
                    }
                }
            }
        }
        return "";
    }

    private void addIfNotEmpty(DocumentFieldsDto result, String key, String value) {
        if (value != null && !value.isBlank()) {
            result.addField(key, value);
        }
    }

    @Override
    public DocumentType getSupportedDocumentType() {
        return DocumentType.TRADE_LICENCE;
    }

    @Override
    public boolean canParse(String ocrText) {
        if (ocrText == null || ocrText.isEmpty()) return false;
        String lower = ocrText.toLowerCase();
        return lower.contains("trade licen") || lower.contains("commercial licen")
                || lower.contains("logistic licen")
                || lower.contains("رخصة تجارية") || lower.contains("رخصة لوجستية")
                || lower.contains("dcci") || lower.contains("economy and tourism")
                || lower.contains("sedd.ae") || lower.contains("government of sharjah")
                || lower.contains("jebel ali free zone") || lower.contains("jafza");
    }
}
