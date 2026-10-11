package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.HeadingSectionSupport.isNoiseLine;
import static com.facetech.backend.parser.impl.HeadingSectionSupport.splitLines;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * SRTIP (Sharjah Research Technology and Innovation Park) free zone licence certificate.
 *
 * <p>The certificate is a three-column table: English label | value(s) | Arabic label. English and
 * Arabic values sit next to their own labels, while the licence number, address and dates are printed
 * once in the centre column. Document AI emits the columns in arbitrary order, typically as a run of
 * consecutive labels followed by their values in the same order. The extractor therefore rebuilds each
 * language column as a sequence of label groups and assigns the value lines that follow a group back
 * to its labels positionally (single-line fields take one line each; the group's multi-line field —
 * activities, owners, remarks — takes the rest). Only the template's printed labels are used; no
 * document values are hard-coded.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SharjahResearchTechnologyInnovationParkTradeLicenceExtractor {

    @SuppressWarnings("unused")
    private final ArabicTextProcessor arabicTextProcessor;

    private enum Lang { EN, AR }

    private enum Field {
        LICENSE_NO, NAME, LEGAL, SEGMENT, ACTIVITY, OWNER, MANAGER, ADDRESS,
        INCORPORATION, ISSUE, EXPIRY, REMARKS, SIGN_DATE, CONTINUATION
    }

    private static final Set<Field> MULTI_LINE = EnumSet.of(Field.ACTIVITY, Field.OWNER, Field.REMARKS);
    private static final List<Field> DATE_FIELDS = List.of(Field.INCORPORATION, Field.ISSUE, Field.EXPIRY);
    /** Fields whose value is written in the language's own column; the rest are centre-column fields. */
    private static final Set<Field> EN_TEXT = EnumSet.of(Field.NAME, Field.LEGAL, Field.SEGMENT, Field.ACTIVITY,
            Field.OWNER, Field.MANAGER, Field.ADDRESS, Field.REMARKS);
    /** The address is printed once, in Latin script, in the centre column — the Arabic label has no own value. */
    private static final Set<Field> AR_TEXT = EnumSet.of(Field.NAME, Field.LEGAL, Field.SEGMENT, Field.ACTIVITY,
            Field.OWNER, Field.MANAGER, Field.REMARKS);

    /**
     * Printed label. {@code distinctive} (multi-word) labels may carry an inline value without a colon;
     * single-word labels must be followed by a colon or stand alone on the line.
     */
    private record LabelDef(Field field, Lang lang, Pattern prefix, boolean distinctive) {
    }

    private static final List<LabelDef> LABELS = List.of(
            en(Field.LICENSE_NO, "LICEN[CS]E\\s*(?:NO|NUMBER)\\.?", true),
            en(Field.NAME, "(?:COMPANY\\s+|TRADE\\s+)?NAME", false),
            en(Field.LEGAL, "LEGAL\\s+(?:STATUS|FORM|TYPE)", true),
            en(Field.SEGMENT, "SEGMENT(?:\\s+OF(?:\\s+LICEN[CS]E)?)?", true),
            en(Field.ACTIVITY, "ACTIVIT(?:Y|IES)(?:\\s*\\(\\s*S\\s*\\))?", false),
            en(Field.OWNER, "OWNERS?(?:\\s*\\(\\s*S\\s*\\))?", false),
            en(Field.MANAGER, "MANAGER", false),
            en(Field.ADDRESS, "(?:SRTIP\\s+)?ADDRESS", false),
            en(Field.INCORPORATION, "INCORPORATION(?:\\s+DATE)?", true),
            en(Field.ISSUE, "ISSUE\\s+DATE", true),
            en(Field.EXPIRY, "EXPIRY\\s+DATE", true),
            en(Field.REMARKS, "REMARKS?", false),
            en(Field.SIGN_DATE, "DATE", false),
            ar(Field.LICENSE_NO, "رقم\\s+الرخصة", true),
            ar(Field.LICENSE_NO, "رقم", false),
            ar(Field.NAME, "الاسم", false),
            ar(Field.LEGAL, "الشكل\\s+القانوني", true),
            ar(Field.LEGAL, "الشكل", false),
            ar(Field.SEGMENT, "نوع\\s+الرخصة", true),
            ar(Field.SEGMENT, "نوع", false),
            ar(Field.ACTIVITY, "(?:النشاط|الانشطة|الأنشطة)", false),
            ar(Field.OWNER, "(?:المالك|الملاك)", false),
            ar(Field.MANAGER, "المدير\\s+المس[ئؤ]ول", true),
            ar(Field.MANAGER, "المدير", false),
            ar(Field.ADDRESS, "العنوان", false),
            ar(Field.INCORPORATION, "تاريخ\\s+(?:عقد(?:\\s+التأسيس)?|التأسيس)", true),
            ar(Field.ISSUE, "تاريخ\\s+ال[اإ]صدار", true),
            ar(Field.EXPIRY, "تاريخ\\s+الانتهاء", true),
            ar(Field.REMARKS, "ملاحظات", false),
            ar(Field.SIGN_DATE, "التاريخ", false)
    );

    /** Second halves of labels that OCR splits over two lines ("SEGMENT OF" / "LICENSE:", "نوع" / "الرخصة:"). */
    private static final Pattern EN_LABEL_TAIL = Pattern.compile("(?i)^(?:LICEN[CS]E|STATUS)\\s*:?$");
    private static final Pattern AR_LABEL_TAIL = Pattern.compile(
            "^(?:الرخصة|القانوني|المسئول|المسؤول|التأسيس|الاصدار|الإصدار|الانتهاء|عقد(?:\\s+التأسيس)?)\\s*:?$");
    /** A bare "تاريخ" (date) whose qualifier landed on a following line. */
    private static final Pattern AR_BARE_DATE = Pattern.compile("^تاريخ\\s*:?$");

    private static final Pattern STANDALONE_DATE = Pattern.compile(
            "^(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|\\d{4}-\\d{2}-\\d{2})$");
    private static final Pattern LICENSE_TOKEN = Pattern.compile("(?i)^[A-Z]{0,5}[-/]?\\d{3,12}$");
    private static final Pattern EN_CONNECTOR_END = Pattern.compile(
            "(?i).*(?:[&,/\\-]|\\b(?:and|of|for|in|the|through|with|to|or))$");

    private static LabelDef en(Field f, String regex, boolean distinctive) {
        return new LabelDef(f, Lang.EN, Pattern.compile("(?i)^" + regex), distinctive);
    }

    private static LabelDef ar(Field f, String regex, boolean distinctive) {
        return new LabelDef(f, Lang.AR, Pattern.compile("^" + regex), distinctive);
    }

    /** A detected label occurrence. */
    private record Label(Field field, Lang lang, String inline) {
    }

    /** Consecutive labels of one language column plus the value lines printed for them. */
    private static final class Group {
        final List<Field> fields = new ArrayList<>();
        final List<String> values = new ArrayList<>();
    }

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String[] rawLines = splitLines(ocrText.replace("\r\n", "\n").replace("\r", "\n"));
        String[] lines = new String[rawLines.length];
        for (int i = 0; i < rawLines.length; i++) {
            lines[i] = cleanLine(rawLines[i]);
        }

        Map<Lang, List<Group>> groups = new EnumMap<>(Lang.class);
        groups.put(Lang.EN, new ArrayList<>());
        groups.put(Lang.AR, new ArrayList<>());
        Map<Lang, Group> open = new EnumMap<>(Lang.class);

        List<Integer> licenseLabelLines = new ArrayList<>();
        List<String> licenseInline = new ArrayList<>();
        Set<Field> dateLabels = EnumSet.noneOf(Field.class);
        Map<Field, String> inlineDates = new EnumMap<>(Field.class);
        int firstDateLabel = -1;
        List<Integer> signDateLines = new ArrayList<>();

        Label previous = null;
        for (int i = 0; i < lines.length; i++) {
            Label label = detectLabel(lines, i, previous);
            if (label != null) {
                previous = label;
                if (label.field() == Field.CONTINUATION) {
                    continue;
                }
                Lang lang = label.lang();
                Field field = label.field();
                if (field == Field.SIGN_DATE) {
                    // Signature block: whatever follows is no longer part of the licence table.
                    open.remove(lang);
                    signDateLines.add(i);
                    continue;
                }
                boolean textual = (lang == Lang.EN ? EN_TEXT : AR_TEXT).contains(field);
                if (textual) {
                    Group g = open.get(lang);
                    if (g == null || !g.values.isEmpty()) {
                        g = new Group();
                        groups.get(lang).add(g);
                        open.put(lang, g);
                    }
                    g.fields.add(field);
                    if (!label.inline().isBlank()) {
                        g.values.add(label.inline());
                    }
                    continue;
                }
                // Centre-column label (licence no, dates, Arabic address): ends a group that already has values.
                Group g = open.get(lang);
                if (g != null && !g.values.isEmpty()) {
                    open.remove(lang);
                }
                if (field == Field.LICENSE_NO) {
                    licenseLabelLines.add(i);
                    if (isLicenseToken(label.inline())) {
                        licenseInline.add(label.inline().toUpperCase(Locale.ROOT));
                    }
                } else if (DATE_FIELDS.contains(field)) {
                    dateLabels.add(field);
                    if (firstDateLabel < 0) {
                        firstDateLabel = i;
                    }
                    String d = firstDate(label.inline());
                    if (!d.isBlank()) {
                        inlineDates.putIfAbsent(field, normalizeDate(d));
                    }
                }
                continue;
            }
            previous = null;
            String line = lines[i];
            if (!isValueLine(line)) {
                continue;
            }
            Lang lang = scriptOf(line);
            if (lang == null) {
                continue;
            }
            Group g = open.get(lang);
            if (g != null) {
                g.values.add(line);
            }
        }

        Map<Field, List<String>> en = resolve(groups.get(Lang.EN));
        Map<Field, List<String>> ar = resolve(groups.get(Lang.AR));

        String licenseNo = licenseInline.isEmpty() ? nearestLicenseToken(lines, licenseLabelLines) : licenseInline.get(0);
        addIfNotEmpty(result, "licenseNo", licenseNo);
        // SRTIP prints a single number: the licence number is also the free-zone registration number.
        addIfNotEmpty(result, "registerNo", licenseNo);

        String company = single(en, Field.NAME);
        String companyAr = single(ar, Field.NAME);
        addIfNotEmpty(result, "companyName", company);
        addIfNotEmpty(result, "businessName", company);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        addIfNotEmpty(result, "legalType", single(en, Field.LEGAL));
        addIfNotEmpty(result, "legalTypeAr", single(ar, Field.LEGAL));
        addIfNotEmpty(result, "licenceType", single(en, Field.SEGMENT));
        addIfNotEmpty(result, "licenceTypeAr", single(ar, Field.SEGMENT));

        List<String> actsEn = new ArrayList<>(en.getOrDefault(Field.ACTIVITY, List.of()));
        List<String> actsAr = new ArrayList<>(ar.getOrDefault(Field.ACTIVITY, List.of()));
        if (!actsEn.isEmpty() && !actsAr.isEmpty()) {
            mergeWrappedLines(actsEn, actsAr.size(), true);
            mergeWrappedLines(actsAr, actsEn.size(), false);
        }
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(actsEn, actsAr));

        List<String> ownersEn = en.getOrDefault(Field.OWNER, List.of());
        List<String> ownersAr = ar.getOrDefault(Field.OWNER, List.of());
        String manager = single(en, Field.MANAGER);
        String managerAr = single(ar, Field.MANAGER);
        addIfNotEmpty(result, "manager", manager);
        addIfNotEmpty(result, "managerAr", managerAr);

        addIfNotEmpty(result, "address", single(en, Field.ADDRESS));

        Map<Field, String> dates = assignDates(lines, dateLabels, inlineDates, firstDateLabel, signDateLines);
        addIfNotEmpty(result, "establishmentDate", dates.get(Field.INCORPORATION));
        addIfNotEmpty(result, "issueDate", dates.get(Field.ISSUE));
        addIfNotEmpty(result, "expiryDate", dates.get(Field.EXPIRY));

        addIfNotEmpty(result, "licenseMembers",
                toPersonJson(buildMembers(ownersEn, ownersAr, manager, managerAr)));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("SRTIP trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    // ---------------------------------------------------------------- labels

    private Label detectLabel(String[] lines, int i, Label previous) {
        String line = lines[i];
        if (EN_LABEL_TAIL.matcher(line).matches()) {
            return new Label(Field.CONTINUATION, Lang.EN, "");
        }
        if (AR_LABEL_TAIL.matcher(line).matches()) {
            return new Label(Field.CONTINUATION, Lang.AR, "");
        }
        if (AR_BARE_DATE.matcher(line).matches()) {
            return new Label(bareArabicDateKind(lines, i), Lang.AR, "");
        }
        for (LabelDef def : LABELS) {
            Matcher m = def.prefix().matcher(line);
            if (!m.find()) {
                continue;
            }
            String rest = line.substring(m.end());
            if (!rest.isEmpty() && Character.isLetterOrDigit(rest.charAt(0))) {
                continue; // prefix of a longer word, not a label
            }
            String trimmed = rest.trim();
            String inline;
            if (trimmed.isEmpty()) {
                inline = "";
            } else if (trimmed.startsWith(":")) {
                inline = trimmed.substring(1).trim();
            } else if (def.distinctive()) {
                inline = trimmed;
            } else {
                continue;
            }
            Field field = def.field();
            if (field == Field.SIGN_DATE) {
                if (!inline.isEmpty()) {
                    continue;
                }
                // "INCORPORATION" / "DATE:" split over two lines.
                if (previous != null && previous.field() == Field.INCORPORATION && previous.lang() == def.lang()) {
                    return new Label(Field.CONTINUATION, def.lang(), "");
                }
            }
            return new Label(field, def.lang(), inline);
        }
        return null;
    }

    /** Resolves a bare "تاريخ" label from the qualifier OCR placed on the next line(s). */
    private Field bareArabicDateKind(String[] lines, int i) {
        for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            String next = lines[j];
            if (next.startsWith("الاصدار") || next.startsWith("الإصدار")) {
                return Field.ISSUE;
            }
            if (next.startsWith("الانتهاء")) {
                return Field.EXPIRY;
            }
            if (next.startsWith("عقد") || next.startsWith("التأسيس")) {
                return Field.INCORPORATION;
            }
        }
        return Field.SIGN_DATE;
    }

    // ---------------------------------------------------------------- values

    private boolean isValueLine(String line) {
        if (line.length() < 2 || isNoiseLine(line)) {
            return false;
        }
        return !STANDALONE_DATE.matcher(line).matches() && !isLicenseToken(line);
    }

    /** Script of a value line by its dominant letters; {@code null} when it has neither Latin nor Arabic letters. */
    private Lang scriptOf(String line) {
        int latin = 0;
        int arabic = 0;
        for (char c : line.toCharArray()) {
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
                latin++;
            } else if (c >= '؀' && c <= 'ۿ' && Character.isLetter(c)) {
                arabic++;
            }
        }
        if (latin == 0 && arabic == 0) {
            return null;
        }
        return latin >= arabic ? Lang.EN : Lang.AR;
    }

    /**
     * Assigns each group's value lines to its labels in printed order: single-line fields before the
     * group's multi-line field take one line each from the front, those after it take one each from the
     * back, and the multi-line field keeps the middle. Without a multi-line field, surplus lines are a
     * wrapped continuation of the last single field.
     */
    private Map<Field, List<String>> resolve(List<Group> groups) {
        Map<Field, List<String>> out = new EnumMap<>(Field.class);
        for (Group g : groups) {
            List<Field> fields = g.fields;
            List<String> values = g.values;
            if (fields.isEmpty() || values.isEmpty()) {
                continue;
            }
            int multi = -1;
            for (int k = 0; k < fields.size(); k++) {
                if (MULTI_LINE.contains(fields.get(k))) {
                    multi = k;
                    break;
                }
            }
            Map<Field, List<String>> local = new LinkedHashMap<>();
            if (multi < 0) {
                Map<Field, List<String>> parts = new LinkedHashMap<>();
                for (int k = 0; k < values.size(); k++) {
                    Field f = fields.get(Math.min(k, fields.size() - 1));
                    parts.computeIfAbsent(f, x -> new ArrayList<>()).add(values.get(k));
                }
                parts.forEach((f, v) -> local.put(f, List.of(String.join(" ", v))));
            } else {
                int start = 0;
                int end = values.size();
                for (int k = 0; k < multi && start < end; k++) {
                    local.put(fields.get(k), List.of(values.get(start++)));
                }
                // keep at least one line for the multi-line field before serving trailing single fields
                for (int k = fields.size() - 1; k > multi && end - start > 1; k--) {
                    local.put(fields.get(k), List.of(values.get(--end)));
                }
                if (start < end) {
                    local.put(fields.get(multi), new ArrayList<>(values.subList(start, end)));
                }
            }
            local.forEach(out::putIfAbsent);
        }
        return out;
    }

    private static String single(Map<Field, List<String>> map, Field field) {
        List<String> v = map.get(field);
        return v == null || v.isEmpty() ? "" : v.get(0);
    }

    /**
     * Rejoins list items that OCR broke over two lines until the list is as long as its counterpart
     * column. A wrapped tail is recognised structurally: an English line starting in lower case or
     * following a line that ends in a connector; otherwise the line with the fewest words.
     */
    private void mergeWrappedLines(List<String> items, int target, boolean english) {
        while (items.size() > target && items.size() > 1) {
            int best = -1;
            if (english) {
                for (int k = 1; k < items.size(); k++) {
                    if (Character.isLowerCase(items.get(k).charAt(0))
                            || EN_CONNECTOR_END.matcher(items.get(k - 1)).matches()) {
                        best = k;
                        break;
                    }
                }
            }
            if (best < 0) {
                int fewest = Integer.MAX_VALUE;
                for (int k = 1; k < items.size(); k++) {
                    int words = items.get(k).split("\\s+").length;
                    if (words < fewest) {
                        fewest = words;
                        best = k;
                    }
                }
            }
            items.set(best - 1, items.get(best - 1) + " " + items.get(best));
            items.remove(best);
        }
    }

    // ---------------------------------------------------------------- centre column

    private boolean isLicenseToken(String value) {
        return value != null && LICENSE_TOKEN.matcher(value.trim()).matches()
                && !STANDALONE_DATE.matcher(value.trim()).matches();
    }

    /** The licence number is the code-like line closest to either licence-number label. */
    private String nearestLicenseToken(String[] lines, List<Integer> labelLines) {
        String best = "";
        int bestDistance = Integer.MAX_VALUE;
        for (int i = 0; i < lines.length; i++) {
            if (!isLicenseToken(lines[i])) {
                continue;
            }
            if (labelLines.isEmpty()) {
                return lines[i].toUpperCase(Locale.ROOT);
            }
            for (int label : labelLines) {
                int d = Math.abs(i - label);
                if (d < bestDistance) {
                    bestDistance = d;
                    best = lines[i];
                }
            }
        }
        return best.toUpperCase(Locale.ROOT);
    }

    /**
     * Centre-column dates are printed in label order (incorporation, issue, expiry): they are the first
     * standalone date lines after the first date label, skipping a signature date printed under "Date:".
     */
    private Map<Field, String> assignDates(String[] lines, Set<Field> dateLabels, Map<Field, String> inline,
                                           int firstDateLabel, List<Integer> signDateLines) {
        Map<Field, String> out = new EnumMap<>(Field.class);
        out.putAll(inline);
        List<Field> pending = new ArrayList<>();
        for (Field f : DATE_FIELDS) {
            if (dateLabels.contains(f) && !out.containsKey(f)) {
                pending.add(f);
            }
        }
        if (pending.isEmpty() || firstDateLabel < 0) {
            return out;
        }
        int k = 0;
        for (int i = firstDateLabel + 1; i < lines.length && k < pending.size(); i++) {
            if (!STANDALONE_DATE.matcher(lines[i]).matches()) {
                continue;
            }
            int line = i;
            if (signDateLines.stream().anyMatch(s -> line > s && line - s <= 2)) {
                continue;
            }
            out.put(pending.get(k++), normalizeDate(lines[i]));
        }
        return out;
    }

    // ---------------------------------------------------------------- members

    private List<Map<String, String>> buildMembers(List<String> ownersEn, List<String> ownersAr,
                                                   String manager, String managerAr) {
        List<Map<String, String>> people = new ArrayList<>();
        boolean managerPlaced = false;
        int n = Math.max(ownersEn.size(), ownersAr.size());
        for (int i = 0; i < n; i++) {
            String nameEn = i < ownersEn.size() ? ownersEn.get(i) : "";
            String nameAr = i < ownersAr.size() ? ownersAr.get(i) : "";
            boolean isManager = !managerPlaced && (samePerson(nameEn, manager)
                    || (nameEn.isBlank() && manager.isBlank() && sameArabic(nameAr, managerAr)));
            Map<String, String> p = new LinkedHashMap<>();
            p.put("nameEn", nameEn);
            p.put("nameAr", nameAr.isBlank() && isManager ? managerAr : nameAr);
            p.put("role", isManager ? "Owner / Manager" : "Owner");
            managerPlaced |= isManager;
            people.add(p);
        }
        if (!managerPlaced && (!manager.isBlank() || !managerAr.isBlank())) {
            Map<String, String> p = new LinkedHashMap<>();
            p.put("nameEn", manager);
            p.put("nameAr", managerAr);
            p.put("role", "Manager");
            people.add(p);
        }
        return people;
    }

    private boolean samePerson(String a, String b) {
        if (a == null || b == null || a.isBlank() || b.isBlank()) {
            return false;
        }
        String na = a.toLowerCase(Locale.ROOT).replaceAll("[^a-z]+", " ").trim();
        String nb = b.toLowerCase(Locale.ROOT).replaceAll("[^a-z]+", " ").trim();
        return na.equals(nb);
    }

    private boolean sameArabic(String a, String b) {
        return a != null && b != null && !a.isBlank()
                && a.replaceAll("\\s+", "").equals(b.replaceAll("\\s+", ""));
    }

    // ---------------------------------------------------------------- text cleanup

    /**
     * Normalises OCR character variants without altering spelling: Persian yeh/keheh to their Arabic
     * forms, Arabic-Indic digits to ASCII, tatweel removed, whitespace collapsed.
     */
    private static String cleanLine(String raw) {
        StringBuilder sb = new StringBuilder(raw.length());
        for (char c : raw.toCharArray()) {
            if (c == 'ی') {
                sb.append('ي');
            } else if (c == 'ک') {
                sb.append('ك');
            } else if (c == 'ـ') {
                continue;
            } else if (c >= '٠' && c <= '٩') {
                sb.append((char) ('0' + (c - '٠')));
            } else if (c >= '۰' && c <= '۹') {
                sb.append((char) ('0' + (c - '۰')));
            } else {
                sb.append(c);
            }
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }
}
