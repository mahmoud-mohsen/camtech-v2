package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.HeadingSectionSupport.hasArabicLetters;
import static com.facetech.backend.parser.impl.HeadingSectionSupport.hasLatinLetters;
import static com.facetech.backend.parser.impl.HeadingSectionSupport.isNoiseLine;
import static com.facetech.backend.parser.impl.HeadingSectionSupport.splitLines;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * SAIF Zone (Sharjah Airport International Free Zone) licence certificates.
 *
 * <p>The certificate is a two-column bilingual form (English labels on the left, Arabic labels on the right).
 * Document AI returns each column as its own stream, but inside a stream the labels and values may come
 * interleaved ({@code LABEL, value, LABEL, value}) or grouped ({@code LABEL, LABEL, value, value}), and a value
 * can even precede its own label. The extractor therefore runs one label-driven pass per language:
 * <ul>
 *     <li>every label that is seen becomes <em>pending</em>; the next value line is given to the first pending
 *     field whose value type accepts it (so a date skips past a pending "REMARKS" to reach "ISSUE DATE");</li>
 *     <li>a value with no pending field is given to the next field in the template order that has not been
 *     labelled yet (handles values printed before their label, or a label the OCR dropped);</li>
 *     <li>list fields (activities, owners, address) keep collecting until the next label.</li>
 * </ul>
 * No sample company/person values are referenced anywhere.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SharjahAirportInternationalFreeZoneTradeLicenceExtractor {

    private final ArabicTextProcessor arabicTextProcessor;

    /** Template fields in the order they are printed on the certificate. */
    private enum Field {
        LICENSE_NO(false), NAME(false), LEGAL_STATUS(false), LICENCE_TYPE(false), ACTIVITIES(true),
        OWNERS(true), MANAGER(false), ADDRESS(true), INCORPORATION_DATE(false), ISSUE_DATE(false),
        EXPIRY_DATE(false), REMARKS(true);

        final boolean multi;

        Field(boolean multi) {
            this.multi = multi;
        }
    }

    private static final Map<Field, String[]> EN_LABELS = new EnumMap<>(Field.class);
    private static final Map<Field, String[]> AR_LABELS = new EnumMap<>(Field.class);

    static {
        EN_LABELS.put(Field.LICENSE_NO, new String[]{"LICENSE NO", "LICENCE NO", "LICENSE NUMBER", "LICENCE NUMBER"});
        EN_LABELS.put(Field.NAME, new String[]{"NAME", "COMPANY NAME", "TRADE NAME"});
        EN_LABELS.put(Field.LEGAL_STATUS, new String[]{"LEGAL STATUS", "LEGAL FORM"});
        EN_LABELS.put(Field.LICENCE_TYPE, new String[]{"TYPE OF LICENSE", "TYPE OF LICENCE", "LICENSE TYPE", "LICENCE TYPE"});
        EN_LABELS.put(Field.ACTIVITIES, new String[]{"ACTIVITY S", "ACTIVITY", "ACTIVITIES"});
        EN_LABELS.put(Field.OWNERS, new String[]{"OWNER S", "OWNER", "OWNERS", "SHAREHOLDER S", "SHAREHOLDERS"});
        EN_LABELS.put(Field.MANAGER, new String[]{"MANAGER", "GENERAL MANAGER"});
        EN_LABELS.put(Field.ADDRESS, new String[]{"ADDRESS", "SAIF ZONE ADDRESS"});
        EN_LABELS.put(Field.INCORPORATION_DATE, new String[]{"INCORPORATION DATE", "DATE OF INCORPORATION"});
        EN_LABELS.put(Field.ISSUE_DATE, new String[]{"ISSUE DATE", "DATE OF ISSUE"});
        EN_LABELS.put(Field.EXPIRY_DATE, new String[]{"EXPIRY DATE", "DATE OF EXPIRY"});
        EN_LABELS.put(Field.REMARKS, new String[]{"REMARKS"});

        AR_LABELS.put(Field.LICENSE_NO, new String[]{"رقم الرخصه"});
        AR_LABELS.put(Field.NAME, new String[]{"الاسم", "اسم الشركه"});
        AR_LABELS.put(Field.LEGAL_STATUS, new String[]{"الشكل القانوني"});
        AR_LABELS.put(Field.LICENCE_TYPE, new String[]{"نوع الرخصه"});
        AR_LABELS.put(Field.ACTIVITIES, new String[]{"النشاط", "الانشطه"});
        AR_LABELS.put(Field.OWNERS, new String[]{"المالك", "الملاك", "الشركاء"});
        AR_LABELS.put(Field.MANAGER, new String[]{"المدير المسوول", "المدير"});
        AR_LABELS.put(Field.ADDRESS, new String[]{"العنوان في", "العنوان"});
        AR_LABELS.put(Field.INCORPORATION_DATE, new String[]{"تاريخ عقد التاسيس", "تاريخ التاسيس"});
        AR_LABELS.put(Field.ISSUE_DATE, new String[]{"تاريخ الاصدار"});
        AR_LABELS.put(Field.EXPIRY_DATE, new String[]{"تاريخ الانتهاء"});
        AR_LABELS.put(Field.REMARKS, new String[]{"ملاحظات"});
    }

    /**
     * Template chrome (logo text, titles, label continuations) that is neither a label nor a value.
     * Compared on the normalized key of the whole line.
     */
    private static final List<String> CHROME = List.of(
            "SAIF ZONE", "SHARJAH AIRPORT INTERNATIONAL FREE ZONE", "LICENSE CERTIFICATE", "LICENCE CERTIFICATE",
            "GOVERNMENT OF SHARJAH",
            "المنطقه الحره لمطار الشارقه الدولي", "شهاده ترخيص", "حكومه الشارقه", "المنطقه الحره");

    private static final Pattern PERCENT = Pattern.compile("(\\d{1,3}(?:[.,]\\d{1,3})?)\\s*%");
    private static final Pattern AR_DATE = Pattern.compile(
            "(\\d{1,2})\\s*(يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر)\\s*(\\d{4})");
    private static final List<String> AR_MONTHS = List.of("يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو",
            "يوليو", "اغسطس", "سبتمبر", "اكتوبر", "نوفمبر", "ديسمبر");

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String[] lines = splitLines(ocrText.replace("\r\n", "\n").replace("\r", "\n"));
        Map<Field, List<String>> en = new LabelledStream(EN_LABELS, false).parse(lines);
        Map<Field, List<String>> ar = new LabelledStream(AR_LABELS, true).parse(lines);

        String licenseNo = first(en, Field.LICENSE_NO);
        if (licenseNo.isBlank()) {
            licenseNo = toWesternDigits(first(ar, Field.LICENSE_NO));
        }
        addIfNotEmpty(result, "licenseNo", licenseNo);
        // SAIF certificates carry a single identifier; the licence number doubles as the registration number.
        addIfNotEmpty(result, "registerNo", licenseNo);

        String company = first(en, Field.NAME);
        String companyAr = first(ar, Field.NAME);
        addIfNotEmpty(result, "companyName", company);
        addIfNotEmpty(result, "businessName", company);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        addIfNotEmpty(result, "legalType", first(en, Field.LEGAL_STATUS));
        addIfNotEmpty(result, "legalTypeAr", first(ar, Field.LEGAL_STATUS));
        addIfNotEmpty(result, "licenceType", first(en, Field.LICENCE_TYPE));
        addIfNotEmpty(result, "licenceTypeAr", first(ar, Field.LICENCE_TYPE));

        addIfNotEmpty(result, "licenseActivities",
                buildActivitiesJson(en.getOrDefault(Field.ACTIVITIES, List.of()),
                        ar.getOrDefault(Field.ACTIVITIES, List.of())));

        String manager = first(en, Field.MANAGER);
        String managerAr = first(ar, Field.MANAGER);
        addIfNotEmpty(result, "manager", manager);
        addIfNotEmpty(result, "managerAr", managerAr);

        addIfNotEmpty(result, "address", String.join(", ", en.getOrDefault(Field.ADDRESS, List.of())));
        addIfNotEmpty(result, "addressAr", String.join(", ", ar.getOrDefault(Field.ADDRESS, List.of())));

        addIfNotEmpty(result, "establishmentDate", date(en, ar, Field.INCORPORATION_DATE));
        addIfNotEmpty(result, "issueDate", date(en, ar, Field.ISSUE_DATE));
        addIfNotEmpty(result, "expiryDate", date(en, ar, Field.EXPIRY_DATE));

        addIfNotEmpty(result, "licenseMembers", toPersonJson(buildMembers(
                en.getOrDefault(Field.OWNERS, List.of()), ar.getOrDefault(Field.OWNERS, List.of()),
                manager, managerAr)));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("SAIF Zone trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    // ------------------------------------------------------------------ label-driven stream parser

    private final class LabelledStream {
        private final Map<Field, String[]> labels;
        private final boolean arabic;

        LabelledStream(Map<Field, String[]> labels, boolean arabic) {
            this.labels = labels;
            this.arabic = arabic;
        }

        Map<Field, List<String>> parse(String[] lines) {
            Map<Field, List<String>> values = new EnumMap<>(Field.class);
            List<Field> pending = new ArrayList<>();
            boolean[] labelled = new boolean[Field.values().length];
            Field lastLabelled = null;

            for (String raw : lines) {
                String line = raw.replaceAll("\\s+", " ").trim();
                if (!belongsToStream(line) || isChrome(line) || isNoiseLine(line)) {
                    continue;
                }
                LabelHit hit = matchLabel(line);
                if (hit != null) {
                    // A new label closes any list field that already collected values.
                    pending.removeIf(f -> f.multi && values.containsKey(f));
                    labelled[hit.field.ordinal()] = true;
                    lastLabelled = hit.field;
                    boolean filled = values.containsKey(hit.field);
                    if (!hit.inline.isBlank() && accepts(hit.field, hit.inline) && (!filled || hit.field.multi)) {
                        add(values, hit.field, hit.inline);
                        filled = true;
                    }
                    if ((!filled || hit.field.multi) && !pending.contains(hit.field)) {
                        pending.add(hit.field);
                    }
                    continue;
                }

                Field target = null;
                for (Field f : pending) {
                    if (accepts(f, line)) {
                        target = f;
                        break;
                    }
                }
                if (target == null) {
                    // Value printed before its label (or label lost by OCR): next unlabelled template field.
                    int from = lastLabelled == null ? 0 : lastLabelled.ordinal() + 1;
                    for (int i = from; i < Field.values().length; i++) {
                        Field f = Field.values()[i];
                        if (!labelled[i] && !values.containsKey(f) && f != Field.REMARKS && accepts(f, line)) {
                            target = f;
                            break;
                        }
                    }
                    if (target == null) {
                        continue;
                    }
                }
                add(values, target, cleanValue(line));
                if (!target.multi) {
                    pending.remove(target);
                }
            }
            values.remove(Field.REMARKS);
            return values;
        }

        private boolean belongsToStream(String line) {
            if (arabic) {
                return hasArabicLetters(line) || line.matches(".*[\\u0660-\\u0669\\u06F0-\\u06F9].*");
            }
            return !hasArabicLetters(line);
        }

        private LabelHit matchLabel(String line) {
            String key = labelKey(line);
            LabelHit best = null;
            int bestLen = 0;
            for (Map.Entry<Field, String[]> e : labels.entrySet()) {
                for (String alias : e.getValue()) {
                    String a = labelKey(alias);
                    if (a.isEmpty()) {
                        continue;
                    }
                    String inline = null;
                    if (key.equals(a)) {
                        inline = "";
                    } else if (key.startsWith(a + " ")) {
                        inline = stripLabelWords(line, alias, true);
                    } else if (key.endsWith(" " + a)) {
                        inline = stripLabelWords(line, alias, false);
                    }
                    // An inline remainder only counts when it is a valid value for that label.
                    if (inline != null && (inline.isEmpty() || accepts(e.getKey(), inline)) && a.length() > bestLen) {
                        best = new LabelHit(e.getKey(), inline);
                        bestLen = a.length();
                    }
                }
            }
            return best;
        }

        private boolean accepts(Field field, String value) {
            String v = value.trim();
            if (v.isEmpty() || isChrome(v)) {
                return false;
            }
            boolean isDate = arabic ? !arabicDate(v).isBlank() : !firstDate(v).isBlank();
            return switch (field) {
                case LICENSE_NO -> toWesternDigits(v).matches("[A-Za-z]{0,4}[-/]?\\d{3,10}(?:[./-]\\d{1,4})?");
                case INCORPORATION_DATE, ISSUE_DATE, EXPIRY_DATE -> isDate;
                case REMARKS -> !isDate;
                default -> !isDate && hasLetters(v) && !toWesternDigits(v).matches("\\d+");
            };
        }

        private boolean hasLetters(String v) {
            return arabic ? hasArabicLetters(v) : hasLatinLetters(v);
        }
    }

    private record LabelHit(Field field, String inline) {
    }

    /** Removes the leading/trailing label words (same word count as the alias) from a raw line. */
    private String stripLabelWords(String line, String alias, boolean leading) {
        int words = labelKey(alias).split(" ").length;
        String[] tokens = line.trim().split("\\s+");
        List<String> kept = new ArrayList<>();
        int seen = 0;
        if (leading) {
            for (String t : tokens) {
                if (seen < words && !labelKey(t).isEmpty()) {
                    seen++;
                    continue;
                }
                if (seen < words) {
                    continue;
                }
                kept.add(t);
            }
        } else {
            for (int i = tokens.length - 1; i >= 0; i--) {
                if (seen < words && !labelKey(tokens[i]).isEmpty()) {
                    seen++;
                    continue;
                }
                if (seen < words) {
                    continue;
                }
                kept.add(0, tokens[i]);
            }
        }
        return cleanValue(String.join(" ", kept));
    }

    /** Label comparison key: upper-case letters only, Arabic letter variants and tatweel folded. */
    private String labelKey(String text) {
        String t = arabicTextProcessor.normalizeArabic(text == null ? "" : text)
                .replace('ـ', ' ')
                .replace('ة', 'ه')
                .replace('ى', 'ي')
                .toUpperCase(Locale.ROOT);
        return t.replaceAll("[^A-Z\\u0621-\\u064A]+", " ").trim();
    }

    private boolean isChrome(String line) {
        String key = labelKey(line);
        for (String c : CHROME) {
            if (key.equals(labelKey(c))) {
                return true;
            }
        }
        return false;
    }

    private static String cleanValue(String v) {
        return v.replaceAll("\\s+", " ").replaceAll("^[\\s:|]+|[\\s:|]+$", "").trim();
    }

    private static void add(Map<Field, List<String>> values, Field f, String v) {
        values.computeIfAbsent(f, k -> new ArrayList<>()).add(v);
    }

    private static String first(Map<Field, List<String>> values, Field f) {
        List<String> list = values.get(f);
        return list == null || list.isEmpty() ? "" : list.get(0);
    }

    private String date(Map<Field, List<String>> en, Map<Field, List<String>> ar, Field f) {
        String enValue = first(en, f);
        if (!enValue.isBlank()) {
            return normalizeDate(firstDate(enValue));
        }
        return arabicDate(first(ar, f));
    }

    /** Parses an Arabic "day month year" date (Arabic-Indic or western digits) to dd/MM/yyyy. */
    private String arabicDate(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        Matcher m = AR_DATE.matcher(labelKeyKeepDigits(value));
        if (!m.find()) {
            return "";
        }
        return String.format("%02d/%02d/%s", Integer.parseInt(m.group(1)),
                AR_MONTHS.indexOf(m.group(2)) + 1, m.group(3));
    }

    private String labelKeyKeepDigits(String value) {
        return arabicTextProcessor.normalizeArabic(toWesternDigits(value)).replace('ـ', ' ');
    }

    private static String toWesternDigits(String raw) {
        if (raw == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (char c : raw.toCharArray()) {
            if (c >= '٠' && c <= '٩') {
                sb.append((char) ('0' + (c - '٠')));
            } else if (c >= '۰' && c <= '۹') {
                sb.append((char) ('0' + (c - '۰')));
            } else {
                sb.append(c);
            }
        }
        return sb.toString().trim();
    }

    // ------------------------------------------------------------------ members

    private List<Map<String, String>> buildMembers(List<String> ownersEn, List<String> ownersAr,
                                                   String manager, String managerAr) {
        List<Map<String, String>> people = new ArrayList<>();
        int n = Math.max(ownersEn.size(), ownersAr.size());
        for (int i = 0; i < n; i++) {
            Map<String, String> p = new LinkedHashMap<>();
            String share = "";
            if (i < ownersEn.size()) {
                String[] split = splitShare(ownersEn.get(i));
                p.put("nameEn", split[0]);
                share = split[1];
            }
            if (i < ownersAr.size()) {
                String[] split = splitShare(ownersAr.get(i));
                p.put("nameAr", split[0]);
                if (share.isBlank()) {
                    share = split[1];
                }
            }
            boolean isManager = namesLikelySame(p.get("nameEn"), manager)
                    || (p.get("nameEn") == null && managerAr != null && !managerAr.isBlank()
                    && managerAr.equals(p.get("nameAr")));
            if (isManager && !p.containsKey("nameAr") && managerAr != null && !managerAr.isBlank()) {
                p.put("nameAr", managerAr);
            }
            if (!share.isBlank()) {
                p.put("share", share);
            }
            p.put("role", isManager ? "Owner / Manager" : "Owner");
            people.add(p);
        }
        boolean managerListed = people.stream().anyMatch(p -> "Owner / Manager".equals(p.get("role")));
        if (!managerListed && ((manager != null && !manager.isBlank()) || (managerAr != null && !managerAr.isBlank()))) {
            Map<String, String> p = new LinkedHashMap<>();
            if (manager != null && !manager.isBlank()) {
                p.put("nameEn", manager);
            }
            if (managerAr != null && !managerAr.isBlank()) {
                p.put("nameAr", managerAr);
            }
            p.put("role", "Manager");
            people.add(p);
        }
        return people;
    }

    /** Splits an optional "NN%" share off a member line: [name, share]. */
    private static String[] splitShare(String line) {
        Matcher m = PERCENT.matcher(toWesternDigits(line));
        if (!m.find()) {
            return new String[]{line.trim(), ""};
        }
        String name = toWesternDigits(line).replace(m.group(), " ")
                .replaceAll("[\\s\\-–:|()]+$", "").replaceAll("^[\\s\\-–:|()]+", "").replaceAll("\\s+", " ").trim();
        return new String[]{name, m.group(1).replace(',', '.') + "%"};
    }

    private static boolean namesLikelySame(String a, String b) {
        if (a == null || b == null || a.isBlank() || b.isBlank()) {
            return false;
        }
        String na = a.toLowerCase(Locale.ROOT).replaceAll("[^a-z\\s]", " ").replaceAll("\\s+", " ").trim();
        String nb = b.toLowerCase(Locale.ROOT).replaceAll("[^a-z\\s]", " ").replaceAll("\\s+", " ").trim();
        return !na.isEmpty() && na.equals(nb);
    }
}
