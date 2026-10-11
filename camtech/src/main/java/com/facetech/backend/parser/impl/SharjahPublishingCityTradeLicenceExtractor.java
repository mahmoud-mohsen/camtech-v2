package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.HeadingSectionSupport.hasArabicLetters;
import static com.facetech.backend.parser.impl.HeadingSectionSupport.hasLatinLetters;
import static com.facetech.backend.parser.impl.HeadingSectionSupport.splitLines;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.escape;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * Sharjah Publishing City (SPC) Free Zone business licences.
 *
 * <p>The printed licence is a two-column EN/AR form (label + value per row) followed by an
 * activity table with three columns: English name, activity code, Arabic name. Google Document AI
 * emits the English column, the code column and the Arabic column as separate runs, and wraps long
 * activity names over several lines. Everything here is located by the printed labels and by
 * layout cues (codes as row anchors, wrap/continuation cues, page boundaries, column lengths);
 * no company, person or activity value is hard-coded.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SharjahPublishingCityTradeLicenceExtractor {

    // ---- printed labels of the SPC template (EN column / AR column) ----
    private static final String[] EN_LICENSE_NO = {"License No", "Licence No"};
    private static final String[] EN_COMPANY = {"Company Name"};
    private static final String[] EN_FORMATION_TYPE = {"Formation Type"};
    private static final String[] EN_FORMATION_NO = {"Formation Number", "Formation No"};
    private static final String[] EN_ADDRESS = {"Company Address"};
    private static final String[] EN_FORMATION_DATE = {"License Formation Date", "Licence Formation Date"};
    private static final String[] EN_EXPIRY_DATE = {"License Expiry Date", "Licence Expiry Date"};
    private static final String[] EN_MANAGER = {"Manager(s)", "Managers", "Manager"};
    private static final String[] EN_ACTIVITY = {"Activity(s)", "Activities", "Activity"};
    private static final String[] EN_CODE = {"Code"};

    private static final String[] AR_LICENSE_NO = {"رخصة تجارية", "رقم الرخصة"};
    private static final String[] AR_COMPANY = {"اسم الشركة"};
    private static final String[] AR_FORMATION_TYPE = {"نوع التأسيس"};
    private static final String[] AR_FORMATION_NO = {"رقم التأسيس"};
    private static final String[] AR_ADDRESS = {"عنوان الشركة"};
    private static final String[] AR_FORMATION_DATE = {"تاريخ تأسيس الرخصة", "تاريخ التأسيس"};
    private static final String[] AR_EXPIRY_DATE = {"تاريخ الانتهاء", "تاريخ الإنتهاء"};
    private static final String[] AR_MANAGER = {"المدير", "المديرون"};
    private static final String[] AR_ACTIVITY = {"النشاط", "الأنشطة"};

    private static final String[][] ALL_LABELS = {
            EN_LICENSE_NO, EN_COMPANY, EN_FORMATION_TYPE, EN_FORMATION_NO, EN_ADDRESS, EN_FORMATION_DATE,
            EN_EXPIRY_DATE, EN_MANAGER, EN_ACTIVITY, EN_CODE,
            AR_LICENSE_NO, AR_COMPANY, AR_FORMATION_TYPE, AR_FORMATION_NO, AR_ADDRESS, AR_FORMATION_DATE,
            AR_EXPIRY_DATE, AR_MANAGER, AR_ACTIVITY
    };

    /** Footer sentence that opens the verification block printed at the bottom of every page. */
    private static final String[] FOOTER_MARKERS = {"approved electronic document", "وثيقة إلكترونية", "وثيقة الكترونية"};

    /** Activity codes (ISIC style, e.g. 4690 / 4690.01), alone on a line or trailing an English line. */
    private static final Pattern CODE_ONLY = Pattern.compile("\\d{4}(?:\\.\\d{1,3})?");
    private static final Pattern TRAILING_CODE = Pattern.compile("^(.*?[A-Za-z].*?)\\s+(\\d{4}(?:\\.\\d{1,3})?)$");
    private static final Pattern DECIMAL_NO = Pattern.compile("\\d{4,12}\\.\\d{1,3}");
    private static final Pattern INTEGER_NO = Pattern.compile("\\d{4,12}");

    /** Width (in characters) above which a line of the English/Arabic column is considered wrapped. */
    private static final int EN_WRAP_WIDTH = 45;
    private static final int AR_FULL_LINE = 40;

    private static final Set<String> EN_FUNCTION_WORDS = Set.of(
            "a", "an", "the", "of", "and", "or", "to", "for", "by", "via", "with", "in", "on", "at", "from",
            "any", "all", "including", "such", "as", "other", "its", "their", "into", "per", "without", "not",
            "that", "which", "are", "is", "be", "than", "between", "within", "through", "under", "over");
    private static final Set<String> AR_PARTICLES = Set.of(
            "من", "عن", "في", "أو", "او", "و", "على", "إلى", "الى", "مع", "قد", "ثم", "أي", "اي", "التي",
            "الذي", "ب", "ل", "حتى", "عبر", "دون", "بين", "غير", "لدى", "ضمن", "كل", "بعض");

    private static final DateTimeFormatter DMY = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String[] lines = splitLines(ocrText.replace("\r\n", "\n").replace("\r", "\n"));
        Layout layout = analyseLayout(lines);

        int managerLabel = findLabel(lines, 0, EN_MANAGER);
        int detailsEnd = managerLabel >= 0 ? managerLabel : lines.length;

        String licenseNo = extractLicenseNo(lines, detailsEnd);
        addIfNotEmpty(result, "licenseNo", licenseNo);
        addIfNotEmpty(result, "registerNo", extractFormationNo(lines, detailsEnd, licenseNo));

        String companyEn = latinValueAfter(lines, EN_COMPANY);
        String companyAr = arabicValueAfter(lines, AR_COMPANY);
        addIfNotEmpty(result, "companyName", companyEn);
        addIfNotEmpty(result, "businessName", companyEn);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        addIfNotEmpty(result, "legalType", latinValueAfter(lines, EN_FORMATION_TYPE));
        addIfNotEmpty(result, "legalTypeAr", arabicValueAfter(lines, AR_FORMATION_TYPE));
        addIfNotEmpty(result, "licenceType", extractLicenceTypeEn(lines, layout));
        addIfNotEmpty(result, "licenceTypeAr", extractLicenceTypeAr(lines));

        addIfNotEmpty(result, "address", joinLatin(latinBlockAfter(lines, EN_ADDRESS)));
        addIfNotEmpty(result, "addressAr", String.join(" ", arabicBlockAfter(lines, AR_ADDRESS)));

        String[] dates = extractDates(lines, findLabel(lines, 0, EN_ACTIVITY));
        addIfNotEmpty(result, "issueDate", dates[0]);
        addIfNotEmpty(result, "establishmentDate", dates[0]);
        addIfNotEmpty(result, "expiryDate", dates[1]);

        List<String> managersEn = extractManagersEn(lines);
        List<String> managersAr = extractManagersAr(lines, managersEn.size());
        addIfNotEmpty(result, "manager", String.join(", ", managersEn));
        addIfNotEmpty(result, "managerAr", String.join("، ", managersAr));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(buildMembers(lines, managersEn, managersAr)));

        List<Activity> activities = extractEnglishActivities(lines, layout);
        pairArabicActivities(activities, extractArabicActivityLines(lines, layout), layout);
        addIfNotEmpty(result, "licenseActivities", activitiesJson(activities));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Sharjah Publishing City trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    // =====================================================================================
    // Layout: page header/footer boilerplate and page index of every line
    // =====================================================================================

    private static final class Layout {
        final boolean[] boilerplate;
        final int[] page;
        final Set<String> headerLines;

        Layout(int n, Set<String> headerLines) {
            this.boilerplate = new boolean[n];
            this.page = new int[n];
            this.headerLines = headerLines;
        }
    }

    /**
     * Header = lines printed above the first form label (logo, authority, title); they repeat on every
     * page. Footer = the verification block opened by the footer sentence; it runs until the next
     * page header starts. Lines inside either are boilerplate; the page counter advances at each footer.
     */
    private Layout analyseLayout(String[] lines) {
        int firstLabel = lines.length;
        for (int i = 0; i < lines.length; i++) {
            if (isLabel(lines[i])) {
                firstLabel = i;
                break;
            }
        }
        Set<String> header = new HashSet<>();
        for (int i = 0; i < firstLabel && i < lines.length; i++) {
            header.add(canonical(lines[i]));
        }
        Layout layout = new Layout(lines.length, header);
        int page = 0;
        boolean inFooter = false;
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (!inFooter && isFooterMarker(line)) {
                inFooter = true;
            } else if (inFooter && header.contains(canonical(line))) {
                inFooter = false;
                page++;
            }
            layout.page[i] = page;
            layout.boilerplate[i] = inFooter || i < firstLabel || header.contains(canonical(line));
        }
        return layout;
    }

    private static boolean isFooterMarker(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        for (String marker : FOOTER_MARKERS) {
            if (lower.contains(marker)) {
                return true;
            }
        }
        return false;
    }

    private static String canonical(String line) {
        return line.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    // =====================================================================================
    // Labels
    // =====================================================================================

    /** A label line is one of the printed field captions (optionally with "(s)" / punctuation). */
    private static boolean isLabel(String line) {
        for (String[] group : ALL_LABELS) {
            if (isLabelOf(line, group)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isLabelOf(String line, String... labels) {
        if (line == null) {
            return false;
        }
        String t = line.trim();
        if (t.isEmpty()) {
            return false;
        }
        String bare = t.replaceAll("[()\\[\\].:：\\s]+", " ").trim().toLowerCase(Locale.ROOT);
        for (String label : labels) {
            // Printed English captions are capitalised; a lower-case line ("activities") is a value.
            if (Character.isUpperCase(label.charAt(0)) && !Character.isUpperCase(t.charAt(0))) {
                continue;
            }
            String l = label.replaceAll("[()\\[\\].:：\\s]+", " ").trim().toLowerCase(Locale.ROOT);
            if (bare.equals(l)) {
                return true;
            }
            // Caption followed only by a short parenthesised plural, e.g. "المدير (المديرون)".
            if (bare.startsWith(l + " ") && bare.length() <= l.length() + 12
                    && t.substring(Math.min(t.length(), label.length())).matches("[\\s()\\u0600-\\u06FFA-Za-z.]*")
                    && (t.contains("(") || t.contains(")"))) {
                return true;
            }
        }
        return false;
    }

    private static int findLabel(String[] lines, int from, String... labels) {
        for (int i = Math.max(0, from); i < lines.length; i++) {
            if (isLabelOf(lines[i], labels)) {
                return i;
            }
        }
        return -1;
    }

    // =====================================================================================
    // Scalar fields
    // =====================================================================================

    private String extractLicenseNo(String[] lines, int end) {
        int label = findLabel(lines, 0, EN_LICENSE_NO);
        if (label < 0) {
            label = findLabel(lines, 0, AR_LICENSE_NO);
        }
        if (label < 0) {
            return "";
        }
        String inline = lines[label].replaceFirst("(?i)^.*?licen[cs]e\\s*no\\.?\\s*[:\\-]?\\s*", "").trim();
        if (DECIMAL_NO.matcher(inline).matches()) {
            return inline;
        }
        for (int i = label + 1; i < end; i++) {
            if (DECIMAL_NO.matcher(lines[i].trim()).matches()) {
                return lines[i].trim();
            }
        }
        return "";
    }

    private String extractFormationNo(String[] lines, int end, String licenseNo) {
        int label = findLabel(lines, 0, EN_FORMATION_NO);
        int arLabel = findLabel(lines, 0, AR_FORMATION_NO);
        int from = label >= 0 ? label : (arLabel >= 0 ? Math.max(0, arLabel - 12) : -1);
        if (from >= 0) {
            for (int i = from + 1; i < end; i++) {
                String t = lines[i].trim();
                if (INTEGER_NO.matcher(t).matches()) {
                    return t;
                }
            }
        }
        // Formation number is the integer part of the licence number on SPC licences.
        if (licenseNo != null && licenseNo.contains(".")) {
            return licenseNo.substring(0, licenseNo.indexOf('.'));
        }
        return "";
    }

    /** First Latin value line after an English caption, stopping at the next caption. */
    private String latinValueAfter(String[] lines, String[] labels) {
        List<String> block = latinBlockAfter(lines, labels);
        return block.isEmpty() ? "" : block.get(0);
    }

    private List<String> latinBlockAfter(String[] lines, String[] labels) {
        List<String> out = new ArrayList<>();
        int idx = findLabel(lines, 0, labels);
        if (idx < 0) {
            return out;
        }
        for (int i = idx + 1; i < lines.length; i++) {
            String t = lines[i].trim();
            if (isLabel(t) || hasArabicLetters(t) || !hasLatinLetters(t) || !firstDate(t).isBlank()) {
                break;
            }
            out.add(t);
        }
        return out;
    }

    private String arabicValueAfter(String[] lines, String[] labels) {
        List<String> block = arabicBlockAfter(lines, labels);
        return block.isEmpty() ? "" : block.get(0);
    }

    private List<String> arabicBlockAfter(String[] lines, String[] labels) {
        List<String> out = new ArrayList<>();
        int idx = findLabel(lines, 0, labels);
        if (idx < 0) {
            return out;
        }
        for (int i = idx + 1; i < lines.length; i++) {
            String t = lines[i].trim();
            if (isLabel(t) || !hasArabicLetters(t) || hasLatinLetters(t) || !firstDate(t).isBlank()) {
                break;
            }
            out.add(cleanArabic(t));
        }
        return out;
    }

    private static String joinLatin(List<String> parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            String t = p.trim();
            if (t.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(t);
        }
        return sb.toString().replaceAll("\\s*,\\s*", ", ").replaceAll("\\s+", " ").replaceAll(",\\s*$", "").trim();
    }

    private String extractLicenceTypeEn(String[] lines, Layout layout) {
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (layout.headerLines.contains(canonical(t)) && t.matches("(?i)[A-Z ]*\\bLICEN[CS]E\\b[A-Z ]*")) {
                return titleCase(t);
            }
        }
        return "";
    }

    private String extractLicenceTypeAr(String[] lines) {
        for (String line : lines) {
            String t = line.trim();
            if (t.startsWith("رخصة") && t.split("\\s+").length <= 3 && !hasLatinLetters(t)) {
                return t;
            }
        }
        return "";
    }

    private static String titleCase(String s) {
        StringBuilder sb = new StringBuilder();
        for (String w : s.trim().toLowerCase(Locale.ROOT).split("\\s+")) {
            if (w.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
        }
        return sb.toString();
    }

    /**
     * Formation (issue) and expiry dates. A date directly under a date caption is bound to it; any
     * remaining caption is filled from the dates of the details block in printed order (formation row
     * is printed above the expiry row).
     */
    private String[] extractDates(String[] lines, int activityLabel) {
        int end = activityLabel >= 0 ? activityLabel : lines.length;
        String issue = dateDirectlyAfter(lines, EN_FORMATION_DATE, AR_FORMATION_DATE);
        String expiry = dateDirectlyAfter(lines, EN_EXPIRY_DATE, AR_EXPIRY_DATE);
        List<String> ordered = new ArrayList<>();
        for (int i = 0; i < end; i++) {
            String d = firstDate(lines[i]);
            if (!d.isBlank()) {
                String n = normalizeDate(d);
                if (!ordered.contains(n)) {
                    ordered.add(n);
                }
            }
        }
        if (issue.isBlank()) {
            for (String d : ordered) {
                if (!d.equals(expiry)) {
                    issue = d;
                    break;
                }
            }
        }
        if (expiry.isBlank()) {
            for (int i = ordered.size() - 1; i >= 0; i--) {
                if (!ordered.get(i).equals(issue)) {
                    expiry = ordered.get(i);
                    break;
                }
            }
        }
        LocalDate a = parse(issue);
        LocalDate b = parse(expiry);
        if (a != null && b != null && a.isAfter(b)) {
            String tmp = issue;
            issue = expiry;
            expiry = tmp;
        }
        return new String[]{issue, expiry};
    }

    private String dateDirectlyAfter(String[] lines, String[]... labelGroups) {
        for (String[] labels : labelGroups) {
            for (int i = 0; i < lines.length; i++) {
                if (!isLabelOf(lines[i], labels)) {
                    continue;
                }
                String same = firstDate(lines[i]);
                if (!same.isBlank()) {
                    return normalizeDate(same);
                }
                if (i + 1 < lines.length) {
                    String next = firstDate(lines[i + 1]);
                    if (!next.isBlank() && lines[i + 1].trim().length() <= 12) {
                        return normalizeDate(next);
                    }
                }
            }
        }
        return "";
    }

    private static LocalDate parse(String dmy) {
        try {
            return dmy == null || dmy.isBlank() ? null : LocalDate.parse(dmy, DMY);
        } catch (Exception e) {
            return null;
        }
    }

    // =====================================================================================
    // Managers / members
    // =====================================================================================

    private List<String> extractManagersEn(String[] lines) {
        List<String> names = new ArrayList<>();
        int idx = findLabel(lines, 0, EN_MANAGER);
        if (idx < 0) {
            return names;
        }
        String prev = null;
        for (int i = idx + 1; i < lines.length; i++) {
            String t = lines[i].trim();
            if (isLabel(t) || hasArabicLetters(t) || !hasLatinLetters(t)) {
                break;
            }
            if (prev != null && enJoinStrength(prev, t, true) > 0) {
                names.set(names.size() - 1, names.get(names.size() - 1) + " " + t);
            } else {
                names.add(t);
            }
            prev = t;
        }
        return names;
    }

    private List<String> extractManagersAr(String[] lines, int expected) {
        List<String> names = new ArrayList<>();
        int idx = findLabel(lines, 0, AR_MANAGER);
        if (idx < 0) {
            return names;
        }
        for (int i = idx + 1; i < lines.length; i++) {
            String t = lines[i].trim();
            if (isLabel(t) || !hasArabicLetters(t) || hasLatinLetters(t)) {
                break;
            }
            names.add(cleanArabic(t));
        }
        if (expected == 1 && names.size() > 1) {
            return new ArrayList<>(List.of(String.join(" ", names)));
        }
        return names;
    }

    private List<Map<String, String>> buildMembers(String[] lines, List<String> en, List<String> ar) {
        String roleAr = "";
        int arLabel = findLabel(lines, 0, AR_MANAGER);
        if (arLabel >= 0) {
            roleAr = AR_MANAGER[0];
        }
        List<Map<String, String>> people = new ArrayList<>();
        int n = Math.max(en.size(), ar.size());
        for (int i = 0; i < n; i++) {
            Map<String, String> p = new LinkedHashMap<>();
            if (i < en.size()) {
                p.put("nameEn", en.get(i));
            }
            if (i < ar.size()) {
                p.put("nameAr", ar.get(i));
            }
            p.put("role", "Manager");
            if (!roleAr.isEmpty()) {
                p.put("roleAr", roleAr);
            }
            people.add(p);
        }
        return people;
    }

    // =====================================================================================
    // Activities — English column rebuilt around the code column
    // =====================================================================================

    private static final class Activity {
        final List<String> enLines = new ArrayList<>();
        final List<Integer> enPages = new ArrayList<>();
        String code = "";
        int page;
        /** English lines emitted before this activity's code (1 → code sat next to the first line). */
        int preCodeLines;
        String ar = "";

        String en() {
            return joinLatin(enLines).replaceAll("\\s+,", ",");
        }

        String lastLine() {
            return enLines.isEmpty() ? "" : enLines.get(enLines.size() - 1);
        }

        int lastPage() {
            return enPages.isEmpty() ? page : enPages.get(enPages.size() - 1);
        }
    }

    private static final class Line {
        final String text;
        final int page;

        Line(String text, int page) {
            this.text = text;
            this.page = page;
        }
    }

    /**
     * Each activity has exactly one code, printed on its first row. OCR emits that code either after
     * the activity's first line or after its last line, so between two codes there are (a) the
     * wrapped tail of the previous activity, then (b) the head of the next one. The split point is
     * chosen from continuation cues (lower-case start, open parenthesis, trailing connector/function
     * word, line filled to the column width) and from page boundaries.
     */
    private List<Activity> extractEnglishActivities(String[] lines, Layout layout) {
        List<Activity> acts = new ArrayList<>();
        int start = findLabel(lines, 0, EN_ACTIVITY);
        if (start < 0) {
            return acts;
        }
        List<Line> pending = new ArrayList<>();
        for (int i = start + 1; i < lines.length; i++) {
            String t = lines[i].trim();
            if (layout.boilerplate[i] || isLabel(t) || hasArabicLetters(t)) {
                continue;
            }
            String code = null;
            String text = null;
            if (CODE_ONLY.matcher(t).matches()) {
                code = t;
            } else if (hasLatinLetters(t)) {
                Matcher m = TRAILING_CODE.matcher(t);
                if (m.matches()) {
                    text = m.group(1).trim();
                    code = m.group(2);
                } else {
                    text = t;
                }
            }
            if (text != null) {
                pending.add(new Line(text, layout.page[i]));
            }
            if (code != null) {
                closeSegment(acts, pending, code);
                pending.clear();
            }
        }
        // Lines after the last code: wrapped tail of the last activity, then code-less activities.
        if (!pending.isEmpty()) {
            int k = 0;
            if (!acts.isEmpty()) {
                Activity last = acts.get(acts.size() - 1);
                while (k < pending.size() && last.preCodeLines <= 1
                        && pending.get(k).page == last.lastPage()
                        && codelessJoin(last.lastLine(), pending.get(k).text)) {
                    addLine(last, pending.get(k));
                    k++;
                }
            }
            Activity cur = null;
            for (; k < pending.size(); k++) {
                Line l = pending.get(k);
                if (cur == null || l.page != cur.lastPage() || !codelessJoin(cur.lastLine(), l.text)) {
                    cur = new Activity();
                    cur.page = l.page;
                    acts.add(cur);
                }
                addLine(cur, l);
            }
        }
        acts.removeIf(a -> a.enLines.isEmpty() && a.code.isEmpty());
        return acts;
    }

    private void closeSegment(List<Activity> acts, List<Line> pending, String code) {
        int t = acts.isEmpty() ? 0 : chooseSplit(acts.get(acts.size() - 1), pending);
        if (!acts.isEmpty()) {
            Activity prev = acts.get(acts.size() - 1);
            for (int i = 0; i < t; i++) {
                addLine(prev, pending.get(i));
            }
        }
        Activity act = new Activity();
        act.code = code;
        act.page = pending.size() > t ? pending.get(t).page : (pending.isEmpty() ? 0 : pending.get(0).page);
        for (int i = t; i < pending.size(); i++) {
            addLine(act, pending.get(i));
        }
        act.preCodeLines = pending.size() - t;
        acts.add(act);
    }

    private static void addLine(Activity a, Line l) {
        if (a.enLines.isEmpty()) {
            a.page = l.page;
        }
        a.enLines.add(l.text);
        a.enPages.add(l.page);
    }

    /** Number of leading segment lines that continue the previous activity. */
    private int chooseSplit(Activity prev, List<Line> seg) {
        int m = seg.size();
        if (m <= 1 || prev.preCodeLines >= 2 || prev.enLines.isEmpty()) {
            // A single line must be the new activity's head (an activity cannot be empty); a previous
            // activity whose code followed two or more of its lines was complete when its code was emitted.
            return 0;
        }
        // boundary strength b[0] = prev.last → seg[0], b[i] = seg[i-1] → seg[i]
        double[] b = new double[m];
        b[0] = boundaryStrength(prev.lastLine(), prev.lastPage(), seg.get(0));
        for (int i = 1; i < m; i++) {
            b[i] = boundaryStrength(seg.get(i - 1).text, seg.get(i - 1).page, seg.get(i));
        }
        int best = -1;
        double bestScore = Double.NEGATIVE_INFINITY;
        double joined = 0;
        for (int t = 0; t < m; t++) {
            if (t > 0) {
                if (b[t - 1] <= 0) {
                    break; // cannot join this line to the previous activity
                }
                joined += b[t - 1];
            }
            if (!startsNewActivity(seg.get(t).text)) {
                continue;
            }
            double score = joined - b[t] - (t > 0 ? 1.5 : 0); // bias towards keeping activities apart
            if (score > bestScore) {
                bestScore = score;
                best = t;
            }
        }
        return best < 0 ? 0 : best;
    }

    private double boundaryStrength(String prev, int prevPage, Line next) {
        if (prevPage != next.page) {
            return -2; // a table row never spans two pages
        }
        return enJoinStrength(prev, next.text, false);
    }

    /**
     * How strongly {@code next} reads as the wrapped continuation of {@code prev}:
     * 3 = explicit cue, 1 = line filled to the column width, -2 = no cue.
     */
    private static double enJoinStrength(String prev, String next, boolean names) {
        String p = prev.trim();
        String n = next.trim();
        if (p.isEmpty() || n.isEmpty()) {
            return -2;
        }
        char first = n.charAt(0);
        if (Character.isLowerCase(first) || ")]}.,;:&".indexOf(first) >= 0) {
            return 3;
        }
        if (count(p, '(') > count(p, ')') || count(n, ')') > count(n, '(')) {
            return 3;
        }
        if (p.endsWith(".")) {
            return -2;
        }
        char last = p.charAt(p.length() - 1);
        if (",&;-/•+".indexOf(last) >= 0) {
            return 3;
        }
        if (!names) {
            String[] words = p.split("\\s+");
            if (EN_FUNCTION_WORDS.contains(words[words.length - 1].toLowerCase(Locale.ROOT))) {
                return 3;
            }
        }
        String firstWord = n.split("\\s+")[0];
        if (p.length() + 1 + firstWord.length() > EN_WRAP_WIDTH) {
            return 1;
        }
        return -2;
    }

    /**
     * Without a code anchor, a full-width line only continues into a short fragment (one or two
     * words); otherwise an explicit continuation cue is required.
     */
    private static boolean codelessJoin(String prev, String next) {
        double s = enJoinStrength(prev, next, false);
        return s >= 3 || (s > 0 && next.trim().split("\\s+").length <= 2);
    }

    private static boolean startsNewActivity(String line) {
        String t = line.trim();
        if (t.isEmpty()) {
            return false;
        }
        char c = t.charAt(0);
        return (Character.isUpperCase(c) || Character.isDigit(c) || c == '(') && count(t, ')') <= count(t, '(');
    }

    private static int count(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == c) {
                n++;
            }
        }
        return n;
    }

    // =====================================================================================
    // Activities — Arabic column grouped onto the English rows
    // =====================================================================================

    private List<Line> extractArabicActivityLines(String[] lines, Layout layout) {
        List<Line> out = new ArrayList<>();
        int start = findLabel(lines, 0, AR_ACTIVITY);
        if (start < 0) {
            start = findLabel(lines, 0, EN_ACTIVITY);
        }
        if (start < 0) {
            return out;
        }
        for (int i = start + 1; i < lines.length; i++) {
            String t = lines[i].trim();
            if (layout.boilerplate[i] || isLabel(t) || !hasArabicLetters(t) || hasLatinLetters(t)) {
                continue;
            }
            out.add(new Line(cleanArabic(t), layout.page[i]));
        }
        return out;
    }

    /**
     * Partitions the Arabic lines into one consecutive group per English activity (dynamic
     * programming). A group is scored by the wrap cues at its internal line joins, by how well its
     * length matches the English name (relative to the document's overall AR/EN length ratio), and
     * by staying on the same page as its English row.
     */
    private void pairArabicActivities(List<Activity> acts, List<Line> ar, Layout layout) {
        int n = acts.size();
        int m = ar.size();
        if (m == 0) {
            return;
        }
        if (n == 0) {
            Activity cur = null;
            for (int j = 0; j < m; j++) {
                if (cur == null || arJoinStrength(ar.get(j - 1).text, ar.get(j).text) < 3
                        || ar.get(j - 1).page != ar.get(j).page) {
                    cur = new Activity();
                    cur.page = ar.get(j).page;
                    acts.add(cur);
                    cur.ar = ar.get(j).text;
                } else {
                    cur.ar = cur.ar + " " + ar.get(j).text;
                }
            }
            return;
        }
        double enTotal = 0;
        double arTotal = 0;
        for (Activity a : acts) {
            enTotal += a.en().length();
        }
        for (Line l : ar) {
            arTotal += l.text.length();
        }
        double logRatio = Math.log((arTotal + 1) / (enTotal + 1));

        double[] join = new double[Math.max(0, m - 1)];
        for (int j = 0; j + 1 < m; j++) {
            join[j] = ar.get(j).page != ar.get(j + 1).page ? -20 : arJoinStrength(ar.get(j).text, ar.get(j + 1).text);
        }

        double neg = Double.NEGATIVE_INFINITY;
        double[][] f = new double[n + 1][m + 1];
        int[][] from = new int[n + 1][m + 1];
        for (double[] row : f) {
            java.util.Arrays.fill(row, neg);
        }
        f[0][0] = 0;
        for (int k = 1; k <= n; k++) {
            Activity act = acts.get(k - 1);
            double enLen = act.en().length();
            for (int j = 0; j <= m; j++) {
                for (int i = j; i >= 0; i--) {
                    if (f[k - 1][i] == neg) {
                        continue;
                    }
                    double s;
                    if (i == j) {
                        s = -8; // English activity without an Arabic translation
                    } else {
                        double len = 0;
                        double joins = 0;
                        double page = 0;
                        for (int x = i; x < j; x++) {
                            len += ar.get(x).text.length() + (x > i ? 1 : 0);
                            if (x > i) {
                                joins += join[x - 1];
                            }
                            if (ar.get(x).page != act.page) {
                                page -= 20;
                            }
                        }
                        double dev = Math.abs(Math.log((len + 8) / (enLen + 8)) - logRatio);
                        s = joins - 2.5 * dev + page;
                    }
                    double v = f[k - 1][i] + s;
                    if (v > f[k][j]) {
                        f[k][j] = v;
                        from[k][j] = i;
                    }
                }
            }
        }
        int j = m;
        for (int k = n; k >= 1; k--) {
            int i = from[k][j];
            StringBuilder sb = new StringBuilder();
            for (int x = i; x < j; x++) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(ar.get(x).text);
            }
            acts.get(k - 1).ar = sb.toString();
            j = i;
        }
    }

    /** Wrap cue between two Arabic lines: 3 explicit, 1 full-width line, -2 none. */
    private static double arJoinStrength(String prev, String next) {
        String p = prev.trim();
        String n = next.trim();
        if (p.isEmpty() || n.isEmpty()) {
            return -2;
        }
        if (count(p, '(') > count(p, ')') || n.startsWith(")")) {
            return 3;
        }
        char last = p.charAt(p.length() - 1);
        if ("،,•-/".indexOf(last) >= 0) {
            return 3;
        }
        String[] pw = p.split("\\s+");
        String lastWord = pw[pw.length - 1];
        if (AR_PARTICLES.contains(lastWord)) {
            return 3;
        }
        String firstWord = n.split("\\s+")[0];
        if (AR_PARTICLES.contains(firstWord) && !p.endsWith(".")) {
            return 2;
        }
        if (p.endsWith(".")) {
            return -2;
        }
        if (p.length() >= AR_FULL_LINE) {
            return 1;
        }
        return -2;
    }

    private String activitiesJson(List<Activity> acts) {
        if (acts.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Activity a : acts) {
            String en = a.en();
            if (en.isEmpty() && a.ar.isEmpty()) {
                continue;
            }
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append("{\"en\":\"").append(escape(en)).append("\",\"ar\":\"").append(escape(a.ar)).append('"');
            if (!a.code.isEmpty()) {
                sb.append(",\"code\":\"").append(escape(a.code)).append('"');
            }
            sb.append('}');
        }
        sb.append(']');
        return first ? "" : sb.toString();
    }

    // =====================================================================================
    // Arabic text
    // =====================================================================================

    /**
     * Keeps the printed Arabic spelling (hamza/tanween as on the licence) and only repairs OCR
     * artefacts: Persian yeh/kaf code points and whitespace.
     */
    private String cleanArabic(String s) {
        if (s == null) {
            return "";
        }
        String t = s.replace('ک', 'ك')              // Persian kaf → Arabic kaf
                .replaceAll("ی(?=[\\u0600-\\u06FF])", "ي") // medial Persian yeh → yeh
                .replace('ی', 'ى')                   // final Persian yeh → alef maqsura
                .replaceAll("\\s+", " ")
                .trim();
        return t;
    }
}
