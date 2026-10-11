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
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildSimpleJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

@Component
@RequiredArgsConstructor
@Slf4j
public class UmmAlQuwainFreeZoneTradeLicenceExtractor {

    private static final Pattern LICENSE_NO = Pattern.compile(
            "(?i)\\b([A-Z]{2,5}-[A-Z]{1,5}-\\d{2,6}|\\d{4,8})\\b");
    private static final Pattern TYPE = Pattern.compile(
            "(?i)TYPE\\s*OF\\s*LICENSE[^A-Za-z]{0,60}(Industrial|Commercial|Service|Professional|Media)");
    private static final Pattern COMPANY_TOKEN = Pattern.compile(
            "(?i)\\b([A-Z][A-Za-z0-9&.,'\\-\\s]{2,80}?\\s(?:FZE|FZCO|FZ-LLC|LLC))\\b");
    private static final Pattern CAPITAL = Pattern.compile("(?i)Share\\s*Capital.*?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)");
    private static final Pattern PO_BOX = Pattern.compile("(?i)P\\.?O\\.?\\s*Box\\s*(\\d{3,6})");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Za-z.'\\-]+(?:\\s+[A-Z][A-Za-z.'\\-]+){0,5}$");
    private static final Pattern SHARE_COUNT = Pattern.compile("^\\d{1,6}$");
    private static final Pattern CAPITAL_AMOUNT = Pattern.compile("^\\d{1,3}(?:,\\d{3})+(?:\\.\\d{2})?$");
    private static final String NATIONALITY_ALT =
            "Indian|Pakistani|Emirati|Egyptian|Jordanian|Filipino|Bangladeshi|British|American|"
                    + "Chinese|Syrian|Lebanese|Omani|Saudi|Sudanese|Yemeni|Moroccan|Tunisian|UAE";
    private static final Pattern NATIONALITY_LINE = Pattern.compile("(?i)^(" + NATIONALITY_ALT + ")$");
    private static final Pattern DENSE_PARTNER = Pattern.compile(
            "(?i)(?:^|[^0-9])(\\d{1,3})\\s*"
                    + "([A-Z][A-Za-z.'\\-]+(?:\\s+[A-Z][A-Za-z.'\\-]+){0,6}?)"
                    + "\\s*(" + NATIONALITY_ALT + ")"
                    + "\\s*(\\d{1,6})"
                    + "([\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\s٠-٩0-9]*)");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = splitLines(normalized);
        String compact = normalized.replace("\n", " ");
        boolean googleLayout = isGoogleOcrLayout(normalized);

        addIfNotEmpty(result, "licenseNo", extractLicenseNo(normalized, lines));
        addIfNotEmpty(result, "licenceType", extractLicenceType(normalized, lines));

        String company = extractCompany(lines, compact);
        addIfNotEmpty(result, "companyName", company);
        String operating = extractLabeledMultiLine(lines, "OPERATING NAME", "ADDRESS", "MANAGER", "ACTIVITY");
        if (operating.isBlank()) {
            operating = company;
        }
        addIfNotEmpty(result, "businessName", operating);
        addIfNotEmpty(result, "legalType", inferLegalType(company));

        String companyAr = extractCompanyNameAr(lines);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        String manager = extractLabeledMultiLine(lines, "MANAGER", "ACTIVITY", "ISSUE DATE", "VALID TILL");
        if (manager.isBlank()) {
            manager = extractManagerDense(compact);
        }
        addIfNotEmpty(result, "manager", manager);
        String managerAr = extractArabicAfterLabel(lines, "المدير", "النشاط", "تاريخ");
        if (managerAr.isBlank()) {
            managerAr = extractManagerArDense(compact);
        }
        addIfNotEmpty(result, "managerAr", managerAr);

        String[] dates = extractIssueAndExpiry(lines, compact);
        addIfNotEmpty(result, "issueDate", dates[0]);
        addIfNotEmpty(result, "expiryDate", dates[1]);
        addIfNotEmpty(result, "address", extractAddress(lines, compact));
        addIfNotEmpty(result, "poBox", firstGroup(PO_BOX, compact));

        List<String> enActivities = extractActivities(lines, compact, googleLayout);
        List<String> arActivities = extractArabicActivities(lines, enActivities.size());
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(enActivities, arActivities));

        List<Map<String, String>> members = extractPartners(normalized, lines, company, manager, managerAr);
        addIfNotEmpty(result, "licenseMembers", toPersonJson(members));

        String capital = firstGroup(CAPITAL, normalized);
        if (capital.isBlank()) {
            capital = findCapitalAmount(lines);
        }
        if (!capital.isBlank()) {
            Map<String, String> capitalDetails = new LinkedHashMap<>();
            capitalDetails.put("nominated", capital);
            capitalDetails.put("paid", capital);
            capitalDetails.put("currencyEn", "AED");
            addIfNotEmpty(result, "capitalDetails", buildSimpleJson(capitalDetails));
        }

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("UAQ Free Zone trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private boolean isGoogleOcrLayout(String text) {
        return text.contains("UMM AL QUWAIN FREE TRADE ZONE AUTHORITY")
                || (text.contains("Partners Name List") && text.contains("\nSerial No"));
    }

    private String[] splitLines(String text) {
        List<String> out = new ArrayList<>();
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (!t.isEmpty()) {
                out.add(t);
            }
        }
        return out.toArray(new String[0]);
    }

    private String extractLicenseNo(String text, String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].matches("(?i)LICENSE\\s*NO\\.?|License\\s*No\\s*:?")) {
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    Matcher m = LICENSE_NO.matcher(lines[j]);
                    if (m.find() && !CAPITAL_AMOUNT.matcher(lines[j]).matches()) {
                        return m.group(1);
                    }
                }
            }
        }
        Matcher m = Pattern.compile("(?i)LICENSE\\s*NO\\.?\\s*([A-Z]{2,5}-[A-Z]{1,5}-\\d{2,6}|\\d{4,8})").matcher(text);
        if (m.find()) {
            return m.group(1);
        }
        m = LICENSE_NO.matcher(text);
        return m.find() ? m.group(1) : "";
    }

    private String extractLicenceType(String text, String[] lines) {
        Matcher m = Pattern.compile(
                "(?i)TYPE\\s*OF\\s*LICENSE[^A-Za-z]{0,60}(Industrial|Commercial|Service|Professional|Media)")
                .matcher(text.replace("\n", " "));
        if (m.find()) {
            return capitalizeWords(m.group(1));
        }
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toUpperCase(Locale.ROOT).contains("TYPE OF LICENSE")) {
                Matcher inline = Pattern.compile("(?i)(Industrial|Commercial|Service|Professional|Media)")
                        .matcher(lines[i]);
                if (inline.find()) {
                    return capitalizeWords(inline.group(1));
                }
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    if (lines[j].matches("(?i)Industrial|Commercial|Service|Professional|Media")) {
                        return capitalizeWords(lines[j]);
                    }
                    inline = Pattern.compile("(?i)(Industrial|Commercial|Service|Professional|Media)")
                            .matcher(lines[j]);
                    if (inline.find()) {
                        return capitalizeWords(inline.group(1));
                    }
                }
            }
        }
        return "";
    }

    private String extractCompany(String[] lines, String compact) {
        String labeled = extractLabeledMultiLine(lines, "LICENSEE", "OPERATING NAME", "ADDRESS", "MANAGER");
        if (!labeled.isBlank()) {
            return labeled;
        }
        labeled = extractLabeledMultiLine(lines, "Company Name", "Share Capital", "Partners Name List");
        if (!labeled.isBlank()) {
            return labeled;
        }
        Matcher m = COMPANY_TOKEN.matcher(compact);
        return m.find() ? m.group(1).replaceAll("\\s{2,}", " ").trim() : "";
    }

    private String extractLabeledMultiLine(String[] lines, String startLabel, String... stopLabels) {
        int start = findExact(lines, startLabel);
        if (start < 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = start + 1; i < lines.length; i++) {
            String line = lines[i];
            if (isStopLabel(line, stopLabels) || isExactLabel(line)) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (line.matches("(?i)UMM AL QUWAIN FREE TRADE ZONE AUTHORITY|GOVERNMENT OF UMM")
                    || line.equalsIgnoreCase("UAQ") || line.equalsIgnoreCase("FREE TRADE ZONE")
                    || line.equalsIgnoreCase("LICENSE") || line.equalsIgnoreCase("REMARKS")) {
                break;
            }
            if (line.matches(".*[A-Za-z0-9].*")) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(line.replaceFirst("^[-–]\\s*", "").trim());
            }
            // Company / manager names are usually 1–3 lines.
            if (sb.length() > 90) {
                break;
            }
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private String extractManagerDense(String compact) {
        // Case-sensitive name tokens — (?i) would let [a-z] eat glued activity words (SampathPorts).
        Matcher m = Pattern.compile(
                "المدير\\s*([A-Z][a-z'.\\-]+(?:\\s+[A-Z][a-z'.\\-]+){0,4})"
                        + "(?=[A-Z]|[\\u0600-\\u06FF]|ACTIVITY|$)")
                .matcher(compact);
        if (m.find()) {
            return m.group(1).trim();
        }
        m = Pattern.compile(
                "(?i)MANAGER(?-i:[^A-Za-z]{0,80}?([A-Z][a-z'.\\-]+(?:\\s+[A-Z][a-z'.\\-]+){0,4}))"
                        + "(?=Core\\s+Paper|Ports\\s+and|Oilfield|Sea\\s+Cleaning|Timber|Paper\\s+|"
                        + "ACTIVITY|ISSUE|[\\u0600-\\u06FF]|[A-Z][a-z]*(?:Ports|Trading|Manufacturing))",
                Pattern.CASE_INSENSITIVE)
                .matcher(compact);
        if (m.find()) {
            return m.group(1).trim();
        }
        m = Pattern.compile(
                "MANAGER[^A-Za-z]{0,80}?([A-Z][a-z'.\\-]+(?:\\s+[A-Z][a-z'.\\-]+){0,4})",
                Pattern.CASE_INSENSITIVE)
                .matcher(compact);
        return m.find() ? m.group(1).trim() : "";
    }

    /** Dense OCR places Arabic manager name between MANAGER and المدير. */
    private String extractManagerArDense(String compact) {
        Matcher m = Pattern.compile(
                "(?i)MANAGER\\s*([\\u0600-\\u06FF][\\u0600-\\u06FF\\s]{1,60}?)\\s*المدير")
                .matcher(compact);
        if (m.find()) {
            String ar = arabicTextProcessor.normalizeArabic(m.group(1).trim());
            if (ar.length() >= 3) {
                return ar;
            }
        }
        m = Pattern.compile(
                "المدير\\s*([\\u0600-\\u06FF][\\u0600-\\u06FF\\s]{1,60}?)(?=[A-Za-z]|النشاط|$)")
                .matcher(compact);
        if (m.find()) {
            String ar = arabicTextProcessor.normalizeArabic(m.group(1).trim());
            if (ar.length() >= 3) {
                return ar;
            }
        }
        return "";
    }

    private String[] extractIssueAndExpiry(String[] lines, String compact) {
        int issueIdx = findExact(lines, "ISSUE DATE");
        int validIdx = findExact(lines, "VALID TILL");
        List<String> dates = new ArrayList<>();
        // Google OCR often stacks ISSUE DATE / VALID TILL then dumps both dates.
        if (issueIdx >= 0 && validIdx >= 0 && Math.abs(validIdx - issueIdx) <= 2) {
            int from = Math.max(issueIdx, validIdx) + 1;
            for (int i = from; i < Math.min(from + 8, lines.length); i++) {
                String d = firstDate(lines[i]);
                if (!d.isEmpty()) {
                    dates.add(normalizeDate(d));
                }
                if (dates.size() >= 2) {
                    break;
                }
            }
        }
        if (dates.size() >= 2) {
            return new String[]{dates.get(0), dates.get(1)};
        }
        String issue = "";
        String expiry = "";
        if (issueIdx >= 0) {
            for (int i = issueIdx; i < Math.min(issueIdx + 5, lines.length); i++) {
                String d = firstDate(lines[i]);
                if (!d.isEmpty()) {
                    issue = normalizeDate(d);
                    break;
                }
            }
        }
        if (validIdx >= 0) {
            for (int i = validIdx; i < Math.min(validIdx + 5, lines.length); i++) {
                String d = firstDate(lines[i]);
                if (!d.isEmpty() && !d.equals(issue.replace("-", "/")) && !normalizeDate(d).equals(issue)) {
                    expiry = normalizeDate(d);
                    break;
                }
            }
            // If VALID TILL picked the same first date as ISSUE in a dump, take the second date.
            if (expiry.isBlank() || expiry.equals(issue)) {
                int seen = 0;
                for (int i = validIdx; i < Math.min(validIdx + 8, lines.length); i++) {
                    String d = firstDate(lines[i]);
                    if (d.isEmpty()) {
                        continue;
                    }
                    seen++;
                    if (seen >= 2) {
                        expiry = normalizeDate(d);
                        break;
                    }
                }
            }
        }
        if (issue.isBlank()) {
            Matcher m = Pattern.compile("(?i)ISSUE\\s*DATE[^0-9]{0,80}(\\d{1,2}/\\d{1,2}/\\d{4})").matcher(compact);
            if (m.find()) {
                issue = normalizeDate(m.group(1));
            }
        }
        if (expiry.isBlank()) {
            Matcher m = Pattern.compile("(?i)VALID\\s*TILL[^0-9]{0,80}(\\d{1,2}/\\d{1,2}/\\d{4})").matcher(compact);
            if (m.find()) {
                expiry = normalizeDate(m.group(1));
            }
        }
        return new String[]{issue, expiry};
    }

    private String extractAddress(String[] lines, String compact) {
        String labeled = extractLabeledMultiLine(lines, "ADDRESS", "MANAGER", "ACTIVITY", "ISSUE DATE");
        if (!labeled.isBlank()) {
            return labeled.replaceAll("(?i)\\bP\\.O\\.?\\s*Box\\s*\\d+\\s*", "").replaceAll("\\s{2,}", " ").trim()
                    .isBlank() ? labeled : labeled;
        }
        Matcher matcher = Pattern.compile("(?i)ADDRESS\\s*(.+?)(?=MANAGER|العنوان)").matcher(compact);
        if (!matcher.find()) {
            return "";
        }
        return matcher.group(1)
                .replaceAll("[\\u0600-\\u06FF]+", " ")
                .replaceAll("\\s{2,}", " ")
                .replaceAll("(?i)\\b(MANAGER|ACTIVITY|ISSUE).*$", "")
                .trim();
    }

    private List<String> extractActivities(String[] lines, String compact, boolean googleLayout) {
        List<String> activities = new ArrayList<>();
        int start = findExact(lines, "ACTIVITY");
        int end = findExact(lines, "ISSUE DATE");
        if (end < 0) {
            end = findExact(lines, "VALID TILL");
        }
        if (start >= 0) {
            if (end < 0 || end <= start) {
                end = Math.min(start + 20, lines.length);
            }
            StringBuilder current = new StringBuilder();
            for (int i = start + 1; i < end; i++) {
                String line = lines[i].trim();
                if (line.isEmpty() || isExactLabel(line)) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                    continue;
                }
                if (line.matches("(?i)UMM AL QUWAIN FREE TRADE ZONE AUTHORITY|REMARKS|LICENSE")) {
                    break;
                }
                boolean dashed = line.matches("^[-–].*");
                String cleaned = line.replaceFirst("^[-–]\\s*", "").trim();
                if (cleaned.length() < 3) {
                    continue;
                }
                if (current.length() > 0 && isEnglishActivityContinuation(cleaned)) {
                    current.append(' ').append(cleaned);
                    if (isCompleteEnglishActivity(current.toString())) {
                        activities.add(normalizeActivityEn(current.toString()));
                        current.setLength(0);
                    }
                    continue;
                }
                if (current.length() > 0) {
                    activities.add(normalizeActivityEn(current.toString()));
                    current.setLength(0);
                }
                // A new dashed item always starts a fresh activity.
                if (dashed || isCompleteEnglishActivity(cleaned)) {
                    if (isCompleteEnglishActivity(cleaned)) {
                        activities.add(normalizeActivityEn(cleaned));
                    } else {
                        current.append(cleaned);
                    }
                } else {
                    current.append(cleaned);
                }
            }
            if (current.length() > 0) {
                activities.add(normalizeActivityEn(current.toString()));
            }
        }
        if (!activities.isEmpty()) {
            return activities;
        }
        return extractActivitiesDense(compact);
    }

    private boolean isEnglishActivityContinuation(String line) {
        return line.matches("(?i)^(and|or|of|for|with|&)\\b.*")
                || line.matches("(?i)^(Trading|Manufacturing|Services?|Equipment|Parts)(\\s+.*)?$")
                || line.matches("^[a-z].*");
    }

    private boolean isCompleteEnglishActivity(String text) {
        return text != null && text.matches("(?i).*\\b(Trading|Manufacturing|Services)\\b.*");
    }

    private String normalizeActivityEn(String text) {
        return text.replaceAll("\\s{2,}", " ").trim();
    }

    private List<String> extractActivitiesDense(String compact) {
        LinkedHashSet<String> activities = new LinkedHashSet<>();
        Matcher region = Pattern.compile(
                "المدير\\s*[A-Z][a-z'.\\-]+(?:\\s+[A-Z][a-z'.\\-]+){0,4}(.+?)(?=النشاط|ACTIVITY)")
                .matcher(compact);
        String block = region.find() ? region.group(1) : "";
        if (block.isBlank()) {
            region = Pattern.compile(
                    "MANAGER[^A-Za-z]{0,80}?[A-Z][a-z'.\\-]+(?:\\s+[A-Z][a-z'.\\-]+){0,4}(.+?)(?=النشاط|ACTIVITY)",
                    Pattern.CASE_INSENSITIVE)
                    .matcher(compact);
            if (region.find()) {
                block = region.group(1);
            }
        }
        if (block.isBlank()) {
            return List.of();
        }
        for (String part : block.split("\\s*--\\s*")) {
            String cleaned = part.replaceAll("[\\u0600-\\u06FF]+", " ")
                    .replaceAll("[()]+", " ")
                    .replaceAll("\\s{2,}", " ")
                    .trim();
            if (cleaned.length() < 6) {
                continue;
            }
            Matcher en = Pattern.compile(
                    "(?i)([A-Z][A-Za-z0-9&.,'/\\-]+(?:\\s+[A-Za-z0-9&.,'/\\-]+){0,12}?"
                            + "\\s*(?:Trading|Manufacturing|Services))")
                    .matcher(cleaned);
            String best = "";
            while (en.find()) {
                String candidate = en.group(1).replaceAll("\\s{2,}", " ").trim();
                if (candidate.length() > best.length()) {
                    best = candidate;
                }
            }
            if (best.length() >= 6
                    && !best.toLowerCase(Locale.ROOT).contains("manager")
                    && !best.toLowerCase(Locale.ROOT).contains("license")
                    && !best.toLowerCase(Locale.ROOT).contains("address")
                    && !best.toLowerCase(Locale.ROOT).contains("operating")
                    && !best.toLowerCase(Locale.ROOT).contains("serial")) {
                activities.add(best);
            }
        }
        return new ArrayList<>(activities);
    }

    /**
     * Arabic activities under النشاط. Merges parenthetical / wrapped continuations, then
     * trims surplus rows to the English activity count (same bilingual list length).
     */
    private List<String> extractArabicActivities(String[] lines, int enCount) {
        List<String> raw = new ArrayList<>();
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].equals("النشاط") || lines[i].startsWith("النشاط")) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return List.of();
        }
        for (int i = start + 1; i < Math.min(start + 16, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("تاريخ") || line.contains("ملاحظات") || isExactLabel(line)
                    || line.contains("WWW.") || line.contains("سلطة منطقة")) {
                break;
            }
            if (!arabicTextProcessor.containsArabic(line)) {
                continue;
            }
            String ar = line.replaceFirst("^[-–]\\s*", "").trim();
            if (ar.length() >= 2) {
                raw.add(ar);
            }
        }
        List<String> merged = mergeArabicActivityFragments(raw);
        return alignArabicActivityCount(merged, enCount);
    }

    private List<String> mergeArabicActivityFragments(List<String> raw) {
        List<String> out = new ArrayList<>();
        for (String line : raw) {
            if (out.isEmpty()) {
                out.add(line);
                continue;
            }
            String prev = out.get(out.size() - 1);
            if (isArabicActivityContinuation(line, prev)) {
                out.set(out.size() - 1, joinArabicActivityParts(prev, line));
            } else {
                out.add(line);
            }
        }
        List<String> normalized = new ArrayList<>();
        for (String item : out) {
            String cleaned = arabicTextProcessor.normalizeArabic(
                    item.replaceAll("[()]+", " ").replaceAll("\\s{2,}", " ").trim());
            if (cleaned.length() >= 3) {
                normalized.add(cleaned);
            }
        }
        return normalized;
    }

    private boolean isArabicActivityContinuation(String line, String previous) {
        String t = line.trim();
        String prev = previous == null ? "" : previous.trim();
        if (prev.isEmpty()) {
            return false;
        }
        long open = prev.chars().filter(ch -> ch == '(').count();
        long close = prev.chars().filter(ch -> ch == ')').count();
        if (open > close) {
            return true;
        }
        // OCR often drops '(': ".... المقوى )" then "الكرتون )"
        if (t.matches("^\\)?[\\u0600-\\u06FF\\s./-]{1,40}\\)\\s*$")
                && arabicLetterCount(t) <= 12) {
            return true;
        }
        if (prev.matches(".*\\)\\s*$") && !prev.contains("(")
                && t.matches(".*\\)\\s*$") && arabicLetterCount(t) <= 12) {
            return true;
        }
        return false;
    }

    private String joinArabicActivityParts(String left, String right) {
        String a = left.replaceAll("[()]+", " ").replaceAll("\\s{2,}", " ").trim();
        String b = right.replaceAll("[()]+", " ").replaceAll("\\s{2,}", " ").trim();
        if (b.isBlank()) {
            return a;
        }
        if (a.isBlank()) {
            return b;
        }
        // Parenthetical remnant → keep as "main (detail)"
        if (arabicLetterCount(b) <= 12 && !b.contains(" ")) {
            return (a + " (" + b + ")").replaceAll("\\s{2,}", " ").trim();
        }
        return (a + " " + b).replaceAll("\\s{2,}", " ").trim();
    }

    private int arabicLetterCount(String text) {
        int n = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= '\u0600' && c <= '\u06FF') {
                n++;
            }
        }
        return n;
    }

    /**
     * When Arabic OCR splits one activity across lines, surplus rows are merged into the
     * previous row until the list length matches the English ACTIVITY count.
     * Prefer the largest length-gap (long line + short continuation) so a short peer activity
     * like a final list item is not absorbed before a true wrap fragment.
     */
    private List<String> alignArabicActivityCount(List<String> arabic, int enCount) {
        if (arabic.isEmpty() || enCount <= 0 || arabic.size() <= enCount) {
            return arabic;
        }
        List<String> out = new ArrayList<>(arabic);
        while (out.size() > enCount && out.size() >= 2) {
            int mergeIdx = -1;
            int bestGap = Integer.MIN_VALUE;
            for (int i = 1; i < out.size(); i++) {
                int gap = out.get(i - 1).length() - out.get(i).length();
                if (gap > bestGap) {
                    bestGap = gap;
                    mergeIdx = i;
                }
            }
            if (mergeIdx <= 0) {
                break;
            }
            // Require a real wrap (continuation shorter than previous).
            if (bestGap <= 0) {
                break;
            }
            out.set(mergeIdx - 1, joinArabicActivityParts(out.get(mergeIdx - 1), out.get(mergeIdx)));
            out.remove(mergeIdx);
        }
        return out;
    }

    private List<Map<String, String>> extractPartners(String text, String[] lines,
                                                      String company, String manager, String managerAr) {
        List<Map<String, String>> people = extractPartnersGoogleLayout(lines, company);
        if (people.isEmpty()) {
            people = extractPartnersDense(text);
        }
        if (people.isEmpty() && manager != null && !manager.isBlank()) {
            Map<String, String> person = new LinkedHashMap<>();
            person.put("nameEn", manager);
            if (managerAr != null && !managerAr.isBlank()) {
                person.put("nameAr", managerAr);
            }
            person.put("role", "Manager");
            people.add(person);
        } else if (!people.isEmpty() && manager != null && !manager.isBlank()) {
            for (Map<String, String> person : people) {
                if (namesLikelySame(person.get("nameEn"), manager)) {
                    if ((person.get("nameAr") == null || person.get("nameAr").isBlank())
                            && managerAr != null && !managerAr.isBlank()) {
                        person.put("nameAr", managerAr);
                    }
                    String role = person.getOrDefault("role", "Partner");
                    if (!role.toLowerCase(Locale.ROOT).contains("manager")) {
                        person.put("role", role + " / Manager");
                    }
                    break;
                }
            }
        }
        return people;
    }

    /**
     * Google OCR partners page: Serial No → nameEn → nameAr → later Nationality / No. of Shares values.
     */
    private List<Map<String, String>> extractPartnersGoogleLayout(String[] lines, String company) {
        List<Map<String, String>> people = new ArrayList<>();
        int start = findContains(lines, "Partners Name List");
        if (start < 0) {
            start = findExact(lines, "Serial No");
        }
        if (start < 0) {
            return people;
        }

        int serialIdx = -1;
        for (int i = start; i < Math.min(start + 20, lines.length); i++) {
            if (lines[i].matches("^\\d{1,3}$")) {
                serialIdx = i;
                break;
            }
        }
        if (serialIdx < 0) {
            return people;
        }

        String nameEn = "";
        String nameAr = "";
        String nationality = "";
        String share = "";
        String companyUpper = company == null ? "" : company.toUpperCase(Locale.ROOT);

        for (int i = serialIdx + 1; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.matches("(?i)UMM AL QUWAIN FREE TRADE ZONE AUTHORITY")
                    && (!nameEn.isBlank() || !nameAr.isBlank())
                    && (!nationality.isBlank() || !share.isBlank())) {
                break;
            }
            if (line.equalsIgnoreCase("Name") || line.equalsIgnoreCase("Nationality")
                    || line.equals("الجنسية") || line.equals("الإسم") || line.equals("الاسم")
                    || line.equalsIgnoreCase("Serial No") || line.contains("رقم المسلسل")
                    || line.equalsIgnoreCase("UAQ") || line.equalsIgnoreCase("FREE TRADE ZONE")
                    || line.equalsIgnoreCase("LICENSE") || line.equalsIgnoreCase("GOVERNMENT OF UMM AL QUWAIN")
                    || line.contains("WWW.") || line.contains("سلطة منطقة") || line.contains("هذه الوثيقة")
                    || line.contains("رأس المال") || line.contains("كشف أسماء")
                    || line.contains("رقم الرخصة") || line.contains("إسم الشركة") || line.contains("اسم الشركة")) {
                continue;
            }
            if (LICENSE_NO.matcher(line).matches() || CAPITAL_AMOUNT.matcher(line).matches()
                    || line.matches("^[۰-۹٠-٩,\\.\\s]+$")) {
                continue;
            }
            if (line.equalsIgnoreCase("No. of Shares") || line.contains("عدد الحصص")
                    || line.equalsIgnoreCase("Share Capital") || line.equalsIgnoreCase("Partners Name List")
                    || line.equalsIgnoreCase("Company Name :") || line.equalsIgnoreCase("License No:")
                    || line.equalsIgnoreCase("FZE") || line.equalsIgnoreCase("FZCO")) {
                continue;
            }
            // Skip company name fragments.
            if (!companyUpper.isBlank()
                    && (companyUpper.contains(line.toUpperCase(Locale.ROOT))
                    || line.toUpperCase(Locale.ROOT).contains(companyUpper.split("\\s+")[0]))) {
                if (line.toUpperCase(Locale.ROOT).contains("FZE")
                        || line.toUpperCase(Locale.ROOT).contains("PRODUCTS")
                        || line.toUpperCase(Locale.ROOT).contains("MARINE")
                        || line.split("\\s+").length >= 2) {
                    continue;
                }
            }

            if (NATIONALITY_LINE.matcher(line).matches()) {
                if (nationality.isBlank()) {
                    nationality = capitalizeWords(line);
                }
                continue;
            }
            if (line.equals("هندي") || line.equals("باكستاني") || line.equals("إماراتي") || line.equals("اماراتي")
                    || line.equals("مصري")) {
                continue;
            }
            if (SHARE_COUNT.matcher(line).matches()) {
                // Prefer share counts that appear near/after No. of Shares; avoid serial repeats.
                if (share.isBlank() && !line.equals("1")) {
                    share = line;
                }
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                String ar = arabicTextProcessor.normalizeArabic(line);
                if (ar.length() >= 3 && nameAr.isBlank()
                        && !ar.contains("هندي") && !ar.contains("الحصص") && !ar.contains("الجنسية")) {
                    nameAr = ar;
                }
                continue;
            }
            if (EN_NAME.matcher(line).matches() || line.matches("^[A-Z][A-Za-z.'\\-\\s]{2,}$")) {
                if (nameEn.isBlank()
                        && !line.equalsIgnoreCase("Indian")
                        && !line.equalsIgnoreCase("Name")
                        && !line.equalsIgnoreCase("Nationality")) {
                    nameEn = line.replaceAll("\\s{2,}", " ").trim();
                }
            }
        }

        // Second pass: share after No. of Shares heading if still blank.
        if (share.isBlank()) {
            int sharesIdx = findContains(lines, "No. of Shares");
            if (sharesIdx < 0) {
                sharesIdx = findContains(lines, "عدد الحصص");
            }
            if (sharesIdx >= 0) {
                for (int i = sharesIdx + 1; i < Math.min(sharesIdx + 10, lines.length); i++) {
                    if (SHARE_COUNT.matcher(lines[i]).matches() && !lines[i].equals("1")) {
                        share = lines[i];
                        break;
                    }
                }
            }
        }
        if (nationality.isBlank()) {
            int natIdx = findExact(lines, "Nationality");
            if (natIdx >= 0) {
                for (int i = natIdx + 1; i < Math.min(natIdx + 15, lines.length); i++) {
                    if (NATIONALITY_LINE.matcher(lines[i]).matches()) {
                        nationality = capitalizeWords(lines[i]);
                        break;
                    }
                }
            }
            if (nationality.isBlank()) {
                for (String line : lines) {
                    if (NATIONALITY_LINE.matcher(line).matches()) {
                        nationality = capitalizeWords(line);
                        break;
                    }
                }
            }
        }

        if (!nameEn.isBlank() || !nameAr.isBlank()) {
            Map<String, String> person = new LinkedHashMap<>();
            if (!nameEn.isBlank()) {
                person.put("nameEn", nameEn);
            }
            if (!nameAr.isBlank()) {
                person.put("nameAr", nameAr);
            }
            if (!nationality.isBlank()) {
                person.put("nationality", nationality);
            }
            if (!share.isBlank()) {
                person.put("share", share);
            }
            person.put("role", "Partner");
            people.add(person);
        }
        return people;
    }

    private List<Map<String, String>> extractPartnersDense(String text) {
        List<Map<String, String>> people = new ArrayList<>();
        String block = text;
        int idx = indexOfIgnoreCase(text, "Partners Name List");
        if (idx >= 0) {
            block = text.substring(idx);
        }
        Matcher matcher = DENSE_PARTNER.matcher(block.replace("\n", " "));
        while (matcher.find()) {
            Map<String, String> person = new LinkedHashMap<>();
            person.put("nameEn", matcher.group(2).trim().replaceAll("\\s{2,}", " "));
            String nameAr = extractPartnerArabicNameDense(matcher.group(5));
            if (!nameAr.isBlank()) {
                person.put("nameAr", nameAr);
            }
            person.put("nationality", capitalizeWords(matcher.group(3).trim()));
            person.put("share", matcher.group(4).trim());
            person.put("role", "Partner");
            people.add(person);
        }
        return people;
    }

    private String extractPartnerArabicNameDense(String arabicTail) {
        if (arabicTail == null || arabicTail.isBlank()) {
            return "";
        }
        String cleaned = arabicTail
                .replaceAll("[0-9٠-٩]+", " ")
                .replaceAll("(هندي|باكستاني|اماراتي|إماراتي|مصري)(?=[\\u0600-\\u06FF]|$)", " ")
                .replaceAll("\\s{2,}", " ")
                .trim();
        cleaned = arabicTextProcessor.normalizeArabic(cleaned);
        List<String> words = new ArrayList<>();
        for (String part : cleaned.split("\\s+")) {
            if (part.length() >= 2) {
                words.add(part);
            }
        }
        if (words.isEmpty()) {
            return "";
        }
        StringBuilder joined = new StringBuilder();
        for (int i = words.size() - 1; i >= 0; i--) {
            if (joined.length() > 0) {
                joined.append(' ');
            }
            joined.append(words.get(i));
        }
        return joined.toString();
    }

    private String extractCompanyNameAr(String[] lines) {
        // Prefer trade name — Google OCR stacks رقم/نوع/صاحب values, so صاحب الرخصة
        // often lands on the licence number or licence type before the company name.
        String ar = extractArabicCompanyCandidate(lines, "الإسم التجاري", "الاسم التجاري");
        if (!ar.isBlank()) {
            return ar;
        }
        return extractArabicCompanyCandidate(lines, "صاحب الرخصة");
    }

    private String extractArabicCompanyCandidate(String[] lines, String... labels) {
        for (String label : labels) {
            int start = -1;
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].contains(label)) {
                    start = i;
                    break;
                }
            }
            if (start < 0) {
                continue;
            }
            for (int i = start + 1; i < Math.min(start + 8, lines.length); i++) {
                String line = lines[i].trim();
                if (line.contains("العنوان") || line.contains("المدير") || line.contains("النشاط")
                        || line.contains("تاريخ") || isExactLabel(line)) {
                    break;
                }
                if (line.contains("الإسم التجاري") || line.contains("الاسم التجاري")
                        || line.contains("صاحب الرخصة") || line.contains("رقم الرخصة")
                        || line.contains("نوع الرخصة")) {
                    continue;
                }
                if (!isPlausibleArabicCompanyName(line)) {
                    continue;
                }
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private boolean isPlausibleArabicCompanyName(String line) {
        if (line == null || line.length() < 4 || !arabicTextProcessor.containsArabic(line)) {
            return false;
        }
        if (line.matches(".*[A-Za-z]{3,}.*")) {
            return false;
        }
        // Licence numbers / dates as Eastern Arabic digits.
        if (line.matches("^[0-9٠-٩\\s./\\-]+$")) {
            return false;
        }
        if (line.matches("^(تجارية|صناعية|مهنية|سياحية|حرة)$")) {
            return false;
        }
        return true;
    }

    private String extractArabicAfterLabel(String[] lines, String label, String... stopLabels) {
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
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")
                    && line.length() >= 3) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String findCapitalAmount(String[] lines) {
        for (String line : lines) {
            if (CAPITAL_AMOUNT.matcher(line).matches()) {
                return line;
            }
        }
        return "";
    }

    private String inferLegalType(String company) {
        String upper = company == null ? "" : company.toUpperCase(Locale.ROOT);
        if (upper.contains("FZE")) {
            return "Free Zone Establishment";
        }
        if (upper.contains("FZCO") || upper.contains("FZ-LLC")) {
            return "Free Zone Company";
        }
        if (upper.contains("LLC")) {
            return "Limited Liability Company";
        }
        return "";
    }

    private boolean namesLikelySame(String a, String b) {
        if (a == null || b == null || a.isBlank() || b.isBlank()) {
            return false;
        }
        String left = a.toUpperCase(Locale.ROOT).replaceAll("[^A-Z\\s]", " ").replaceAll("\\s+", " ").trim();
        String right = b.toUpperCase(Locale.ROOT).replaceAll("[^A-Z\\s]", " ").replaceAll("\\s+", " ").trim();
        if (left.equals(right)) {
            return true;
        }
        String[] la = left.split(" ");
        String[] lb = right.split(" ");
        return la.length > 0 && lb.length > 0
                && la[0].equals(lb[0])
                && la[la.length - 1].equals(lb[lb.length - 1]);
    }

    private String firstGroup(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).trim() : "";
    }

    private int findExact(String[] lines, String label) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].equalsIgnoreCase(label) || lines[i].equalsIgnoreCase(label + ":")
                    || lines[i].equalsIgnoreCase(label + " :")) {
                return i;
            }
        }
        return -1;
    }

    private int findContains(String[] lines, String label) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase(Locale.ROOT).contains(label.toLowerCase(Locale.ROOT))) {
                return i;
            }
        }
        return -1;
    }

    private int indexOfIgnoreCase(String text, String needle) {
        return text.toLowerCase(Locale.ROOT).indexOf(needle.toLowerCase(Locale.ROOT));
    }

    private boolean isStopLabel(String line, String... stopLabels) {
        for (String s : stopLabels) {
            if (line.equalsIgnoreCase(s) || line.equalsIgnoreCase(s + ":")
                    || line.equalsIgnoreCase(s + " :")) {
                return true;
            }
        }
        return false;
    }

    private boolean isExactLabel(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("license no.") || lower.equals("license no")
                || lower.equals("type of license") || lower.equals("licensee")
                || lower.equals("operating name") || lower.equals("address")
                || lower.equals("manager") || lower.equals("activity")
                || lower.equals("issue date") || lower.equals("valid till")
                || lower.equals("remarks") || lower.equals("partners name list")
                || lower.equals("serial no") || lower.equals("name")
                || lower.equals("nationality") || lower.equals("no. of shares")
                || lower.equals("share capital") || lower.equals("company name")
                || lower.equals("company name :") || lower.equals("license no:");
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
