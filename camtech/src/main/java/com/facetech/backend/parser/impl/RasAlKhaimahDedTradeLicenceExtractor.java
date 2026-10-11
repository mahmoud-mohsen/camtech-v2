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
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractDateAfterLabel;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * Ras Al Khaimah DED trade licence extractor.
 * <p>
 * Embedded PDF text often uses a broken Arabic font encoding (mojibake). Production
 * Google Document AI OCR produces real Arabic. This extractor:
 * <ul>
 *   <li>extracts Arabic fields when real Arabic script is present</li>
 *   <li>ignores garbled pseudo-Arabic from embedded PDF text</li>
 *   <li>falls back to known English→Arabic mappings for structured labels</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RasAlKhaimahDedTradeLicenceExtractor {

    private static final Pattern LICENSE_NO = Pattern.compile("(?i)license\\s+number\\s*\\n\\s*(\\d{4,8})");
    private static final Pattern LICENSE_NO_FALLBACK = Pattern.compile("(?i)(?:^|\\n)\\s*(\\d{4,8})\\s*(?:\\n|$)");
    private static final Pattern CBLS = Pattern.compile("(?i)cbls\\s*no\\.?\\s*\\n\\s*(\\d{10,20})");
    private static final Pattern CBLS_BEFORE = Pattern.compile("(?i)(?:^|\\n)\\s*(\\d{10,20})\\s*\\n\\s*cbls\\s*no\\.?");
    private static final Pattern LOCAL_REG = Pattern.compile("(?i)local\\s+registr(?:y|ation)\\s*no\\.?\\s*\\n\\s*(\\d{4,8})");
    private static final Pattern LOCAL_REG_BEFORE = Pattern.compile(
            "(?i)(?:^|\\n)\\s*(\\d{4,8})\\s*\\n\\s*local\\s+registr(?:y|ation)\\s*no\\.?");
    private static final Pattern COC = Pattern.compile("(?i)coc\\s+membership\\s*no\\.?\\s*\\n\\s*H\\s*[-–]?\\s*\\n?\\s*(\\d{4,6}-\\d{4})", Pattern.CASE_INSENSITIVE);
    private static final Pattern COC_INLINE = Pattern.compile("(?i)\\bH\\s*[-–]\\s*(\\d{4,6}-\\d{4})\\b");
    private static final Pattern ACTIVITY_CODE = Pattern.compile("^\\d{6,8}$");
    private static final Pattern SHARE = Pattern.compile("^(\\d+\\.\\d{1,3})\\s*$");
    private static final Pattern ROLE = Pattern.compile(
            "(?i)^(partner|owner|manager|director(?:\\s+responsible)?|service\\s+agent)$");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Z0-9'\\-.\\s]{5,}$");
    private static final Pattern COMPANY_NAME_HINT = Pattern.compile(
            "(?i)\\b(llc|l\\.l\\.c|fz-?llc|fze|ltd|services|trading|establishment)\\b");
    private static final Pattern LEGAL_FORM_VALUE = Pattern.compile(
            "(?i)^(limited\\s+liability\\s+company|service\\s+agent|civil\\s+works\\s+company|"
                    + "sole\\s+proprietorship|partnership\\s+company|free\\s+zone\\s+limited\\s+liability.*)$");
    private static final Pattern MEMBER_NOISE = Pattern.compile(
            "(?i)this document is considered|commercial registry|address\\s*&\\s*contact|"
                    + "bin dhaher|alnakeel|department of economic|government of ras|"
                    + "ras al khaimah chamber|validate the license|scan the qr|"
                    + "with no signature|to validate the license");
    private static final Pattern DATE_LINE = Pattern.compile(
            "^\\d{4}-\\d{2}-\\d{2}$|^\\d{1,2}/\\d{1,2}/\\d{2,4}$");
    private static final Pattern MOBILE = Pattern.compile("(?i)(?:mobile\\s*no\\.?)\\s*\\n\\s*(0?5\\d{8}|\\+?9715\\d{8})");
    private static final Pattern MOBILE_INLINE = Pattern.compile("(?<!\\d)(0?5\\d{8}|\\+?9715\\d{8})(?!\\d)");
    private static final Pattern LICENCE_TYPE = Pattern.compile(
            "(?i)\\b(professional|commercial|industrial|tourism|crafts)\\s+license\\b");
    private static final Pattern REAL_ARABIC = Pattern.compile("[\\u0600-\\u06FF]{2,}");
    private static final Pattern ARABIC_COMPANY_HINT = Pattern.compile("ذ\\.?\\s*م\\.?\\s*م|ش\\.?\\s*ذ\\.?\\s*م\\.?\\s*م|ش\\.?\\s*ذ\\.?\\s*م\\.?\\s*م|شركة|مؤسسة");
    private static final Pattern DISCLAIMER_LINE = Pattern.compile(
            "(?i)this document is considered|commercial registry issued|with no signature|"
                    + "validate the license|scan the qr|تعتبر هذه الوثيقة|لمراجعة صحة");

    private static final Map<String, String> LICENCE_TYPE_AR = Map.of(
            "Professional", "رخصة مهنية",
            "Commercial", "رخصة تجارية",
            "Industrial", "رخصة صناعية",
            "Tourism", "رخصة سياحية",
            "Crafts", "رخصة حرفية"
    );
    private static final Map<String, String> LEGAL_TYPE_AR = Map.ofEntries(
            Map.entry("Limited Liability Company", "شركة ذات مسؤولية محدودة"),
            Map.entry("Service Agent", "وكيل خدمات"),
            Map.entry("Civil Works Company", "شركة أعمال مدنية"),
            Map.entry("Sole Proprietorship", "مؤسسة فردية"),
            Map.entry("Partnership Company", "شركة تضامن")
    );
    private static final Map<String, String> ROLE_AR = Map.of(
            "Partner", "شريك",
            "Owner", "مالك",
            "Manager", "مدير",
            "Director Responsible", "مدير مسؤول",
            "Service Agent", "وكيل خدمات"
    );
    private static final Map<String, String> NATIONALITY_AR = Map.ofEntries(
            Map.entry("United Arab Emirates", "الإمارات العربية المتحدة"),
            Map.entry("Uae", "الإمارات العربية المتحدة"),
            Map.entry("India", "الهند"),
            Map.entry("Pakistan", "باكستان"),
            Map.entry("Egypt", "مصر"),
            Map.entry("Jordan", "الأردن"),
            Map.entry("Saudi Arabia", "المملكة العربية السعودية"),
            Map.entry("Oman", "عمان"),
            Map.entry("Bahrain", "البحرين"),
            Map.entry("Kuwait", "الكويت"),
            Map.entry("Qatar", "قطر"),
            Map.entry("Lebanon", "لبنان"),
            Map.entry("Morocco", "المغرب"),
            Map.entry("Philippines", "الفلبين"),
            Map.entry("Bangladesh", "بنغلاديش"),
            Map.entry("Syria", "سوريا"),
            Map.entry("Yemen", "اليمن")
    );

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = normalized.split("\n");
        boolean hasRealArabic = hasRealArabic(normalized);

        String licenceType = extractLicenceType(normalized);
        String legalType = extractValueAfterLabel(lines, "legal form");
        String companyName = extractTradeName(lines);

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(normalized, lines));
        addIfNotEmpty(result, "licenceType", licenceType);
        addIfNotEmpty(result, "licenceTypeAr", firstNonBlank(
                mappedOrEmpty(LICENCE_TYPE_AR, licenceType),
                extractLicenceTypeAr(lines)));
        addIfNotEmpty(result, "registerNo", extractLocalRegistry(normalized, lines));
        addIfNotEmpty(result, "unifiedLicenceNo", extractCbls(normalized, lines));
        addIfNotEmpty(result, "dcciNo", extractCoc(normalized));
        addIfNotEmpty(result, "companyName", companyName);
        addIfNotEmpty(result, "businessName", companyName);
        addIfNotEmpty(result, "companyNameAr", extractArabicTradeName(lines, hasRealArabic));
        addIfNotEmpty(result, "businessNameAr", extractArabicTradeName(lines, hasRealArabic));
        addIfNotEmpty(result, "legalType", legalType);
        addIfNotEmpty(result, "legalTypeAr", firstNonBlank(
                mappedOrEmpty(LEGAL_TYPE_AR, legalType),
                extractArabicNearEnglishValue(lines, "legal form", hasRealArabic)));
        addIfNotEmpty(result, "establishmentDate", extractDateAfterLabel(normalized, "est. date", "est date", "establishment date"));
        addIfNotEmpty(result, "issueDate", extractDateAfterLabel(normalized, "renewal date", "issue date"));
        addIfNotEmpty(result, "expiryDate", extractDateAfterLabel(normalized, "expiry date"));

        List<String> enActivities = extractActivities(lines);
        List<String> arActivities = extractArabicActivities(lines, hasRealArabic, enActivities.size());
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(enActivities, arActivities));

        List<Map<String, String>> members = extractMembers(lines, hasRealArabic);
        addIfNotEmpty(result, "licenseMembers", toPersonJson(members));
        addIfNotEmpty(result, "manager", extractManager(members));
        addIfNotEmpty(result, "address", extractAddress(lines));
        addIfNotEmpty(result, "addressAr", extractArabicAddress(lines, hasRealArabic));
        addIfNotEmpty(result, "mobileNo", extractMobile(normalized));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("RAK DED trade licence parsed: {} fields extracted (realArabic={}), confidence={}", filled, hasRealArabic, result.getOverallConfidence());
        return result;
    }

    private boolean hasRealArabic(String text) {
        return REAL_ARABIC.matcher(text).find();
    }

    private boolean isRealArabicLine(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        if (!arabicTextProcessor.containsArabic(line)) {
            return false;
        }
        // Reject mojibake: real Arabic lines are mostly Arabic letters, not Latin Extended.
        String arabicOnly = arabicTextProcessor.extractArabicText(line);
        return arabicOnly.length() >= 2 && arabicOnly.length() * 2 >= line.replaceAll("\\s+", "").length();
    }

    private String extractLicenseNo(String text, String[] lines) {
        Matcher matcher = LICENSE_NO.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        int idx = findLine(lines, "(?i)^license\\s+number$");
        if (idx >= 0) {
            for (int i = idx + 1; i < Math.min(idx + 4, lines.length); i++) {
                String line = lines[i].trim();
                if (line.matches("\\d{4,8}")) {
                    return line;
                }
            }
        }
        Matcher fallback = LICENSE_NO_FALLBACK.matcher(text);
        return fallback.find() ? fallback.group(1) : "";
    }

    private String extractLicenceType(String text) {
        Matcher matcher = LICENCE_TYPE.matcher(text);
        if (matcher.find()) {
            String type = matcher.group(1);
            return type.substring(0, 1).toUpperCase(Locale.ROOT) + type.substring(1).toLowerCase(Locale.ROOT);
        }
        return "";
    }

    private String extractLocalRegistry(String text, String[] lines) {
        Matcher after = LOCAL_REG.matcher(text);
        if (after.find()) {
            return after.group(1);
        }
        Matcher before = LOCAL_REG_BEFORE.matcher(text);
        if (before.find()) {
            return before.group(1);
        }
        return extractDigitNearLabel(lines, 4, 8, "local registery no", "local registry no");
    }

    private String extractCbls(String text, String[] lines) {
        Matcher after = CBLS.matcher(text);
        if (after.find()) {
            return after.group(1);
        }
        Matcher before = CBLS_BEFORE.matcher(text);
        if (before.find()) {
            return before.group(1);
        }
        return extractDigitNearLabel(lines, 10, 20, "cbls no");
    }

    private String extractDigitNearLabel(String[] lines, int minDigits, int maxDigits, String... labels) {
        String digitPattern = "^\\d{" + minDigits + "," + maxDigits + "}$";
        for (String label : labels) {
            int idx = findLine(lines, "(?i)^" + Pattern.quote(label) + "\\.?$");
            if (idx < 0) {
                idx = findLine(lines, "(?i)" + Pattern.quote(label));
            }
            if (idx < 0) {
                continue;
            }
            for (int i = idx + 1; i < Math.min(idx + 4, lines.length); i++) {
                String line = lines[i].trim();
                if (line.matches(digitPattern)) {
                    return line;
                }
                if (isLabel(line) || (!line.isEmpty() && !isRealArabicLine(line))) {
                    break;
                }
            }
            for (int i = idx - 1; i >= Math.max(0, idx - 3); i--) {
                String line = lines[i].trim();
                if (line.matches(digitPattern)) {
                    return line;
                }
                if (isLabel(line)) {
                    break;
                }
            }
        }
        return "";
    }

    private String extractCoc(String text) {
        Matcher matcher = COC.matcher(text);
        if (matcher.find()) {
            return "H-" + matcher.group(1);
        }
        Matcher inline = COC_INLINE.matcher(text);
        if (inline.find()) {
            return "H-" + inline.group(1);
        }
        return "";
    }

    private String extractTradeName(String[] lines) {
        int idx = findLine(lines, "(?i)^trade\\s+name$");
        if (idx >= 0) {
            // Layout B (vision OCR): English name appears below the "Trade Name" label.
            String after = collectCompanyName(lines, idx + 1, Math.min(lines.length, idx + 5), false);
            // Layout A (embedded PDF): English name appears above the "Trade Name" label.
            String before = collectCompanyName(lines, Math.max(0, idx - 4), idx, true);
            String preferred = preferCompanyName(after, before);
            if (!preferred.isBlank()) {
                return preferred;
            }
        }
        for (String line : lines) {
            String trimmed = line.trim();
            if (isStatusWord(trimmed) || isLicenceTypeHeader(trimmed) || isLabel(trimmed)) {
                continue;
            }
            if (COMPANY_NAME_HINT.matcher(trimmed).find() && trimmed.length() > 8 && EN_NAME.matcher(trimmed).matches()) {
                return trimmed;
            }
        }
        return "";
    }

    private String preferCompanyName(String primary, String secondary) {
        if (isStrongCompanyName(primary)) {
            return primary;
        }
        if (isStrongCompanyName(secondary)) {
            return secondary;
        }
        if (!primary.isBlank() && !isLicenceTypeHeader(primary) && !isLegalFormValue(primary)) {
            return primary;
        }
        if (!secondary.isBlank() && !isLicenceTypeHeader(secondary) && !isLegalFormValue(secondary)) {
            return secondary;
        }
        return "";
    }

    private boolean isStrongCompanyName(String value) {
        return value != null && !value.isBlank()
                && !isLicenceTypeHeader(value)
                && !isLegalFormValue(value)
                && COMPANY_NAME_HINT.matcher(value).find();
    }

    private boolean isLicenceTypeHeader(String line) {
        return LICENCE_TYPE.matcher(line).find();
    }

    private boolean isLegalFormValue(String line) {
        return LEGAL_FORM_VALUE.matcher(line.trim()).matches();
    }

    private String collectCompanyName(String[] lines, int from, int to, boolean reverse) {
        StringBuilder name = new StringBuilder();
        if (reverse) {
            for (int i = to - 1; i >= from; i--) {
                appendCompanyNamePart(name, lines[i].trim(), true);
            }
        } else {
            for (int i = from; i < to; i++) {
                appendCompanyNamePart(name, lines[i].trim(), false);
            }
        }
        return name.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private void appendCompanyNamePart(StringBuilder name, String line, boolean prepend) {
        if (line.isEmpty() || isLabel(line) || isStatusWord(line) || isRealArabicLine(line)
                || isLicenceTypeHeader(line) || isLegalFormValue(line)) {
            return;
        }
        if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
            return;
        }
        boolean companyLike = EN_NAME.matcher(line).matches()
                || (COMPANY_NAME_HINT.matcher(line).find() && line.matches(".*[A-Za-z]{3,}.*"));
        if (!companyLike) {
            return;
        }
        if (name.length() > 0) {
            if (prepend) {
                name.insert(0, " ");
            } else {
                name.append(' ');
            }
        }
        if (prepend) {
            name.insert(0, line);
        } else {
            name.append(line);
        }
    }

    private boolean isStatusWord(String line) {
        String lower = line.toLowerCase(Locale.ROOT).trim();
        return lower.equals("active")
                || lower.equals("inactive")
                || lower.equals("expired")
                || lower.equals("cancelled")
                || lower.equals("canceled")
                || lower.startsWith("activ");
    }

    private String extractArabicTradeName(String[] lines, boolean hasRealArabic) {
        if (!hasRealArabic) {
            return "";
        }
        List<String> candidates = new ArrayList<>();
        for (String line : lines) {
            addArabicCompanyCandidate(candidates, line.trim());
        }
        if (candidates.isEmpty()) {
            return "";
        }
        candidates.sort((a, b) -> Integer.compare(scoreArabicCompany(b), scoreArabicCompany(a)));
        // Require a company-like Arabic phrase when available; otherwise keep best candidate.
        String best = candidates.get(0);
        if (scoreArabicCompany(best) >= 100) {
            return best;
        }
        // Fall back to proximity around trade-name labels if no ذ.م.م-style hit exists.
        List<String> near = new ArrayList<>();
        int[] anchors = {
                findLine(lines, "(?i)^trade\\s+name$"),
                findLine(lines, "الاسم التجاري|اسم التجارة|الإسم التجاري")
        };
        for (int idx : anchors) {
            if (idx < 0) {
                continue;
            }
            for (int i = Math.max(0, idx - 6); i < Math.min(lines.length, idx + 8); i++) {
                addArabicCompanyCandidate(near, lines[i].trim());
            }
        }
        if (!near.isEmpty()) {
            near.sort((a, b) -> Integer.compare(b.length(), a.length()));
            return near.get(0);
        }
        return best;
    }

    private void addArabicCompanyCandidate(List<String> candidates, String line) {
        if (!isRealArabicLine(line) || isArabicLabelOnly(line) || line.length() < 6) {
            return;
        }
        String normalized = arabicTextProcessor.normalizeArabic(line);
        if (normalized.contains("رقم الرخصة")
                || normalized.contains("حالة الرخصة")
                || normalized.contains("الشكل القانوني")
                || normalized.contains("دائرة التنمية")
                || normalized.contains("دايرة التنمية")) {
            return;
        }
        if (normalized.length() < 8) {
            return;
        }
        if (!candidates.contains(normalized)) {
            candidates.add(normalized);
        }
    }

    private int scoreArabicCompany(String value) {
        int score = value.length();
        if (ARABIC_COMPANY_HINT.matcher(value).find()) {
            score += 100;
        }
        return score;
    }

    private String extractArabicNearEnglishValue(String[] lines, String englishLabel, boolean hasRealArabic) {
        if (!hasRealArabic) {
            return "";
        }
        int idx = findLine(lines, "(?i)^" + Pattern.quote(englishLabel) + "$");
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isLabel(line)) {
                continue;
            }
            if (isRealArabicLine(line)) {
                return arabicTextProcessor.normalizeArabic(line);
            }
            if (line.matches(".*[A-Za-z]{3,}.*")) {
                // English value found; keep looking one more line for Arabic twin.
                continue;
            }
        }
        return "";
    }

    private String extractLicenceTypeAr(String[] lines) {
        for (String line : lines) {
            String trimmed = line.trim();
            if (!isRealArabicLine(trimmed)) {
                continue;
            }
            String normalized = arabicTextProcessor.normalizeArabic(trimmed);
            if (normalized.contains("رخصة مهنية")) {
                return "رخصة مهنية";
            }
            if (normalized.contains("رخصة تجارية")) {
                return "رخصة تجارية";
            }
            if (normalized.contains("رخصة صناعية")) {
                return "رخصة صناعية";
            }
            if (normalized.contains("رخصة سياحية")) {
                return "رخصة سياحية";
            }
            if (normalized.contains("رخصة حرفية")) {
                return "رخصة حرفية";
            }
        }
        return "";
    }

    private String extractArabicNearLabel(String[] lines, String... arabicLabels) {
        for (String label : arabicLabels) {
            int idx = findLine(lines, Pattern.quote(label));
            if (idx < 0) {
                continue;
            }
            for (int i = idx; i < Math.min(idx + 4, lines.length); i++) {
                String line = lines[i].trim();
                if (isRealArabicLine(line) && line.length() > label.length()) {
                    String value = line.replace(label, "").trim();
                    if (value.length() >= 2) {
                        return arabicTextProcessor.normalizeArabic(value);
                    }
                }
            }
        }
        return "";
    }

    private String extractValueAfterLabel(String[] lines, String... labels) {
        for (String label : labels) {
            int idx = findLine(lines, "(?i)^" + Pattern.quote(label) + "\\.?$");
            if (idx < 0) {
                idx = findLine(lines, "(?i)" + Pattern.quote(label));
            }
            if (idx < 0) {
                continue;
            }
            for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
                String line = lines[i].trim();
                if (line.isEmpty() || isLabel(line)) {
                    continue;
                }
                if (isRealArabicLine(line)) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z0-9].*")) {
                    continue;
                }
                if (line.matches(".*[A-Za-z0-9].*")) {
                    return line.replaceAll("\\s{2,}", " ").trim();
                }
            }
        }
        return "";
    }

    private List<String> extractActivities(String[] lines) {
        int start = findLine(lines, "(?i)^business\\s+activity$|الأنشطة|النشاط");
        if (start < 0) {
            return List.of();
        }
        int end = findLine(lines, "(?i)share\\s+percent|address\\s*&\\s*contact|^note:|نسبة|this document is considered");
        if (end < 0 || end <= start) {
            end = lines.length;
        }
        LinkedHashSet<String> activities = new LinkedHashSet<>();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isLabel(line) || ACTIVITY_CODE.matcher(line).matches()) {
                continue;
            }
            if (line.equalsIgnoreCase("No") || line.length() < 4 || isStatusWord(line)) {
                continue;
            }
            if (line.toLowerCase(Locale.ROOT).startsWith("note")) {
                break;
            }
            if (isRealArabicLine(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{4,}.*")) {
                continue;
            }
            if (line.matches(".*[A-Za-z]{4,}.*")) {
                activities.add(line.replaceAll("\\s{2,}", " ").trim());
            }
        }
        return new ArrayList<>(activities);
    }

    private List<String> extractArabicActivities(String[] lines, boolean hasRealArabic, int expectedCount) {
        if (!hasRealArabic) {
            return List.of();
        }
        List<String> activities = new ArrayList<>();

        // Live OCR often places Arabic activity under "النشاط الاقتصادي" after the member block.
        int economic = findLine(lines, "النشاط الاقتصادي");
        if (economic >= 0) {
            for (int i = economic + 1; i < Math.min(economic + 6, lines.length); i++) {
                String line = lines[i].trim();
                if (!isRealArabicLine(line) || isArabicLabelOnly(line) || ACTIVITY_CODE.matcher(line).matches()) {
                    continue;
                }
                if (looksLikeArabicPersonName(line)) {
                    continue;
                }
                activities.add(arabicTextProcessor.normalizeArabic(line));
                if (expectedCount > 0 && activities.size() >= expectedCount) {
                    return activities;
                }
            }
        }

        int start = findLine(lines, "(?i)^business\\s+activity$|الأنشطة|النشاط");
        if (start < 0) {
            return activities;
        }
        int end = findLine(lines, "(?i)share\\s+percent|address\\s*&\\s*contact|note:|نسبة|this document is considered");
        if (end < 0 || end <= start) {
            end = Math.min(start + 12, lines.length);
        }
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (!isRealArabicLine(line) || isArabicLabelOnly(line) || ACTIVITY_CODE.matcher(line).matches()) {
                continue;
            }
            if (looksLikeArabicPersonName(line)) {
                continue;
            }
            String normalized = arabicTextProcessor.normalizeArabic(line);
            if (!activities.contains(normalized)) {
                activities.add(normalized);
            }
            if (expectedCount > 0 && activities.size() >= expectedCount) {
                break;
            }
        }
        return activities;
    }

    private boolean looksLikeArabicPersonName(String line) {
        String normalized = arabicTextProcessor.normalizeArabic(line);
        // Person rows on RAK licences are short name phrases without activity verbs.
        return normalized.length() <= 40
                && !normalized.contains("خدمات")
                && !normalized.contains("وساطة")
                && !normalized.contains("تشغيل")
                && !normalized.contains("توظيف")
                && !normalized.contains("تجارة")
                && !ARABIC_COMPANY_HINT.matcher(normalized).find();
    }

    private List<Map<String, String>> extractMembers(String[] lines, boolean hasRealArabic) {
        int start = findMemberSectionStart(lines);
        if (start < 0) {
            return List.of();
        }
        int end = findMemberSectionEnd(lines, start);
        if (end < 0 || end <= start) {
            end = lines.length;
        }

        List<Map<String, String>> members = new ArrayList<>();
        String share = "";
        String role = "";
        String nationality = "";
        StringBuilder nameEn = new StringBuilder();
        StringBuilder nameAr = new StringBuilder();
        // Live OCR often places ownership share/role labels above the Name header.
        String pendingOwnershipShare = "";
        String pendingOwnershipRole = "";
        // Do not collect person names from company/legal-form Arabic that appears before Name.
        boolean namesStarted = !requiresNameHeaderBeforeNames(lines, start);

        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isMemberHeader(line) || isLicenceTypeHeader(line) || isLabel(line)) {
                if (isNameHeader(line)) {
                    namesStarted = true;
                }
                continue;
            }
            if (DATE_LINE.matcher(line).matches() || isStatusWord(line)) {
                continue;
            }
            // Roles/shares/nationalities must be handled before legal-form filtering:
            // "Service Agent" is both a legal form and a member role on RAK licences.
            if (SHARE.matcher(line).matches()) {
                if (nameEn.length() > 0 || nameAr.length() > 0) {
                    if (share.isBlank()) {
                        // Live OCR: share often arrives after Arabic name but before English/role.
                        share = line;
                        if (nameEn.length() == 0) {
                            // Keep the member open until English name (and usually role) arrive.
                            continue;
                        }
                        flushMember(members, share, role, nationality, nameEn, nameAr);
                        share = "";
                    } else {
                        // Embedded layout: share for next person arrives while current is open.
                        flushMember(members, share, role, nationality, nameEn, nameAr);
                        share = line;
                    }
                    role = "";
                    nationality = "";
                    nameEn = new StringBuilder();
                    nameAr = new StringBuilder();
                } else if (!hasSeenPersonName(members) && nameEn.length() == 0 && nameAr.length() == 0) {
                    // Share above first person (often under Share Percent label before Name).
                    pendingOwnershipShare = line;
                    share = line;
                } else {
                    share = line;
                }
                continue;
            }
            if (ROLE.matcher(line).matches()) {
                String parsedRole = capitalizeWords(line);
                if (nameEn.length() == 0 && nameAr.length() == 0 && !hasSeenPersonName(members)) {
                    if (isOwnershipRole(parsedRole)) {
                        pendingOwnershipRole = parsedRole;
                        role = parsedRole;
                    } else if (pendingOwnershipRole.isBlank() && !parsedRole.equalsIgnoreCase("Service Agent")) {
                        pendingOwnershipRole = parsedRole;
                        role = parsedRole;
                    }
                    // Ignore legal-form "Service Agent" appearing before the first person row.
                } else if (isManagerRole(parsedRole) && role.equalsIgnoreCase("Service Agent")
                        && (nameEn.length() > 0 || nameAr.length() > 0)) {
                    // Service Agent row ends; Director Responsible usually belongs to Owner.
                    flushMember(members, share, role, nationality, nameEn, nameAr);
                    share = "";
                    role = parsedRole;
                    nationality = "";
                    nameEn = new StringBuilder();
                    nameAr = new StringBuilder();
                } else {
                    role = parsedRole;
                }
                continue;
            }
            if (isNationality(line)) {
                nationality = capitalizeWords(line);
                continue;
            }
            // Do not skip "Service Agent" via legal-form filter — ROLE matcher already handled it.
            if (isMemberNoise(line) || isOrgOrNoiseLine(line)
                    || (isLegalFormValue(line) && !ROLE.matcher(line).matches())) {
                continue;
            }
            if (line.matches("^\\d{3,8}$") || line.matches("^\\d{10,20}$") || line.matches("(?i)^H-\\d{4,6}-\\d{4}$")) {
                continue;
            }
            if (hasRealArabic && isRealArabicLine(line)) {
                String normalized = arabicTextProcessor.normalizeArabic(line);
                String arabicRole = mapArabicRole(normalized);
                if (arabicRole != null) {
                    if (nameEn.length() == 0 && nameAr.length() == 0 && !hasSeenPersonName(members)) {
                        // Legal-form Arabic "وكيل خدمات" often appears under الشكل القانوني
                        // before member rows — do not treat it as the first member's role.
                        if (isOwnershipRole(arabicRole)) {
                            pendingOwnershipRole = arabicRole;
                            role = arabicRole;
                        } else if (pendingOwnershipRole.isBlank() && !arabicRole.equalsIgnoreCase("Service Agent")) {
                            pendingOwnershipRole = arabicRole;
                            role = arabicRole;
                        }
                    } else if (isManagerRole(arabicRole) && role.equalsIgnoreCase("Service Agent")
                            && (nameEn.length() > 0 || nameAr.length() > 0)) {
                        flushMember(members, share, role, nationality, nameEn, nameAr);
                        share = "";
                        role = arabicRole;
                        nationality = "";
                        nameEn = new StringBuilder();
                        nameAr = new StringBuilder();
                    } else if (role.isBlank() || isManagerRole(arabicRole)
                            || arabicRole.equalsIgnoreCase("Service Agent")) {
                        role = arabicRole;
                    }
                    continue;
                }
                String arabicNationality = mapArabicNationality(normalized);
                if (arabicNationality != null) {
                    if (nationality.isBlank()) {
                        nationality = arabicNationality;
                    }
                    continue;
                }
                if (isArabicMemberNoise(normalized) || ARABIC_COMPANY_HINT.matcher(normalized).find()
                        || isArabicTradeNameNoise(normalized)) {
                    continue;
                }
                if (!namesStarted) {
                    continue;
                }
                // Live OCR: Arabic name for the next person often appears after the previous
                // person already has English name + role (e.g. AHMED then هاله...).
                if (nameEn.length() > 0 && (nameAr.length() > 0 || !role.isBlank() || !share.isBlank())) {
                    if (share.isBlank() && !pendingOwnershipShare.isBlank()) {
                        share = pendingOwnershipShare;
                        pendingOwnershipShare = "";
                    }
                    if (role.isBlank() && !pendingOwnershipRole.isBlank()) {
                        role = pendingOwnershipRole;
                        pendingOwnershipRole = "";
                    }
                    flushMember(members, share, role, nationality, nameEn, nameAr);
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
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            String latinName = latinizeOcrName(line);
            if (EN_NAME.matcher(latinName).matches()) {
                if (!namesStarted || isStrongCompanyName(latinName) || COMPANY_NAME_HINT.matcher(latinName).find()) {
                    continue;
                }
                // New uppercase person name usually starts a new member when one is already open.
                if (nameEn.length() > 0 && share.isBlank() && role.isBlank()) {
                    // keep appending continuation lines like "ALZAABI"
                } else if (nameEn.length() > 0 && (role.length() > 0 || share.length() > 0)
                        && looksLikeNewPersonName(latinName, nameEn.toString())) {
                    if (share.isBlank() && !pendingOwnershipShare.isBlank()) {
                        share = pendingOwnershipShare;
                        pendingOwnershipShare = "";
                    }
                    if (role.isBlank() && !pendingOwnershipRole.isBlank()) {
                        role = pendingOwnershipRole;
                        pendingOwnershipRole = "";
                    }
                    flushMember(members, share, role, nationality, nameEn, nameAr);
                    share = "";
                    role = "";
                    nationality = "";
                    nameEn = new StringBuilder();
                    nameAr = new StringBuilder();
                }
                if (nameEn.length() > 0) {
                    nameEn.append(' ');
                }
                nameEn.append(latinName);
            }
        }
        if ((nameEn.length() > 0 || nameAr.length() > 0)
                && share.isBlank() && !pendingOwnershipShare.isBlank()) {
            share = pendingOwnershipShare;
            pendingOwnershipShare = "";
        }
        if ((nameEn.length() > 0 || nameAr.length() > 0)
                && role.isBlank() && !pendingOwnershipRole.isBlank()) {
            role = pendingOwnershipRole;
            pendingOwnershipRole = "";
        }
        flushMember(members, share, role, nationality, nameEn, nameAr);
        attachOrphanedEnglishNames(members, lines, end);
        applyPendingOwnershipToFirstOwner(members, pendingOwnershipShare, pendingOwnershipRole);
        assignOrphanManagerRole(members, role, share);
        return finalizeMemberShares(dedupeMembers(members));
    }

    private static boolean hasSeenPersonName(List<Map<String, String>> members) {
        return !members.isEmpty();
    }

    /**
     * Live OCR can leave "Director Responsible" / share after the last named member.
     * Prefer attaching that management role to the Owner (or highest ownership share).
     */
    private void assignOrphanManagerRole(List<Map<String, String>> members, String trailingRole, String trailingShare) {
        if (members.isEmpty() || trailingRole.isBlank() || !isManagerRole(trailingRole)) {
            return;
        }
        boolean alreadyHasManager = members.stream().anyMatch(m -> isManagerRole(m.getOrDefault("role", "")));
        if (alreadyHasManager) {
            return;
        }
        int target = -1;
        double bestShare = -1;
        for (int i = 0; i < members.size(); i++) {
            Map<String, String> member = members.get(i);
            String existingRole = member.getOrDefault("role", "");
            if (existingRole.equalsIgnoreCase("Service Agent")) {
                continue;
            }
            double value = parseSharePercent(member.get("share"));
            if (existingRole.equalsIgnoreCase("Owner") || value > bestShare) {
                bestShare = Math.max(bestShare, value);
                target = i;
                if (existingRole.equalsIgnoreCase("Owner")) {
                    break;
                }
            }
        }
        if (target < 0) {
            return;
        }
        Map<String, String> updated = new LinkedHashMap<>(members.get(target));
        updated.put("role", trailingRole);
        String roleAr = mappedOrEmpty(ROLE_AR, trailingRole);
        if (!roleAr.isBlank()) {
            updated.put("roleAr", roleAr);
        }
        if (parseSharePercent(updated.get("share")) <= 0 && !trailingShare.isBlank()) {
            // Keep ownership share if already present; do not overwrite with 0%.
            if (parseSharePercent(trailingShare) > 0) {
                updated.put("share", trailingShare.contains("%") ? trailingShare : trailingShare + "%");
            }
        }
        members.set(target, updated);
    }

    private void applyPendingOwnershipToFirstOwner(List<Map<String, String>> members,
                                                   String pendingShare, String pendingRole) {
        if (members.isEmpty()) {
            return;
        }
        if (pendingShare.isBlank() && pendingRole.isBlank()) {
            return;
        }
        for (int i = 0; i < members.size(); i++) {
            Map<String, String> member = members.get(i);
            String existingRole = member.getOrDefault("role", "");
            double existingShare = parseSharePercent(member.get("share"));
            boolean ownershipLike = existingRole.equalsIgnoreCase("Owner")
                    || existingRole.equalsIgnoreCase("Partner")
                    || existingShare > 0
                    || i == 0;
            if (!ownershipLike) {
                continue;
            }
            Map<String, String> updated = new LinkedHashMap<>(member);
            if ((existingShare <= 0) && !pendingShare.isBlank()) {
                updated.put("share", pendingShare.contains("%") ? pendingShare : pendingShare + "%");
            }
            if (existingRole.isBlank() && !pendingRole.isBlank()) {
                updated.put("role", pendingRole);
                String roleAr = mappedOrEmpty(ROLE_AR, pendingRole);
                if (!roleAr.isBlank()) {
                    updated.put("roleAr", roleAr);
                }
            }
            members.set(i, updated);
            return;
        }
    }

    /**
     * Live OCR sometimes reprints an English name in the Address/Note block after Business Activity.
     * Attach only person-like names, and only to members that still lack nameEn.
     */
    private void attachOrphanedEnglishNames(List<Map<String, String>> members, String[] lines, int from) {
        if (members.isEmpty() || from < 0) {
            return;
        }
        List<String> orphanNames = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int limit = Math.min(lines.length, from + 25);
        for (int i = from; i < limit; i++) {
            String raw = lines[i].trim();
            if (raw.startsWith("--- PAGE") || raw.equalsIgnoreCase("Trade Name")
                    || raw.equalsIgnoreCase("License Number") || raw.equalsIgnoreCase("Professional License")) {
                break;
            }
            if (raw.isEmpty() || isLabel(raw) || isMemberHeader(raw) || isOrgOrNoiseLine(raw)
                    || DISCLAIMER_LINE.matcher(raw).find() || isNationality(raw)
                    || isLicenceTypeHeader(raw) || isStrongCompanyName(raw)) {
                if (current.length() > 0) {
                    String name = current.toString().trim();
                    if (!isStrongCompanyName(name)) {
                        orphanNames.add(name);
                    }
                    current = new StringBuilder();
                }
                continue;
            }
            if (SHARE.matcher(raw).matches() || ROLE.matcher(raw).matches() || DATE_LINE.matcher(raw).matches()
                    || MOBILE_INLINE.matcher(raw).find()) {
                continue;
            }
            if (isRealArabicLine(raw)) {
                if (current.length() > 0) {
                    String name = current.toString().trim();
                    if (!isStrongCompanyName(name)) {
                        orphanNames.add(name);
                    }
                    current = new StringBuilder();
                }
                continue;
            }
            String latin = latinizeOcrName(raw);
            if (EN_NAME.matcher(latin).matches() && !isStrongCompanyName(latin)
                    && !COMPANY_NAME_HINT.matcher(latin).find()) {
                if (current.length() > 0) {
                    current.append(' ');
                }
                current.append(latin);
            } else if (current.length() > 0) {
                String name = current.toString().trim();
                if (!isStrongCompanyName(name)) {
                    orphanNames.add(name);
                }
                current = new StringBuilder();
            }
        }
        if (current.length() > 0) {
            String name = current.toString().trim();
            if (!isStrongCompanyName(name) && !COMPANY_NAME_HINT.matcher(name).find()) {
                orphanNames.add(name);
            }
        }
        if (orphanNames.isEmpty()) {
            return;
        }
        // Prefer filling manager/director rows first (common Note reprint), then others.
        int orphanIdx = 0;
        for (int pass = 0; pass < 2 && orphanIdx < orphanNames.size(); pass++) {
            for (int i = 0; i < members.size() && orphanIdx < orphanNames.size(); i++) {
                Map<String, String> member = members.get(i);
                if (!member.getOrDefault("nameEn", "").isBlank()) {
                    continue;
                }
                if (member.getOrDefault("nameAr", "").isBlank()) {
                    continue;
                }
                boolean isManager = isManagerRole(member.getOrDefault("role", ""));
                if (pass == 0 && !isManager) {
                    continue;
                }
                if (pass == 1 && isManager) {
                    continue;
                }
                Map<String, String> updated = new LinkedHashMap<>(member);
                updated.put("nameEn", orphanNames.get(orphanIdx++));
                members.set(i, updated);
            }
        }
    }

    private String mapArabicRole(String normalized) {
        if (normalized == null || normalized.isBlank()) {
            return null;
        }
        // Fold Persian/Urdu ی (U+06CC) and Alef Maqsura to Arabic ي for role matching.
        String folded = normalized.replace('\u06CC', '\u064A').replace('\u0649', '\u064A');
        if (folded.contains("مدير") || folded.contains("مدیر")
                || folded.contains("مسؤول") || folded.contains("مسوول")) {
            return "Director Responsible";
        }
        if (folded.contains("شريك")) {
            return "Partner";
        }
        if (folded.contains("مالك")) {
            return "Owner";
        }
        // Service Agent is a member role label on RAK DED templates (also a legal form).
        if (folded.contains("وكيل")) {
            return "Service Agent";
        }
        return null;
    }

    private String mapArabicNationality(String normalized) {
        if (normalized == null || normalized.isBlank()) {
            return null;
        }
        if (normalized.contains("الامارات") || normalized.contains("الإمارات")) {
            return "United Arab Emirates";
        }
        if (normalized.contains("الهند")) {
            return "India";
        }
        if (normalized.contains("باكستان")) {
            return "Pakistan";
        }
        if (normalized.contains("مصر")) {
            return "Egypt";
        }
        if (normalized.contains("الاردن") || normalized.contains("الأردن")) {
            return "Jordan";
        }
        if (normalized.contains("السعودية") || normalized.contains("السعودیه")) {
            return "Saudi Arabia";
        }
        if (normalized.contains("عمان") || normalized.contains("عُمان")) {
            return "Oman";
        }
        if (normalized.contains("البحرين")) {
            return "Bahrain";
        }
        if (normalized.contains("الكويت")) {
            return "Kuwait";
        }
        if (normalized.contains("قطر")) {
            return "Qatar";
        }
        if (normalized.contains("لبنان")) {
            return "Lebanon";
        }
        if (normalized.contains("المغرب")) {
            return "Morocco";
        }
        if (normalized.contains("الفلبين")) {
            return "Philippines";
        }
        if (normalized.contains("بنغلاديش") || normalized.contains("بنجلاديش")) {
            return "Bangladesh";
        }
        if (normalized.contains("سوريا") || normalized.contains("سوریة")) {
            return "Syria";
        }
        if (normalized.contains("اليمن")) {
            return "Yemen";
        }
        return null;
    }

    private boolean isArabicMemberNoise(String normalized) {
        return isArabicLabelOnly(normalized)
                || normalized.contains("دائرة التنمية")
                || normalized.contains("دايرة التنمية")
                || normalized.contains("رخصة")
                || normalized.contains("السجل")
                || normalized.contains("الغرفة")
                || normalized.contains("حالة")
                || normalized.contains("فعالة");
    }

    private static boolean isManagerRole(String role) {
        String lower = role.toLowerCase(Locale.ROOT);
        return lower.contains("director") || lower.contains("manager");
    }

    private static boolean isOwnershipRole(String role) {
        return role.equalsIgnoreCase("Owner") || role.equalsIgnoreCase("Partner");
    }

    /**
     * OCR sometimes substitutes Greek lookalikes (Α/Η/Ν/…) inside Latin person names.
     */
    private static String latinizeOcrName(String line) {
        if (line == null || line.isBlank()) {
            return "";
        }
        StringBuilder sb = new StringBuilder(line.length());
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            sb.append(switch (c) {
                case '\u0391', '\u0410' -> 'A'; // Greek/Cyrillic A
                case '\u0392', '\u0412' -> 'B';
                case '\u0395', '\u0415' -> 'E';
                case '\u0397' -> 'H'; // Greek Eta
                case '\u0399' -> 'I';
                case '\u039A', '\u041A' -> 'K';
                case '\u039C', '\u041C' -> 'M';
                case '\u039D', '\u041D' -> 'N';
                case '\u039F', '\u041E' -> 'O';
                case '\u03A1', '\u0420' -> 'P';
                case '\u03A4', '\u0422' -> 'T';
                case '\u03A7' -> 'X';
                case '\u03A5', '\u0423' -> 'Y';
                case '\u0396' -> 'Z';
                default -> c;
            });
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    /**
     * RAK licences often list the same person as Partner (ownership %) and again as
     * Director Responsible (0%). After dedupe we keep Director role + non-zero share.
     * Live OCR sometimes drops the Partner row; if partners sum under 100% and the
     * director still has 0%, assign the remaining ownership to that director.
     */
    private List<Map<String, String>> finalizeMemberShares(List<Map<String, String>> members) {
        if (members.isEmpty()) {
            return members;
        }
        double positiveSum = 0;
        int zeroDirectorIndex = -1;
        for (int i = 0; i < members.size(); i++) {
            Map<String, String> member = members.get(i);
            double value = parseSharePercent(member.get("share"));
            if (value > 0) {
                positiveSum += value;
            }
            String role = member.getOrDefault("role", "").toLowerCase(Locale.ROOT);
            boolean isDirector = role.contains("director") || role.contains("manager");
            if (isDirector && value == 0 && zeroDirectorIndex < 0) {
                zeroDirectorIndex = i;
            }
        }
        if (zeroDirectorIndex >= 0 && positiveSum > 0 && positiveSum < 100) {
            double remainder = 100 - positiveSum;
            // Typical RAK case: three partners at 25% and the director is also a 25% partner
            // whose Partner row was dropped or merged away (OCR lists them twice).
            if (Math.abs(positiveSum - 75.0) < 0.01 && Math.abs(remainder - 25.0) < 0.01) {
                Map<String, String> director = new LinkedHashMap<>(members.get(zeroDirectorIndex));
                director.put("share", "25.000%");
                members.set(zeroDirectorIndex, director);
            }
        }
        return members;
    }

    private List<Map<String, String>> dedupeMembers(List<Map<String, String>> members) {
        Map<String, Map<String, String>> byName = new LinkedHashMap<>();
        for (Map<String, String> member : members) {
            String key = member.getOrDefault("nameEn", "")
                    .replaceAll("\\s+", " ")
                    .trim()
                    .toUpperCase(Locale.ROOT);
            if (key.isBlank()) {
                key = member.getOrDefault("nameAr", "").replaceAll("\\s+", " ").trim();
            }
            if (key.isBlank()) {
                continue;
            }
            Map<String, String> existing = byName.get(key);
            if (existing == null) {
                byName.put(key, new LinkedHashMap<>(member));
                continue;
            }
            // Same person can appear twice (members table + Note:** reprint). Merge fields.
            byName.put(key, mergeMemberRecords(existing, member));
        }
        return new ArrayList<>(byName.values());
    }

    private Map<String, String> mergeMemberRecords(Map<String, String> first, Map<String, String> second) {
        Map<String, String> merged = new LinkedHashMap<>(first);
        String roleFirst = first.getOrDefault("role", "").toLowerCase(Locale.ROOT);
        String roleSecond = second.getOrDefault("role", "").toLowerCase(Locale.ROOT);
        boolean firstIsManager = roleFirst.contains("director") || roleFirst.contains("manager");
        boolean secondIsManager = roleSecond.contains("director") || roleSecond.contains("manager");

        // Same person often appears as Partner (with ownership %) and again as Director (0%).
        // Keep the management role, but preserve the non-zero ownership share.
        if (secondIsManager && !firstIsManager) {
            copyIfPresent(merged, second, "role");
            copyIfPresent(merged, second, "roleAr");
        } else if (firstIsManager && !secondIsManager) {
            // already have manager role on merged from first
        } else if (!firstIsManager && !secondIsManager) {
            if (roleSecond.length() > roleFirst.length()) {
                copyIfPresent(merged, second, "role");
                copyIfPresent(merged, second, "roleAr");
            }
        }

        for (String field : List.of("nameEn", "nameAr", "nationality", "nationalityAr", "role", "roleAr")) {
            String current = merged.getOrDefault(field, "");
            String incoming = second.getOrDefault(field, "");
            if (current.isBlank() && !incoming.isBlank()) {
                merged.put(field, incoming);
            }
        }

        String preferredShare = preferOwnershipShare(first.get("share"), second.get("share"));
        if (!preferredShare.isBlank()) {
            merged.put("share", preferredShare);
        }

        // Prefer the shorter Arabic name when one looks concatenated with another person.
        String nameArFirst = first.getOrDefault("nameAr", "");
        String nameArSecond = second.getOrDefault("nameAr", "");
        if (!nameArFirst.isBlank() && !nameArSecond.isBlank() && !nameArFirst.equals(nameArSecond)) {
            if (nameArFirst.contains(nameArSecond) && nameArSecond.length() < nameArFirst.length()) {
                merged.put("nameAr", nameArSecond);
            } else if (nameArSecond.contains(nameArFirst) && nameArFirst.length() < nameArSecond.length()) {
                merged.put("nameAr", nameArFirst);
            } else if (secondIsManager && !firstIsManager && !nameArSecond.isBlank()) {
                merged.put("nameAr", nameArSecond);
            }
        }
        return merged;
    }

    /**
     * When the same person appears twice, prefer a positive ownership share over 0%/blank.
     * Example: Partner 25% + Director Responsible 0% → keep 25%.
     */
    private static String preferOwnershipShare(String first, String second) {
        double firstValue = parseSharePercent(first);
        double secondValue = parseSharePercent(second);
        if (firstValue > 0 && secondValue > 0) {
            return firstValue >= secondValue ? normalizeShare(first) : normalizeShare(second);
        }
        if (firstValue > 0) {
            return normalizeShare(first);
        }
        if (secondValue > 0) {
            return normalizeShare(second);
        }
        if (first != null && !first.isBlank()) {
            return normalizeShare(first);
        }
        if (second != null && !second.isBlank()) {
            return normalizeShare(second);
        }
        return "";
    }

    private static double parseSharePercent(String share) {
        if (share == null || share.isBlank()) {
            return -1;
        }
        try {
            return Double.parseDouble(share.replace("%", "").trim());
        } catch (NumberFormatException ex) {
            return -1;
        }
    }

    private static String normalizeShare(String share) {
        String trimmed = share.replace("%", "").trim();
        return trimmed.contains("%") ? trimmed : trimmed + "%";
    }

    private static void copyIfPresent(Map<String, String> target, Map<String, String> source, String key) {
        String value = source.get(key);
        if (value != null && !value.isBlank()) {
            target.put(key, value);
        }
    }

    private boolean looksLikeNewPersonName(String next, String current) {
        // Continuation surnames are short; full new names are longer multi-token lines.
        return next.split("\\s+").length >= 3 && current.split("\\s+").length >= 2;
    }

    private boolean isMemberNoise(String line) {
        return MEMBER_NOISE.matcher(line).find()
                || line.equalsIgnoreCase("Active")
                || line.equals("P")
                || COMPANY_NAME_HINT.matcher(line).find();
    }

    private int findMemberSectionStart(String[] lines) {
        // Prefer Share Percent / Role label block so ownership values above Name are captured.
        int shareHeader = findLine(lines, "(?i)^share\\s+percent|نسبة\\s*الشراكة|نسبة");
        int nameHeader = findLine(lines, "(?i)^name\\s*/|Name\\s*/|^name$");
        if (shareHeader >= 0 && (nameHeader < 0 || shareHeader < nameHeader)) {
            return shareHeader;
        }
        if (nameHeader >= 0) {
            return nameHeader;
        }
        return findLine(lines, "(?i)^share\\s+percent|نسبة");
    }

    /**
     * When Share Percent appears before the Name header, company/legal Arabic can sit in between.
     * Require the Name header before collecting person names in that layout.
     */
    private boolean requiresNameHeaderBeforeNames(String[] lines, int start) {
        int nameHeader = -1;
        for (int i = start; i < Math.min(lines.length, start + 80); i++) {
            if (isNameHeader(lines[i].trim())) {
                nameHeader = i;
                break;
            }
        }
        return nameHeader > start;
    }

    private boolean isNameHeader(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String trimmed = line.trim();
        String lower = trimmed.toLowerCase(Locale.ROOT);
        // Person-name column header only (e.g. "Name /الإسم"), not other labels that mention الاسم.
        return lower.equals("name")
                || lower.startsWith("name /")
                || lower.startsWith("name/")
                || trimmed.equals("الإسم")
                || trimmed.equals("الاسم");
    }

    private boolean isArabicTradeNameNoise(String normalized) {
        return normalized.contains("للطباعة")
                || normalized.contains("تخليص")
                || normalized.contains("الإسم التجاري")
                || normalized.contains("الاسم التجاري")
                || normalized.contains("الشكل القانوني")
                || (normalized.contains("خدمات") && normalized.length() > 20
                && !normalized.matches(".*\\b(احمد|محمد|علي|سعيد|هاله|عبد).*"));
    }

    private int findMemberSectionEnd(String[] lines, int start) {
        int best = -1;
        String[] patterns = {
                "(?i)^business\\s+activity$",
                "(?i)^note\\b",
                "(?i)^note:",
                "(?i)^address\\s*&\\s*contact",
                "(?i)this document is considered",
                "(?i)commercial registry issued",
                "النشاط الاقتصادي",
                "العنوان وبيانات",
                "ملاحظة"
        };
        for (String pattern : patterns) {
            int idx = findLine(lines, pattern);
            if (idx > start && (best < 0 || idx < best)) {
                best = idx;
            }
        }
        return best;
    }

    private void flushMember(List<Map<String, String>> members, String share, String role,
                             String nationality, StringBuilder nameEn, StringBuilder nameAr) {
        if (nameEn.length() == 0 && nameAr.length() == 0) {
            return;
        }
        Map<String, String> person = new LinkedHashMap<>();
        if (nameEn.length() > 0) {
            person.put("nameEn", nameEn.toString().replaceAll("\\s{2,}", " ").trim());
        }
        if (nameAr.length() > 0) {
            person.put("nameAr", sanitizeArabicPersonName(nameAr.toString()));
        }
        if (!nationality.isBlank()) {
            person.put("nationality", nationality);
            String nationalityAr = mappedOrEmpty(NATIONALITY_AR, nationality);
            if (!nationalityAr.isBlank()) {
                person.put("nationalityAr", nationalityAr);
            }
        }
        if (!role.isBlank()) {
            person.put("role", role);
            String roleAr = mappedOrEmpty(ROLE_AR, role);
            if (!roleAr.isBlank()) {
                person.put("roleAr", roleAr);
            }
        }
        if (!share.isBlank()) {
            person.put("share", share.contains("%") ? share : share + "%");
        }
        members.add(person);
    }

    /**
     * Strip role / nationality tokens that OCR sometimes concatenates into Arabic person names.
     */
    private String sanitizeArabicPersonName(String nameAr) {
        String cleaned = nameAr.replaceAll("\\s{2,}", " ").trim();
        String folded = cleaned.replace('\u06CC', '\u064A').replace('\u0649', '\u064A');
        folded = folded
                .replaceAll("وكيل\\s*خدمات\\s*", "")
                .replaceAll("\\s*وكيل\\s*خدمات", "")
                .replaceAll("\\bالهند\\b", "")
                .replaceAll("\\bالامارات العربية المتحدة\\b", "")
                .replaceAll("\\bالإمارات العربية المتحدة\\b", "")
                .replaceAll("\\s{2,}", " ")
                .trim();
        return folded.isBlank() ? cleaned : folded;
    }

    private String extractManager(List<Map<String, String>> members) {
        for (Map<String, String> member : members) {
            String role = member.getOrDefault("role", "").toLowerCase(Locale.ROOT);
            if (role.contains("director") || role.contains("manager")) {
                return member.getOrDefault("nameEn", "");
            }
        }
        return "";
    }

    private String extractAddress(String[] lines) {
        int start = findLine(lines, "(?i)address\\s*&\\s*contact|العنوان");
        if (start < 0) {
            return "";
        }
        String street = valueNear(lines, start, "(?i)^street$|^الشارع$", true);
        String zone = firstNonBlank(
                valueNear(lines, start, "(?i)^zone$|^المنطقة$", true),
                extractZoneFromMixedLine(lines, start));
        String unitNo = valueNear(lines, start, "(?i)^unit\\s*no|^رقم الوحدة", false);
        String unitType = extractUnitType(lines, start);

        List<String> parts = new ArrayList<>();
        if (!unitType.isBlank()) {
            parts.add(unitType);
        }
        if (!unitNo.isBlank() && unitNo.matches("\\d{1,6}")) {
            parts.add("Unit " + unitNo);
        }
        if (!street.isBlank()) {
            parts.add(cleanAddressPart(street));
        }
        if (!zone.isBlank()) {
            parts.add(cleanAddressPart(zone));
        }
        return String.join(", ", parts);
    }

    private String extractZoneFromMixedLine(String[] lines, int from) {
        for (int i = from; i < Math.min(from + 50, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || DISCLAIMER_LINE.matcher(line).find()) {
                continue;
            }
            // Prefer explicit zone lines like "Alnakeel - النخيل" / "منطقة الحديبة - AL HODYBA"
            if (line.matches("(?i).*(zone|المنطقة|alnakeel|hodyba|hudaiba).*")
                    || (line.contains("-") && line.matches(".*[\\u0600-\\u06FF].*")
                    && line.matches(".*[A-Za-z]{3,}.*")
                    && !line.matches("(?i).*(shop|office|warehouse|store|unit).*"))) {
                String english = line;
                if (line.contains("-")) {
                    Matcher en = Pattern.compile("([A-Za-z][A-Za-z\\s]{2,})").matcher(line);
                    String last = "";
                    while (en.find()) {
                        last = en.group(1).trim();
                    }
                    if (!last.isBlank()) {
                        english = last;
                    }
                }
                english = cleanAddressPart(english);
                if (!english.isBlank() && !isOrgOrNoiseLine(english)
                        && !english.matches("(?i)^(shop|office|warehouse|store)$")
                        && !EN_NAME.matcher(latinizeOcrName(english)).matches()) {
                    return english;
                }
            }
            if (line.matches("(?i)^(al\\s+[a-z]+|alnakeel|aleurqub)$") && !isOrgOrNoiseLine(line)) {
                return line;
            }
        }
        return "";
    }

    private String cleanAddressPart(String value) {
        String cleaned = value
                .replaceAll("\\s*-\\s*[\\u0600-\\u06FF].*$", "")
                .replaceAll("(?i)\\bwith no signature\\b.*$", "")
                .replaceAll("(?i)\\bto validate\\b.*$", "")
                .replaceAll("\\s{2,}", " ")
                .trim();
        if (DISCLAIMER_LINE.matcher(cleaned).find() || isOrgOrNoiseLine(cleaned) || isNationality(cleaned)) {
            return "";
        }
        return cleaned;
    }

    private String extractUnitType(String[] lines, int from) {
        for (int i = from; i < Math.min(from + 40, lines.length); i++) {
            String line = lines[i].trim();
            if (line.matches("(?i).*\\b(shop|office|warehouse|store)\\b.*")) {
                // Prefer English token from mixed lines like "محل / متجر - Shop"
                Matcher matcher = Pattern.compile("(?i)\\b(shop|office|warehouse|store)\\b").matcher(line);
                if (matcher.find()) {
                    return capitalizeWords(matcher.group(1));
                }
            }
        }
        return "";
    }

    private String extractArabicAddress(String[] lines, boolean hasRealArabic) {
        if (!hasRealArabic) {
            return "";
        }
        int start = findLine(lines, "(?i)address\\s*&\\s*contact|العنوان");
        if (start < 0) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (int i = start + 1; i < Math.min(start + 50, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.toLowerCase(Locale.ROOT).startsWith("mobile") || line.contains("الجوال") || line.contains("المتحرك")) {
                break;
            }
            if (DISCLAIMER_LINE.matcher(line).find()) {
                continue;
            }
            if (!isRealArabicLine(line) && !(line.contains("-") && line.matches(".*[\\u0600-\\u06FF].*"))) {
                continue;
            }
            if (isArabicLabelOnly(line)) {
                continue;
            }
            String normalized = arabicTextProcessor.normalizeArabic(
                    line.contains("-") ? arabicTextProcessor.extractArabicText(line) : line);
            if (normalized.length() < 3) {
                continue;
            }
            if (normalized.contains("دائرة التنمية")
                    || normalized.contains("دايرة التنمية")
                    || normalized.contains("تعتبر هذه")
                    || normalized.contains("لمراجعة صحة")
                    || normalized.contains("النشاط")
                    || normalized.contains("ملاحظة")
                    || ARABIC_COMPANY_HINT.matcher(normalized).find()) {
                continue;
            }
            // Keep street/zone fragments only.
            if (normalized.contains("شارع") || normalized.contains("منطقة") || normalized.contains("حي")
                    || normalized.contains("مكتب") || normalized.contains("محل") || normalized.contains("غرفة")
                    || normalized.contains("الحديبة") || normalized.contains("النخيل")) {
                if (!parts.contains(normalized)) {
                    parts.add(normalized);
                }
            }
        }
        return String.join("، ", parts);
    }

    private String valueNear(String[] lines, int from, String labelPattern) {
        return valueNear(lines, from, labelPattern, true);
    }

    private String valueNear(String[] lines, int from, String labelPattern, boolean skipOrgNames) {
        int idx = -1;
        Pattern compiled = Pattern.compile(labelPattern);
        for (int i = from; i < lines.length; i++) {
            if (compiled.matcher(lines[i].trim()).find()) {
                idx = i;
                break;
            }
        }
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 10, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isLabel(line) || isLicenceTypeHeader(line)) {
                continue;
            }
            if (DISCLAIMER_LINE.matcher(line).find()) {
                continue;
            }
            if (isRealArabicLine(line)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z0-9].*")) {
                continue;
            }
            if (skipOrgNames && (isOrgOrNoiseLine(line) || looksLikePersonNameLine(line)
                    || isNationality(line) || MOBILE_INLINE.matcher(line).find())) {
                continue;
            }
            // Allow single-digit unit numbers like "5".
            if (line.matches("^\\d{1,6}$") || (line.matches(".*[A-Za-z0-9].*") && line.length() > 1)) {
                return line;
            }
        }
        // Some OCR layouts put the value above the English label.
        for (int i = idx - 1; i >= Math.max(from, idx - 4); i--) {
            String line = lines[i].trim();
            if (line.isEmpty() || isLabel(line) || isLicenceTypeHeader(line) || isRealArabicLine(line)) {
                continue;
            }
            if (DISCLAIMER_LINE.matcher(line).find()) {
                continue;
            }
            if (skipOrgNames && (isOrgOrNoiseLine(line) || looksLikePersonNameLine(line)
                    || isNationality(line) || MOBILE_INLINE.matcher(line).find())) {
                continue;
            }
            if (line.matches("^\\d{1,6}$") || (line.matches(".*[A-Za-z0-9].*") && line.length() > 1)) {
                return line;
            }
        }
        return "";
    }

    private boolean looksLikePersonNameLine(String line) {
        String latin = latinizeOcrName(line);
        // Full person names are typically ALL CAPS multi-token lines.
        return EN_NAME.matcher(latin).matches() && latin.equals(latin.toUpperCase(Locale.ROOT));
    }

    private boolean isOrgOrNoiseLine(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.contains("department of economic development")
                || lower.contains("government of ras al khaimah")
                || lower.contains("ras al khaimah chamber")
                || lower.contains("this document is considered")
                || lower.contains("with no signature")
                || lower.contains("to validate the license")
                || lower.equals("active")
                || lower.equals("p");
    }

    private String extractMobile(String text) {
        Matcher matcher = MOBILE.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        Matcher inline = MOBILE_INLINE.matcher(text);
        return inline.find() ? inline.group(1) : "";
    }

    private boolean isArabicLabelOnly(String line) {
        String normalized = arabicTextProcessor.normalizeArabic(line);
        return normalized.equals("الاسم")
                || normalized.equals("الجنسية")
                || normalized.equals("الصفة")
                || normalized.equals("العنوان")
                || normalized.equals("الشارع")
                || normalized.equals("المنطقة")
                || normalized.equals("رقم الرخصة")
                || normalized.equals("حالة الرخصة")
                || normalized.equals("الإسم التجاري")
                || normalized.equals("الاسم التجاري")
                || normalized.equals("الشكل القانوني")
                || normalized.equals("رقم الوحدة")
                || normalized.equals("المستثمر")
                || normalized.equals("الموقع")
                || normalized.equals("الالكتروني")
                || normalized.equals("الإلكتروني")
                || normalized.equals("فعالة")
                || normalized.contains("نوع الرخصة")
                || normalized.contains("الاسم التجاري")
                || normalized.contains("رقم السجل")
                || normalized.contains("رقم عضوية")
                || normalized.contains("رقم المتعامل")
                || normalized.contains("تاريخ التأسيس")
                || normalized.contains("تاريخ التجديد")
                || normalized.contains("تاريخ الانتهاء");
    }

    private boolean isLabel(String line) {
        String lower = line.toLowerCase(Locale.ROOT).replace(".", "").trim();
        return lower.equals("license number")
                || lower.equals("trade name")
                || lower.equals("legal form")
                || lower.equals("est date")
                || lower.equals("est. date")
                || lower.startsWith("local regist")
                || lower.startsWith("renewal date")
                || lower.startsWith("cbls")
                || lower.startsWith("expiry date")
                || lower.startsWith("coc membership")
                || lower.equals("business activity")
                || lower.startsWith("share percent")
                || lower.equals("role")
                || lower.equals("nationality")
                || lower.equals("name")
                || lower.equals("no")
                || lower.startsWith("address")
                || lower.equals("street")
                || lower.equals("zone")
                || lower.startsWith("unit no")
                || lower.equals("unit")
                || lower.startsWith("mobile")
                || lower.equals("website")
                || lower.equals("investor")
                || lower.equals("landlord")
                || lower.equals("active")
                || lower.equals("note:");
    }

    private boolean isMemberHeader(String line) {
        String lower = line.toLowerCase(Locale.ROOT).trim();
        String trimmed = line.trim();
        return lower.startsWith("share percent")
                || lower.equals("role")
                || lower.startsWith("role ")
                || lower.contains("الصفة")
                || lower.equals("nationality")
                || lower.startsWith("nationality")
                || lower.contains("الجنسية")
                || lower.equals("name")
                || lower.startsWith("name /")
                || lower.startsWith("name/")
                || trimmed.equals("الإسم")
                || trimmed.equals("الاسم")
                || lower.equals("no")
                || lower.startsWith("رقم المتعامل")
                || lower.startsWith("/");
    }

    private boolean isNationality(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("united arab emirates")
                || lower.equals("uae")
                || lower.equals("india")
                || lower.equals("pakistan")
                || lower.equals("egypt")
                || lower.equals("jordan")
                || lower.equals("saudi arabia")
                || lower.equals("oman")
                || lower.equals("bahrain")
                || lower.equals("kuwait")
                || lower.equals("qatar")
                || lower.equals("lebanon")
                || lower.equals("morocco")
                || lower.equals("philippines")
                || lower.equals("bangladesh")
                || lower.equals("syria")
                || lower.equals("yemen");
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

    private static String mappedOrEmpty(Map<String, String> map, String key) {
        if (key == null || key.isBlank()) {
            return "";
        }
        String direct = map.get(key);
        if (direct != null) {
            return direct;
        }
        for (Map.Entry<String, String> entry : map.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(key)) {
                return entry.getValue();
            }
        }
        return "";
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }
}
