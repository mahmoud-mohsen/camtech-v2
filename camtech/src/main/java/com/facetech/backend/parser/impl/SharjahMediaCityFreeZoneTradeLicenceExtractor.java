package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
 * Sharjah Media City (Shams) free zone business licences.
 *
 * <p>Everything is located through the bilingual template labels ("Company Name / إسم الشركة",
 * "Formation No. / رقم التأسيس", "Activities", "النشاط / الأنشطة" ...). No licence-specific values are
 * hard-coded. Google Document AI emits the two layout columns and the English / Arabic halves of a
 * row as separate runs, so values are first read from the block that follows their label and any
 * value found out of place ("stranded") is handed to the label of the same kind that is still empty.</p>
 *
 * <p>The activities table (Activities | Code | النشاط/الأنشطة) is rebuilt from the code column: every
 * code line is one table row. English rows are reconstructed by choosing, among the English text lines,
 * the row starts that best explain the text (capitalisation, line fill, trailing connectors) under the
 * constraint that a row always starts before its code is emitted. Arabic rows are rebuilt per page
 * (the Arabic column of a page holds exactly the rows whose codes are on that page) using line fill,
 * trailing connectors and the length of the matching English row.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SharjahMediaCityFreeZoneTradeLicenceExtractor {

    private final ArabicTextProcessor arabicTextProcessor;

    /** Template labels of the Shams business licence (matched after Arabic/case normalisation). */
    private enum Label {
        COMPANY_NAME(Kind.TEXT, "company name", "اسم الشركة"),
        OPERATING_NAME(Kind.TEXT, "operating name", "اسم التشغيل"),
        FORMATION_TYPE(Kind.TEXT, "formation type", "نوع التاسيس"),
        ADDRESS(Kind.TEXT, "address", "العنوان"),
        FORMATION_NO(Kind.NUMBER, "formation no", "formation number", "رقم التاسيس"),
        LICENSE_NO(Kind.NUMBER, "license no", "licence no", "license number", "رقم الرخصة"),
        FORMATION_DATE(Kind.DATE, "license formation date", "licence formation date", "formation date",
                "تاريخ انشاء الرخصة"),
        EXPIRY_DATE(Kind.DATE, "expiry date", "تاريخ الانتهاء"),
        MANAGERS(Kind.PEOPLE, "managers", "manager", "المدير", "المديرون"),
        ACTIVITIES(Kind.SECTION, "activities", "activity", "النشاط", "الانشطة"),
        CODE(Kind.SECTION, "code");

        final Kind kind;
        final String[] phrases;

        Label(Kind kind, String... phrases) {
            this.kind = kind;
            this.phrases = phrases;
        }
    }

    private enum Kind { TEXT, NUMBER, DATE, PEOPLE, SECTION }

    private enum LineType { LATIN, ARABIC, MIXED, DATE, NUMBER, CODE, OTHER }

    private static final Pattern ACTIVITY_CODE = Pattern.compile("\\d{3,4}(?:\\.\\d{1,3})?");
    private static final Pattern REGISTRY_NUMBER = Pattern.compile("\\d{5,12}(?:\\.\\d{1,4})*");
    private static final Pattern PAGE_OF = Pattern.compile("(?i)^page\\s+\\d+\\s+of\\s+\\d+$");
    private static final Pattern EN_CONNECTOR_END = Pattern.compile(
            "(?i).*(?:\\b(?:of|and|or|via|in|on|the|for|to|with|by|from|at|a|an|as|into|onto|including|such)"
                    + "|[,:;•&/(\\-])$");
    private static final Pattern AR_CONNECTOR_END = Pattern.compile(
            ".*(?:(?:^|\\s)(?:و|أو|او|في|فى|من|عن|على|إلى|الى|بما|مع|لدى|ذلك|أي|اي|مثل|غير|دون)"
                    + "|[،,:؛•\\-(])$");

    /** Template boilerplate (headers, footers, verification texts) of the Shams licence. */
    private static final Pattern[] TEMPLATE_NOISE = {
            PAGE_OF,
            Pattern.compile("(?i).*(?:https?://|www\\.|portal\\.|\\.ae\\b|@).*"),
            Pattern.compile("^\\[[\\d.\\s]+]$"),
            Pattern.compile("(?i).*\\b800\\s*SHAMS\\b.*"),
            Pattern.compile("(?i)^(?:P\\.?\\s?O\\.?\\s?Box|T\\s+\\d|E\\s+\\S+@).*"),
            Pattern.compile("(?i).*(?:government of sharjah|free zone authority|verification qr|"
                    + "approved electronic document|any alteration or change|to verify the licen).*"),
            Pattern.compile("(?i).*\\(shams\\).*"),
            Pattern.compile("(?i)^issued by .*authority.*"),
            Pattern.compile("(?i)^(?:free zone|shams|business licen[cs]e|sharjah media city)$"),
            Pattern.compile(".*(?:حكومة الشارقة|هيئة منطقة حرة|وثيقة إلكترونية|وثيقة الكترونية|أي كشط|اي كشط).*"),
            Pattern.compile("^(?:صادر عن مدينة|صادرة عن مدينة).*"),
            Pattern.compile("^(?:منطقة حرة|شمس|رخصة تجارية|مدينة الشارقة للإعلام|مدينة الشارقة للاعلام)$"),
    };

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }
        String[] lines = splitLines(ocrText.replace("\r\n", "\n").replace("\r", "\n"));
        Layout layout = new Layout(lines);

        addIfNotEmpty(result, "licenseNo", layout.value(Label.LICENSE_NO));
        addIfNotEmpty(result, "registerNo", layout.value(Label.FORMATION_NO));

        String companyEn = layout.en(Label.COMPANY_NAME);
        String companyAr = layout.ar(Label.COMPANY_NAME);
        String operatingEn = layout.en(Label.OPERATING_NAME);
        String operatingAr = layout.ar(Label.OPERATING_NAME);
        addIfNotEmpty(result, "companyName", companyEn.isBlank() ? operatingEn : companyEn);
        addIfNotEmpty(result, "companyNameAr", companyAr.isBlank() ? operatingAr : companyAr);
        addIfNotEmpty(result, "businessName", operatingEn.isBlank() ? companyEn : operatingEn);
        addIfNotEmpty(result, "businessNameAr", operatingAr.isBlank() ? companyAr : operatingAr);

        addIfNotEmpty(result, "legalType", layout.en(Label.FORMATION_TYPE));
        addIfNotEmpty(result, "legalTypeAr", layout.ar(Label.FORMATION_TYPE));
        addIfNotEmpty(result, "address", layout.en(Label.ADDRESS));
        addIfNotEmpty(result, "addressAr", layout.ar(Label.ADDRESS));
        addIfNotEmpty(result, "licenceType", layout.documentTitle(false));
        addIfNotEmpty(result, "licenceTypeAr", layout.documentTitle(true));

        // The template only carries "License Formation Date" (licence start) and "Expiry Date".
        String formationDate = layout.value(Label.FORMATION_DATE);
        addIfNotEmpty(result, "issueDate", formationDate);
        addIfNotEmpty(result, "establishmentDate", formationDate);
        addIfNotEmpty(result, "expiryDate", layout.value(Label.EXPIRY_DATE));

        List<String> managersEn = layout.managerEnNames;
        List<String> managersAr = layout.managerArNames;
        if (!managersEn.isEmpty()) {
            addIfNotEmpty(result, "manager", managersEn.get(0));
        }
        if (!managersAr.isEmpty()) {
            addIfNotEmpty(result, "managerAr", managersAr.get(0));
        }
        addIfNotEmpty(result, "licenseMembers", toPersonJson(buildMembers(managersEn, managersAr)));

        List<Activity> activities = new ActivityTableReader(layout).read();
        addIfNotEmpty(result, "licenseActivities", activitiesJson(activities));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Sharjah Media City (Shams) trade licence parsed: {} fields extracted, {} activities, confidence={}",
                filled, activities.size(), result.getOverallConfidence());
        return result;
    }

    // ------------------------------------------------------------------------------------------
    // Labels, blocks and scalar values
    // ------------------------------------------------------------------------------------------

    private final class Layout {
        final String[] lines;
        final Label[] labelAt;
        final boolean[] noise;
        final boolean[] consumed;
        final int[] page;
        final Map<Label, Integer> labelIndex = new EnumMap<>(Label.class);
        int activitiesAr = -1;
        int activitiesEn = -1;
        int managersAr = -1;
        int managersEn = -1;

        final Map<Label, String> en = new EnumMap<>(Label.class);
        final Map<Label, String> ar = new EnumMap<>(Label.class);
        final Map<Label, String> values = new EnumMap<>(Label.class);
        final List<String> managerEnNames = new ArrayList<>();
        final List<String> managerArNames = new ArrayList<>();

        private final List<Integer> latinPool = new ArrayList<>();
        private final List<Integer> arabicPool = new ArrayList<>();
        private final List<Integer> datePool = new ArrayList<>();
        private final List<Integer> numberPool = new ArrayList<>();

        Layout(String[] lines) {
            this.lines = lines;
            this.labelAt = new Label[lines.length];
            this.noise = new boolean[lines.length];
            this.consumed = new boolean[lines.length];
            this.page = new int[lines.length];
            int currentPage = 0;
            boolean inPageFooter = false;
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i];
                noise[i] = isTemplateNoise(line);
                boolean pageEnd = PAGE_OF.matcher(line).matches()
                        || line.toLowerCase(Locale.ROOT).contains("any alteration or change");
                if (pageEnd) {
                    if (!inPageFooter) {
                        currentPage++;
                    }
                    inPageFooter = true;
                } else if (!noise[i]) {
                    inPageFooter = false;
                }
                page[i] = currentPage;
                if (noise[i]) {
                    continue;
                }
                Label label = labelOf(line);
                labelAt[i] = label;
                if (label == null) {
                    continue;
                }
                boolean arabicHeading = hasArabicLetters(line) && !hasLatinLetters(line);
                if (label == Label.ACTIVITIES) {
                    if (arabicHeading && activitiesAr < 0) {
                        activitiesAr = i;
                    } else if (!arabicHeading && activitiesEn < 0) {
                        activitiesEn = i;
                    }
                } else if (label == Label.MANAGERS) {
                    if (arabicHeading && managersAr < 0) {
                        managersAr = i;
                    } else if (!arabicHeading && managersEn < 0) {
                        managersEn = i;
                    }
                } else if (label != Label.CODE) {
                    labelIndex.putIfAbsent(label, i);
                }
            }
            readBlocks();
        }

        String en(Label label) {
            return en.getOrDefault(label, "");
        }

        String ar(Label label) {
            return ar.getOrDefault(label, "");
        }

        String value(Label label) {
            return values.getOrDefault(label, "");
        }

        String documentTitle(boolean arabic) {
            for (String line : lines) {
                String t = line.trim();
                if (!arabic && t.matches("(?i)business licen[cs]e")) {
                    return t;
                }
                if (arabic && t.equals("رخصة تجارية")) {
                    return t;
                }
            }
            return "";
        }

        /** Index of the next label line after {@code from} (column header "Code" excluded). */
        int nextLabel(int from) {
            for (int i = from + 1; i < lines.length; i++) {
                if (labelAt[i] != null && labelAt[i] != Label.CODE) {
                    return i;
                }
            }
            return lines.length;
        }

        private void readBlocks() {
            List<Map.Entry<Label, Integer>> ordered = new ArrayList<>(labelIndex.entrySet());
            ordered.sort(Map.Entry.comparingByValue());
            for (Map.Entry<Label, Integer> entry : ordered) {
                Label label = entry.getKey();
                int start = entry.getValue();
                int end = nextLabel(start);
                for (int i = start + 1; i < end; i++) {
                    if (noise[i] || labelAt[i] != null) {
                        continue;
                    }
                    String line = lines[i];
                    LineType type = typeOf(line);
                    boolean taken = false;
                    if (label.kind == Kind.TEXT) {
                        if (type == LineType.LATIN && !en.containsKey(label)) {
                            en.put(label, clean(line));
                            taken = true;
                        } else if (type == LineType.ARABIC && !ar.containsKey(label)) {
                            ar.put(label, cleanArabic(line));
                            taken = true;
                        }
                    } else if (label.kind == Kind.NUMBER) {
                        if (type == LineType.NUMBER && !values.containsKey(label) && numberFits(label, line)) {
                            values.put(label, line.trim());
                            taken = true;
                        }
                    } else if (label.kind == Kind.DATE) {
                        if (type == LineType.DATE && !values.containsKey(label)) {
                            values.put(label, normalizeDate(firstDate(line)));
                            taken = true;
                        }
                    }
                    if (taken) {
                        consumed[i] = true;
                    } else {
                        pool(i, type);
                    }
                }
            }

            readManagers();
            if (activitiesEn >= 0) {
                // Values stranded after the English "Activities" heading but before the next label (with
                // no activity code after them) are column values that Google OCR emitted late.
                int end = nextLabel(activitiesEn);
                int lastCode = activitiesEn;
                for (int i = activitiesEn + 1; i < end; i++) {
                    if (!noise[i] && typeOf(lines[i]) == LineType.CODE) {
                        lastCode = i;
                    }
                }
                for (int i = lastCode + 1; i < end; i++) {
                    if (!noise[i] && labelAt[i] == null) {
                        pool(i, typeOf(lines[i]));
                    }
                }
                // Dates never belong to the activity table.
                for (int i = activitiesEn + 1; i < lines.length; i++) {
                    if (!noise[i] && labelAt[i] == null && typeOf(lines[i]) == LineType.DATE) {
                        pool(i, LineType.DATE);
                    }
                }
            }
            latinPool.sort(Integer::compare);
            arabicPool.sort(Integer::compare);
            datePool.sort(Integer::compare);
            numberPool.sort(Integer::compare);

            // Hand stranded values to empty labels of the same kind, in reading order.
            for (Map.Entry<Label, Integer> entry : ordered) {
                Label label = entry.getKey();
                if (label.kind == Kind.TEXT) {
                    if (!en.containsKey(label) && !latinPool.isEmpty()) {
                        int i = latinPool.remove(0);
                        en.put(label, clean(lines[i]));
                        consumed[i] = true;
                    }
                    if (!ar.containsKey(label) && !arabicPool.isEmpty()) {
                        int i = arabicPool.remove(0);
                        ar.put(label, cleanArabic(lines[i]));
                        consumed[i] = true;
                    }
                } else if ((label.kind == Kind.NUMBER || label.kind == Kind.DATE) && !values.containsKey(label)) {
                    List<Integer> pool = label.kind == Kind.NUMBER ? numberPool : datePool;
                    for (int p = 0; p < pool.size(); p++) {
                        int i = pool.get(p);
                        if (label.kind == Kind.DATE || numberFits(label, lines[i])) {
                            values.put(label, label.kind == Kind.DATE
                                    ? normalizeDate(firstDate(lines[i])) : lines[i].trim());
                            consumed[i] = true;
                            pool.remove(p);
                            break;
                        }
                    }
                }
            }
            // The licence formation (start) date always precedes the expiry date.
            String start = values.get(Label.FORMATION_DATE);
            String expiry = values.get(Label.EXPIRY_DATE);
            if (start != null && expiry != null && dateKey(start) > dateKey(expiry)) {
                values.put(Label.FORMATION_DATE, expiry);
                values.put(Label.EXPIRY_DATE, start);
            }
        }

        private void readManagers() {
            if (managersEn >= 0) {
                int end = nextLabel(managersEn);
                for (int i = managersEn + 1; i < end; i++) {
                    if (noise[i] || labelAt[i] != null) {
                        continue;
                    }
                    LineType type = typeOf(lines[i]);
                    if (type == LineType.LATIN && looksLikePersonName(lines[i])) {
                        managerEnNames.add(clean(lines[i]));
                        consumed[i] = true;
                    } else {
                        pool(i, type);
                    }
                }
            }
            if (managersAr >= 0) {
                int end = nextLabel(managersAr);
                for (int i = managersAr + 1; i < end; i++) {
                    if (noise[i] || labelAt[i] != null) {
                        continue;
                    }
                    LineType type = typeOf(lines[i]);
                    if (type == LineType.ARABIC && looksLikePersonName(lines[i])) {
                        managerArNames.add(cleanArabic(lines[i]));
                        consumed[i] = true;
                    } else if (type == LineType.DATE || type == LineType.NUMBER) {
                        pool(i, type);
                    }
                }
            }
        }

        private void pool(int i, LineType type) {
            List<Integer> target = switch (type) {
                case LATIN -> latinPool;
                case ARABIC -> arabicPool;
                case DATE -> datePool;
                case NUMBER -> numberPool;
                default -> null;
            };
            if (target != null && !target.contains(i)) {
                target.add(i);
            }
        }
    }

    private static LineType typeOf(String line) {
        String t = line.trim();
        if (ACTIVITY_CODE.matcher(t).matches()) {
            return LineType.CODE;
        }
        if (REGISTRY_NUMBER.matcher(t).matches()) {
            return LineType.NUMBER;
        }
        if (isDateOnly(t)) {
            return LineType.DATE;
        }
        boolean latin = hasLatinLetters(t);
        boolean arabic = hasArabicLetters(t);
        if (latin && arabic) {
            return LineType.MIXED;
        }
        if (latin) {
            return LineType.LATIN;
        }
        if (arabic) {
            return LineType.ARABIC;
        }
        return LineType.OTHER;
    }

    private static boolean numberFits(Label label, String line) {
        String t = line.trim();
        if (label == Label.FORMATION_NO) {
            // The formation (registration) number is the plain root of the dotted licence number.
            return t.matches("\\d{5,12}");
        }
        return REGISTRY_NUMBER.matcher(t).matches();
    }

    private static boolean isDateOnly(String line) {
        String d = firstDate(line);
        if (d.isBlank()) {
            return false;
        }
        return line.replace(d, "").replaceAll("[\\s/.\\-]", "").isEmpty();
    }

    private static long dateKey(String ddMMyyyy) {
        String[] parts = ddMMyyyy.split("/");
        if (parts.length != 3) {
            return 0;
        }
        try {
            return Long.parseLong(parts[2]) * 10000 + Long.parseLong(parts[1]) * 100 + Long.parseLong(parts[0]);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static boolean looksLikePersonName(String line) {
        return !line.matches(".*[\\d,;:@،].*") && line.trim().split("\\s+").length <= 8;
    }

    /** Returns the template label a line consists of, or null when the line is a value. */
    private Label labelOf(String line) {
        String normalized = normalizeForMatch(line);
        if (normalized.isEmpty()) {
            return null;
        }
        Label found = null;
        for (String part : normalized.split("\\s*/\\s*")) {
            if (part.isBlank()) {
                continue;
            }
            Label match = null;
            for (Label label : Label.values()) {
                for (String phrase : label.phrases) {
                    if (part.equals(normalizeForMatch(phrase))) {
                        match = label;
                        break;
                    }
                }
                if (match != null) {
                    break;
                }
            }
            if (match == null || (found != null && found != match)) {
                return null;
            }
            found = match;
        }
        return found;
    }

    private String normalizeForMatch(String value) {
        return arabicTextProcessor.normalizeArabic(value == null ? "" : value)
                .toLowerCase(Locale.ROOT)
                .replace('.', ' ')
                .replace('ـ', ' ')
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static boolean isTemplateNoise(String line) {
        String t = line.trim();
        if (t.replaceAll("[^\\p{L}\\p{Nd}]", "").length() < 2) {
            return true;
        }
        for (Pattern p : TEMPLATE_NOISE) {
            if (p.matcher(t).matches()) {
                return true;
            }
        }
        return false;
    }

    private static String clean(String value) {
        return value.replaceAll("\\s+", " ").trim();
    }

    private static String cleanArabic(String value) {
        return value.replace("ـ", "").replaceAll("\\s+", " ").trim();
    }

    private static List<Map<String, String>> buildMembers(List<String> en, List<String> ar) {
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
            people.add(p);
        }
        return people;
    }

    // ------------------------------------------------------------------------------------------
    // Activities table
    // ------------------------------------------------------------------------------------------

    record Activity(String code, String en, String ar) {
    }

    private static String activitiesJson(List<Activity> activities) {
        if (activities.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < activities.size(); i++) {
            Activity a = activities.get(i);
            if (i > 0) {
                sb.append(',');
            }
            sb.append('{');
            if (a.code() != null && !a.code().isBlank()) {
                sb.append("\"code\":\"").append(escape(a.code())).append("\",");
            }
            sb.append("\"en\":\"").append(escape(a.en())).append("\",\"ar\":\"")
                    .append(escape(a.ar())).append("\"}");
        }
        return sb.append(']').toString();
    }

    private static final class ActivityTableReader {
        private static final double NEG = -1e18;
        /** Cost per table row whose English text was emitted but whose code is still pending. */
        private static final double CODE_LAG_PENALTY = 2.0;
        private static final double FILL_WEIGHT = 3.0;
        private static final double AFTER_CODE_BONUS = 1.0;
        private static final double LENGTH_WEIGHT = 1.5;

        private final Layout layout;

        ActivityTableReader(Layout layout) {
            this.layout = layout;
        }

        /** Item of the English column stream: an English text line or a code line. */
        private record Item(boolean code, String text, int page) {
        }

        List<Activity> read() {
            int startEn = layout.activitiesEn;
            int startAr = layout.activitiesAr;
            if (startEn < 0 && startAr < 0) {
                return List.of();
            }
            int firstIdx = startEn >= 0 ? startEn : startAr;
            List<Item> items = new ArrayList<>();
            List<String> arabicLines = new ArrayList<>();
            List<Integer> arabicPages = new ArrayList<>();
            for (int i = firstIdx + 1; i < layout.lines.length; i++) {
                if (layout.noise[i] || layout.consumed[i] || layout.labelAt[i] != null) {
                    continue;
                }
                String line = layout.lines[i].trim();
                LineType type = typeOf(line);
                if (type == LineType.CODE) {
                    items.add(new Item(true, line, layout.page[i]));
                } else if (type == LineType.LATIN && (startEn < 0 || i > startEn)) {
                    items.add(new Item(false, clean(line), layout.page[i]));
                } else if (type == LineType.ARABIC && startAr >= 0 && i > startAr) {
                    arabicLines.add(cleanArabic(line));
                    arabicPages.add(layout.page[i]);
                }
            }
            List<String> codes = new ArrayList<>();
            List<Integer> codePages = new ArrayList<>();
            for (Item item : items) {
                if (item.code()) {
                    codes.add(item.text());
                    codePages.add(item.page());
                }
            }
            List<String> english = codes.isEmpty() ? englishWithoutCodes(items) : englishRows(items, codes.size());
            List<String> arabic = codes.isEmpty() ? arabicWithoutCodes(arabicLines)
                    : arabicRows(arabicLines, arabicPages, english, codePages);

            List<Activity> out = new ArrayList<>();
            int n = Math.max(codes.size(), Math.max(english.size(), arabic.size()));
            for (int r = 0; r < n; r++) {
                out.add(new Activity(r < codes.size() ? codes.get(r) : "",
                        r < english.size() ? english.get(r) : "",
                        r < arabic.size() ? arabic.get(r) : ""));
            }
            return out;
        }

        // ---------------- English column ----------------

        /**
         * Chooses exactly {@code rows} row starts among the English lines: maximises the start scores
         * while every row must start before its code line and pending codes are penalised.
         */
        private List<String> englishRows(List<Item> items, int rows) {
            List<String> texts = items.stream().filter(it -> !it.code()).map(Item::text).toList();
            if (texts.isEmpty()) {
                return List.of();
            }
            double width = columnWidth(texts);
            int m = items.size();
            double[][] dp = new double[m + 1][rows + 1];
            boolean[][] startChoice = new boolean[m + 1][rows + 1];
            for (double[] row : dp) {
                Arrays.fill(row, NEG);
            }
            dp[0][0] = 0;
            int codesSeen = 0;
            String prevText = null;
            boolean prevWasCode = false;
            for (int i = 0; i < m; i++) {
                Item item = items.get(i);
                if (item.code()) {
                    codesSeen++;
                    for (int k = codesSeen; k <= rows; k++) {
                        if (dp[i][k] == NEG) {
                            continue;
                        }
                        dp[i + 1][k] = Math.max(dp[i + 1][k], dp[i][k] - CODE_LAG_PENALTY * (k - codesSeen));
                    }
                    prevWasCode = true;
                    continue;
                }
                double score = prevText == null ? 0 : startScore(prevText, item.text(), prevWasCode, width);
                for (int k = 0; k <= rows; k++) {
                    if (dp[i][k] == NEG) {
                        continue;
                    }
                    if (prevText != null && dp[i][k] > dp[i + 1][k]) {
                        dp[i + 1][k] = dp[i][k];
                        startChoice[i + 1][k] = false;
                    }
                    if (k + 1 <= rows && dp[i][k] + score > dp[i + 1][k + 1]) {
                        dp[i + 1][k + 1] = dp[i][k] + score;
                        startChoice[i + 1][k + 1] = true;
                    }
                }
                prevText = item.text();
                prevWasCode = false;
            }
            if (dp[m][rows] == NEG) {
                return englishWithoutCodes(items);
            }
            boolean[] starts = new boolean[m];
            int k = rows;
            for (int i = m; i > 0; i--) {
                if (!items.get(i - 1).code() && startChoice[i][k]) {
                    starts[i - 1] = true;
                    k--;
                }
            }
            List<String> out = new ArrayList<>();
            StringBuilder current = null;
            for (int i = 0; i < m; i++) {
                Item item = items.get(i);
                if (item.code()) {
                    continue;
                }
                if (starts[i] || current == null) {
                    if (current != null) {
                        out.add(clean(current.toString()));
                    }
                    current = new StringBuilder(item.text());
                } else {
                    current.append(' ').append(item.text());
                }
            }
            if (current != null) {
                out.add(clean(current.toString()));
            }
            return out;
        }

        private List<String> englishWithoutCodes(List<Item> items) {
            List<String> texts = items.stream().filter(it -> !it.code()).map(Item::text).toList();
            double width = columnWidth(texts);
            List<String> out = new ArrayList<>();
            StringBuilder current = null;
            String prev = null;
            for (String text : texts) {
                if (current == null || startScore(prev, text, false, width) >= 3.0) {
                    if (current != null) {
                        out.add(clean(current.toString()));
                    }
                    current = new StringBuilder(text);
                } else {
                    current.append(' ').append(text);
                }
                prev = text;
            }
            if (current != null) {
                out.add(clean(current.toString()));
            }
            return out;
        }

        /** How strongly {@code line} looks like the first line of a new row given the previous line. */
        private double startScore(String prev, String line, boolean afterCode, double width) {
            String t = line.trim();
            String p = prev.trim();
            char first = t.charAt(0);
            if (Character.isLowerCase(first)) {
                return -10;
            }
            double score;
            if (!Character.isLetterOrDigit(first)) {
                score = 0.5;
            } else if (EN_CONNECTOR_END.matcher(p).matches()) {
                score = 1;
            } else if (p.endsWith(".")) {
                score = 2;
            } else {
                score = 3;
            }
            // A short previous line cannot have wrapped: the next line must begin a new row.
            double fill = (p.length() + 1 + firstWord(t).length()) / width;
            score += FILL_WEIGHT * clamp(1 - fill);
            if (afterCode) {
                score += AFTER_CODE_BONUS;
            }
            return score;
        }

        // ---------------- Arabic column ----------------

        private List<String> arabicRows(List<String> lines, List<Integer> pages, List<String> english,
                                        List<Integer> codePages) {
            int rows = codePages.size();
            if (lines.isEmpty()) {
                return List.of();
            }
            double width = columnWidth(lines);
            String[] out = new String[rows];
            int lineStart = 0;
            while (lineStart < lines.size()) {
                int pg = pages.get(lineStart);
                int lineEnd = lineStart;
                while (lineEnd < lines.size() && pages.get(lineEnd) == pg) {
                    lineEnd++;
                }
                List<String> pageLines = lines.subList(lineStart, lineEnd);
                List<Integer> rowIdx = new ArrayList<>();
                for (int r = 0; r < rows; r++) {
                    if (codePages.get(r) == pg) {
                        rowIdx.add(r);
                    }
                }
                if (rowIdx.isEmpty()) {
                    // Continuation of the last row of an earlier page.
                    int last = -1;
                    for (int r = 0; r < rows; r++) {
                        if (codePages.get(r) < pg) {
                            last = r;
                        }
                    }
                    if (last >= 0) {
                        out[last] = clean((out[last] == null ? "" : out[last] + " ") + String.join(" ", pageLines));
                    }
                } else {
                    List<String> en = new ArrayList<>();
                    for (int r : rowIdx) {
                        en.add(r < english.size() ? english.get(r) : "");
                    }
                    List<String> segments = splitArabic(pageLines, en, width);
                    for (int s = 0; s < segments.size() && s < rowIdx.size(); s++) {
                        out[rowIdx.get(s)] = segments.get(s);
                    }
                }
                lineStart = lineEnd;
            }
            List<String> result = new ArrayList<>();
            for (String s : out) {
                result.add(s == null ? "" : s);
            }
            return result;
        }

        private List<String> arabicWithoutCodes(List<String> lines) {
            double width = columnWidth(lines);
            List<String> out = new ArrayList<>();
            StringBuilder current = null;
            for (int i = 0; i < lines.size(); i++) {
                if (current == null || gapScore(lines.get(i - 1), lines.get(i), width) >= 1.5) {
                    if (current != null) {
                        out.add(clean(current.toString()));
                    }
                    current = new StringBuilder(lines.get(i));
                } else {
                    current.append(' ').append(lines.get(i));
                }
            }
            if (current != null) {
                out.add(clean(current.toString()));
            }
            return out;
        }

        /** Splits the Arabic lines of one page into exactly {@code english.size()} rows. */
        private List<String> splitArabic(List<String> lines, List<String> english, double width) {
            int n = english.size();
            int m = lines.size();
            if (m <= n) {
                return new ArrayList<>(lines);
            }
            double enTotal = 0;
            double arTotal = 0;
            for (String e : english) {
                enTotal += e.length();
            }
            for (String a : lines) {
                arTotal += a.length() + 1;
            }
            double ratio = enTotal > 0 ? arTotal / enTotal : 1;
            double[] gap = new double[m];
            for (int i = 1; i < m; i++) {
                gap[i] = gapScore(lines.get(i - 1), lines.get(i), width);
            }
            double[][] dp = new double[m + 1][n + 1];
            int[][] from = new int[m + 1][n + 1];
            for (double[] row : dp) {
                Arrays.fill(row, NEG);
            }
            dp[0][0] = 0;
            for (int r = 1; r <= n; r++) {
                for (int j = r; j <= m - (n - r); j++) {
                    for (int i = r - 1; i < j; i++) {
                        if (dp[i][r - 1] == NEG) {
                            continue;
                        }
                        int len = 0;
                        for (int x = i; x < j; x++) {
                            len += lines.get(x).length() + 1;
                        }
                        double expected = ratio * english.get(r - 1).length();
                        double v = dp[i][r - 1]
                                - LENGTH_WEIGHT * Math.abs(Math.log((len + 15.0) / (expected + 15.0)))
                                + (i > 0 ? gap[i] : 0);
                        if (v > dp[j][r]) {
                            dp[j][r] = v;
                            from[j][r] = i;
                        }
                    }
                }
            }
            List<String> out = new ArrayList<>();
            int j = m;
            for (int r = n; r >= 1; r--) {
                int i = from[j][r];
                out.add(0, clean(String.join(" ", lines.subList(i, j))));
                j = i;
            }
            return out;
        }

        /** How strongly a row boundary sits between two consecutive Arabic lines. */
        private double gapScore(String prev, String next, double width) {
            String p = prev.trim();
            String n = next.trim();
            double fill = (p.length() + 1 + firstWord(n).length()) / width;
            double score = FILL_WEIGHT * clamp(1 - fill);
            if (AR_CONNECTOR_END.matcher(p).matches()) {
                score -= 2;
            }
            if (count(p, '(') > count(p, ')') || endsInsideQuote(p)) {
                score -= 3;
            }
            if (!n.isEmpty() && "(.•،,)".indexOf(n.charAt(0)) >= 0) {
                score -= 2;
            }
            return score;
        }

        private static double columnWidth(List<String> texts) {
            double max = 0;
            for (String t : texts) {
                max = Math.max(max, t.length());
            }
            return Math.max(max, 20);
        }
    }

    private static String firstWord(String text) {
        String t = text.trim();
        int sp = t.indexOf(' ');
        return sp < 0 ? t : t.substring(0, sp);
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }

    /** True when the line opens a quotation that it does not close (the phrase continues below). */
    private static boolean endsInsideQuote(String s) {
        boolean open = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '"' && c != '“' && c != '”') {
                continue;
            }
            boolean before = i == 0 || Character.isWhitespace(s.charAt(i - 1));
            boolean after = i + 1 < s.length() && Character.isLetter(s.charAt(i + 1));
            open = before && after;
        }
        return open;
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
}
