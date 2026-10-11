package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.ocr.dto.OcrResult;
import com.facetech.backend.parser.DocumentParser;
import com.facetech.backend.parser.extraction.Candidates;
import com.facetech.backend.parser.extraction.ExtractionSource;
import com.facetech.backend.parser.extraction.FieldCandidate;
import com.facetech.backend.parser.extraction.LayoutIndex;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import com.facetech.backend.util.EmiratesIdMrz;
import com.facetech.backend.util.EmiratesIdValidator;
import lombok.extern.slf4j.Slf4j;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Emirates ID front, back or both. Every value that can be read is collected with where it came from
 * (MRZ, position next to its label, label in the text, format alone, inference), then
 * {@link EmiratesIdResolver} picks one per field, validates it and scores it. Values are never trusted
 * just because a pattern matched: an ID number needs its check digit, a birth date must match the ID
 * year, and so on.
 */
@Slf4j
public abstract class EmiratesIdParser implements DocumentParser {

    private static final ZoneId UAE = ZoneId.of("Asia/Dubai");

    private final ArabicTextProcessor arabicTextProcessor;

    protected EmiratesIdParser(ArabicTextProcessor arabicTextProcessor) {
        this.arabicTextProcessor = arabicTextProcessor;
    }

    /** Which side(s) of the card this parser reads. */
    protected abstract EmiratesIdResolver.Side side();

    @Override
    public DocumentFieldsDto parse(String ocrText) {
        return parse(OcrResult.ofText(ocrText));
    }

    @Override
    public DocumentFieldsDto parse(OcrResult ocr) {
        return extract(ocr, side(), LocalDate.now(UAE));
    }

    // ── Patterns ──────────────────────────────────────────────────────────────

    /** 784-YYYY-NNNNNNN-C, tolerating letters OCR confuses with digits (checked by Luhn afterwards). */
    private static final Pattern ID_NUMBER_TOKEN = Pattern.compile(
            "(?<![0-9A-Za-z])7[8B][4A][- ]?[0-9OIlSB]{4}[- ]?[0-9OIlSB]{7}[- ]?[0-9OIlSB](?![0-9A-Za-z])"
    );
    private static final Pattern DATE_PATTERN = Pattern.compile("\\b(\\d{2})/(\\d{2})/(\\d{4})\\b");
    private static final Pattern PARTIAL_DATE_PATTERN = Pattern.compile("\\b(\\d{2})/(\\d{2})/(\\d{2,4})\\b");
    private static final Pattern GENDER_PATTERN = Pattern.compile(
            "(?i)\\b(?:sex|gender)\\s*[:.]?\\s*(male|female|m|f)\\b"
    );

    private static final Pattern ARABIC_NAME_LABEL = Pattern.compile(
            "^(?:ال(?:اس|إس)م|اسم|name)\\s*[:\\s]*",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern EN_FIELD_VALUE = Pattern.compile(
            "(?i)(occupation|employer|issuing\\s*place|card\\s*number|passport|nationality|date\\s*of)"
    );
    private static final Pattern HEADER_PAT_EN = Pattern.compile(
            "(?i)^(united arab emirates|federal authority|resident identity|identity card|issuing|expiry|date of birth|nationality|signature|recent identity)"
    );
    /** "الجنسية: مصر", also clipped ("سية : مصر"); the colon keeps the header "...والجنسية والجمارك..." out. */
    private static final Pattern AR_NATIONALITY_FRAGMENT = Pattern.compile(
            "(?:^|\\s)(?:الجنسية|الجنسيه|جنسية|سية)\\s*[:：]\\s*(.+)"
    );
    private static final Pattern AR_NAME_REJECT = Pattern.compile(
            "جنسية|سية\\s*:|^[^:]+:\\s*[^\\s]+\\s*$|مصر\\s*$|ميلاد|بطاقة|هوية|ذكر|أنثى|انثى"
    );
    private static final Pattern AR_HEADER = Pattern.compile(
            "إمارات|الإمارات|المتحدة|هوية|بطاقة|تاريخ|جنس|جنسية|سية|مهنة|صاحب|رقم|ميلاد|إصدار|انتهاء|توقيع|الهيئة|الاتحادية|لله|الجمارك|المسافة|مقيم|شرطة|مركز|إرجاع|جهة|العثور|البطاقة|الرجاء|عند|مصر"
    );
    private static final Pattern NATIONALITY_EN_REJECT = Pattern.compile(
            "(?i)^(caret|care|card|identity|resident|number|national|natl|nati|date|birth|sex|male|female|signature|expiry|issuing)$"
    );

    // Layout labels (English or Arabic) and the shape of their values.
    private static final Pattern L_ID = Pattern.compile("(?i)id\\s*number|رقم\\s*الهوية");
    private static final Pattern L_NAME = Pattern.compile("(?i)^\\s*name\\b");
    private static final Pattern L_NATIONALITY = Pattern.compile("(?i)nationality");
    private static final Pattern L_BIRTH = Pattern.compile("(?i)date\\s*of\\s*birth|تاريخ\\s*الميلاد");
    private static final Pattern L_ISSUE = Pattern.compile("(?i)issu\\w*\\s*date|date\\s*of\\s*issue|تاريخ\\s*الإصدار|تاريخ\\s*الاصدار");
    private static final Pattern L_EXPIRY = Pattern.compile("(?i)expiry\\s*date|date\\s*of\\s*expiry|تاريخ\\s*الانتهاء");
    private static final Pattern V_DATE = Pattern.compile("\\b(\\d{2}/\\d{2}/\\d{4})\\b");
    private static final Pattern V_LATIN_TEXT = Pattern.compile("^[\\s:./]*([A-Za-z][A-Za-z' .-]{2,})");

    // ── Extraction ────────────────────────────────────────────────────────────

    DocumentFieldsDto extract(OcrResult ocr, EmiratesIdResolver.Side side, LocalDate today) {
        String raw = ocr != null ? ocr.getFullText() : null;
        String text = raw == null ? "" : raw.replace("\r\n", "\n").replace("\r", "\n");
        Candidates c = new Candidates();
        Optional<EmiratesIdMrz.Result> mrz = EmiratesIdMrz.parse(text);
        if (text.isBlank()) {
            log.warn("Emirates ID {} parse: OCR text is empty", side);
        } else {
            mrz.ifPresent(m -> addMrz(m, c));
            LayoutIndex layout = LayoutIndex.of(ocr.getLines());
            if (side != EmiratesIdResolver.Side.BACK) {
                collectFront(text, layout, c);
            }
            if (side != EmiratesIdResolver.Side.FRONT) {
                collectBack(text, c);
            }
        }
        DocumentFieldsDto result = EmiratesIdResolver.resolve(c, mrz, side, today, raw);
        log.debug("Emirates ID {} parsed: {} fields, confidence={}, issues={}, mrz={}", side,
                result.getChecks().size(), result.getOverallConfidence(), result.getIssues(),
                mrz.map(m -> m.verified() ? "verified" : "unverified").orElse("none"));
        return result;
    }

    /** MRZ values: dates and card number arrive only when their check digit matched. */
    private static void addMrz(EmiratesIdMrz.Result m, Candidates c) {
        ExtractionSource checked = ExtractionSource.MRZ_VERIFIED;
        c.add("emiratesIdNumber", m.emiratesIdNumber(), m.verified() ? checked : ExtractionSource.MRZ);
        if (m.cardNumberValid()) {
            c.add("cardNumber", m.cardNumber(), checked);
        }
        if (m.dateOfBirth() != null) {
            c.add("dateOfBirth", m.dateOfBirth().format(EmiratesIdResolver.DISPLAY), checked);
        }
        if (m.expiryDate() != null) {
            c.add("expiryDate", m.expiryDate().format(EmiratesIdResolver.DISPLAY), checked);
        }
        if ("M".equals(m.sex()) || "F".equals(m.sex())) {
            boolean male = "M".equals(m.sex());
            c.add("gender", male ? "Male" : "Female", ExtractionSource.MRZ);
            c.add("genderAr", male ? "ذكر" : "أنثى", ExtractionSource.MRZ);
        }
        c.add("nationalityCode", m.nationality(), ExtractionSource.MRZ);
        c.add("fullNameEn", m.fullName(), ExtractionSource.MRZ);
    }

    private void collectFront(String text, LayoutIndex layout, Candidates c) {
        for (String id : findIdNumbers(text)) {
            c.add("emiratesIdNumber", id, ExtractionSource.PATTERN);
        }
        layout.valueNear(L_ID, ID_NUMBER_TOKEN).map(EmiratesIdParser::normalizeIdToken)
                .ifPresent(v -> c.add("emiratesIdNumber", v, ExtractionSource.LAYOUT));
        String idYear = birthYear(c);

        layout.valueNear(L_NAME, V_LATIN_TEXT).ifPresent(v -> c.add("fullNameEn", v, ExtractionSource.LAYOUT));
        c.add("fullNameEn", nameAfterLabel(text), ExtractionSource.LABEL);
        c.add("fullNameEn", nameByShape(text), ExtractionSource.INFERRED);
        FieldCandidate ar = extractFullNameAr(text);
        if (ar != null) {
            c.add("fullNameAr", ar.value(), ar.source());
        }

        collectDates(text, layout, idYear, c);

        c.add("gender", extractGender(text), ExtractionSource.LABEL);
        c.add("genderAr", extractArabicGender(text), ExtractionSource.LABEL);

        layout.valueNear(L_NATIONALITY, V_LATIN_TEXT).map(this::sanitizeNationalityEn)
                .ifPresent(v -> c.add("nationality", v, ExtractionSource.LAYOUT));
        c.add("nationality", sanitizeNationalityEn(extractNationality(text)), ExtractionSource.LABEL);
        c.add("nationalityAr", extractArabicNationality(text), ExtractionSource.LABEL);
    }

    private void collectBack(String text, Candidates c) {
        c.add("occupation", extractOccupation(text), ExtractionSource.LABEL);
        c.add("occupationAr", cleanOccupationAr(extractLabeledArabicField(text, "المهنة", "مهنة")), ExtractionSource.LABEL);
        c.add("employer", extractEmployer(text), ExtractionSource.LABEL);
        c.add("employerAr", extractEmployerAr(text), ExtractionSource.LABEL);
        c.add("issuingPlace", extractIssuingPlace(text), ExtractionSource.LABEL);
        c.add("issuingPlaceAr", extractLabeledArabicField(text, "مكان الإصدار", "مكان الاصدار"), ExtractionSource.LABEL);
    }

    /** Birth year (784-YYYY-...) of the most trusted ID number whose check digit matches, or "". */
    private static String birthYear(Candidates c) {
        for (FieldCandidate f : c.get("emiratesIdNumber")) {
            if (EmiratesIdValidator.isValidNumber(f.value())) {
                return EmiratesIdValidator.normalizeNumber(f.value()).substring(3, 7);
            }
        }
        return "";
    }

    // ── ID number ─────────────────────────────────────────────────────────────

    /** Every ID-number-shaped token, normalized to 784-YYYY-NNNNNNN-C; valid ones first. */
    static List<String> findIdNumbers(String text) {
        List<String> valid = new ArrayList<>();
        List<String> other = new ArrayList<>();
        Matcher m = ID_NUMBER_TOKEN.matcher(text);
        while (m.find()) {
            String id = normalizeIdToken(m.group());
            if (id == null) {
                continue;
            }
            (EmiratesIdValidator.isValidNumber(id) ? valid : other).add(id);
        }
        Matcher plain = Pattern.compile("(?<!\\d)784\\d{12}(?!\\d)").matcher(text);
        while (plain.find()) {
            String id = normalizeIdToken(plain.group());
            (EmiratesIdValidator.isValidNumber(id) ? valid : other).add(id);
        }
        valid.addAll(other);
        return valid.stream().distinct().toList();
    }

    /** Letters OCR reads in place of digits turned back into digits; null when not 15 digits. */
    static String normalizeIdToken(String token) {
        StringBuilder b = new StringBuilder();
        for (char ch : token.toCharArray()) {
            switch (ch) {
                case 'O' -> b.append('0');
                case 'I', 'l' -> b.append('1');
                case 'S' -> b.append('5');
                case 'B' -> b.append('8');
                case 'A' -> b.append('4');
                default -> {
                    if (Character.isDigit(ch)) {
                        b.append(ch);
                    }
                }
            }
        }
        String digits = b.toString();
        return digits.length() == 15
                ? digits.replaceFirst("(\\d{3})(\\d{4})(\\d{7})(\\d)", "$1-$2-$3-$4")
                : null;
    }

    // ── Names ─────────────────────────────────────────────────────────────────

    private String nameAfterLabel(String text) {
        for (String line : arabicTextProcessor.removeArabicText(text).split("\n")) {
            String lo = line.toLowerCase(Locale.ROOT).trim();
            if (lo.startsWith("name:") || lo.startsWith("name :")) {
                String val = line.replaceFirst("(?i)\\s*name\\s*:\\s*", "").trim();
                if (val.length() >= 3) {
                    return val;
                }
            }
        }
        return "";
    }

    /** A line shaped like a Latin name ("MAHMOUD Mohsen ...") that is not a card heading. */
    private String nameByShape(String text) {
        for (String line : arabicTextProcessor.removeArabicText(text).split("\n")) {
            String t = line.trim();
            if (t.matches("^[A-Z]{2,}(?:\\s+[A-Z][a-zA-Z]{1,})+$")
                    && t.length() >= 6 && t.length() <= 60
                    && !HEADER_PAT_EN.matcher(t).find()) {
                return t;
            }
        }
        return "";
    }

    private FieldCandidate extractFullNameAr(String text) {
        String[] lines = text.split("\n");
        for (String line : lines) {
            String t = line.trim();
            if (t.matches("^ال(?:اس|إس)م\\s+[^:].*") || t.matches("^اسم\\s+[^:].*")) {
                String val = cleanArabicName(t);
                if (val.length() >= 6) {
                    return new FieldCandidate(arabicTextProcessor.normalizeArabic(val), ExtractionSource.LABEL);
                }
            }
            if (t.startsWith("الإسم:") || t.startsWith("الاسم:") || t.startsWith("الإسم :") || t.startsWith("الاسم :")) {
                String val = t.replaceFirst("الإ?سم\\s*:\\s*", "").trim();
                if (val.length() >= 3) {
                    return new FieldCandidate(cleanArabicName(arabicTextProcessor.normalizeArabic(val)), ExtractionSource.LABEL);
                }
            }
        }
        for (String line : lines) {
            String t = line.trim();
            if (!isPlausibleArabicNameLine(t)) {
                continue;
            }
            if (arabicTextProcessor.containsArabic(t)
                    && !t.matches(".*\\d.*")
                    && !AR_HEADER.matcher(t).find()
                    && !t.contains("<<")
                    && t.length() >= 6
                    && t.split("\\s+").length >= 2) {
                String cleaned = cleanArabicName(t.replaceFirst("^[^\\u0600-\\u06FF]*", "").trim());
                if (cleaned.length() >= 6 && !cleaned.startsWith("اسم")) {
                    return new FieldCandidate(arabicTextProcessor.normalizeArabic(cleaned), ExtractionSource.INFERRED);
                }
            }
        }
        return null;
    }

    private String cleanArabicName(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        return ARABIC_NAME_LABEL.matcher(value.trim()).replaceFirst("").trim();
    }

    private boolean isPlausibleArabicNameLine(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String t = line.trim();
        if (t.contains(":") && t.length() < 24) {
            return false;
        }
        return !AR_NAME_REJECT.matcher(t).find();
    }

    // ── Dates ─────────────────────────────────────────────────────────────────

    private void collectDates(String text, LayoutIndex layout, String idYear, Candidates c) {
        layout.valueNear(L_BIRTH, V_DATE).ifPresent(v -> c.add("dateOfBirth", v, ExtractionSource.LAYOUT));
        layout.valueNear(L_ISSUE, V_DATE).ifPresent(v -> c.add("issueDate", v, ExtractionSource.LAYOUT));
        layout.valueNear(L_EXPIRY, V_DATE).ifPresent(v -> c.add("expiryDate", v, ExtractionSource.LAYOUT));

        // Every date near the birth label: the resolver keeps the one whose year matches the ID number.
        for (String d : datesAfterLabel(text, idYear, true,
                "date of birth", "dob", "birth date", "تاريخ الميلاد", "اريخ الميلاد", "الميلاد")) {
            c.add("dateOfBirth", d, ExtractionSource.LABEL);
        }
        // Arabic prefixes: OCR often clips "الانتهاء" (e.g. "الانتي").
        String expiry = first(datesAfterLabel(text, idYear, false,
                "expiry", "expiry date", "valid until", "تاريخ الانت", "تاريخ الإنت"));
        String issue = first(datesAfterLabel(text, idYear, false,
                "issue date", "issuing date", "date of issue", "issued on", "sing date", "تاريخ الإصدار"));
        c.add("expiryDate", expiry, ExtractionSource.LABEL);
        c.add("issueDate", issue, ExtractionSource.LABEL);

        List<String> dateStrings = new ArrayList<>();
        List<LocalDate> dateValues = new ArrayList<>();
        Matcher m = DATE_PATTERN.matcher(text);
        while (m.find()) {
            LocalDate d = parseDisplayDate(m.group());
            if (d != null) {
                dateStrings.add(m.group());
                dateValues.add(d);
            }
        }
        if (dateValues.isEmpty()) {
            return;
        }
        if (expiry.isEmpty()) {
            // The expiry is the latest date on the card; only when it comes after the issue date or well after birth.
            int latest = 0;
            for (int i = 1; i < dateValues.size(); i++) {
                if (dateValues.get(i).isAfter(dateValues.get(latest))) {
                    latest = i;
                }
            }
            LocalDate issued = parseDisplayDate(issue);
            LocalDate born = c.get("dateOfBirth").stream().map(f -> parseDisplayDate(f.value()))
                    .filter(java.util.Objects::nonNull).findFirst().orElse(null);
            if ((issued != null && dateValues.get(latest).isAfter(issued))
                    || (issued == null && born != null && dateValues.get(latest).isAfter(born.plusYears(10)))) {
                c.add("expiryDate", dateStrings.get(latest), ExtractionSource.INFERRED);
            }
        }
        if (!c.has("dateOfBirth") && !c.has("expiryDate") && !c.has("issueDate")) {
            // No label read at all: order the dates (birth < issue < expiry).
            List<Integer> idx = new ArrayList<>();
            for (int i = 0; i < dateValues.size(); i++) {
                idx.add(i);
            }
            idx.sort((a, b) -> dateValues.get(a).compareTo(dateValues.get(b)));
            if (dateValues.size() == 1) {
                c.add("expiryDate", dateStrings.get(idx.get(0)), ExtractionSource.INFERRED);
            } else {
                c.add("dateOfBirth", dateStrings.get(idx.get(0)), ExtractionSource.INFERRED);
                c.add("expiryDate", dateStrings.get(idx.get(idx.size() - 1)), ExtractionSource.INFERRED);
                if (dateValues.size() > 2) {
                    c.add("issueDate", dateStrings.get(idx.get(1)), ExtractionSource.INFERRED);
                }
            }
        }
    }

    private static String first(List<String> values) {
        return values.isEmpty() ? "" : values.get(0);
    }

    /**
     * Dates after the first line that holds one of the labels: on that line or the next few.
     *
     * @param all every date in the window (birth date) instead of the nearest one
     */
    private List<String> datesAfterLabel(String text, String idYear, boolean all, String... labels) {
        List<String> found = new ArrayList<>();
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase(Locale.ROOT);
            for (String label : labels) {
                String labelLower = label.toLowerCase(Locale.ROOT);
                if (!lo.contains(labelLower) && !lines[i].contains(label)) {
                    continue;
                }
                if (labelLower.contains("issue") && lo.contains("expiry") && !lo.contains("issue")) {
                    continue;
                }
                if (labelLower.contains("expiry") && lo.contains("issue") && !lo.contains("expiry")) {
                    continue;
                }
                boolean birth = labelLower.contains("birth") || labelLower.contains("dob") || label.contains("ميلاد");
                int window = birth ? 4 : 3;
                for (int offset = 0; offset <= window && i + offset < lines.length; offset++) {
                    String candidate = dateOn(lines[i + offset], idYear, birth);
                    if (!candidate.isEmpty() && !found.contains(candidate)) {
                        found.add(candidate);
                        if (!all) {
                            return found;
                        }
                    }
                }
                if (!found.isEmpty()) {
                    return found;
                }
            }
        }
        return found;
    }

    /** A full date on the line, or a date with a clipped year completed from the ID number. */
    private static String dateOn(String line, String idYear, boolean allowPartial) {
        Matcher m = DATE_PATTERN.matcher(line);
        if (m.find()) {
            return m.group();
        }
        return allowPartial ? normalizePartialDate(line, idYear) : "";
    }

    /**
     * "07/05/196" or "07/05/96" when the ID number says 1996: OCR dropped a digit of the year. Accepted
     * only when the digits read are the ID year with digits missing (in order), so a wrong year is never made up.
     */
    static String normalizePartialDate(String raw, String idBirthYear) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        Matcher m = PARTIAL_DATE_PATTERN.matcher(raw.trim());
        if (!m.find()) {
            return "";
        }
        String yy = m.group(3);
        if (yy.length() == 4) {
            return m.group(1) + "/" + m.group(2) + "/" + yy;
        }
        if (idBirthYear != null && idBirthYear.length() == 4 && isSubsequence(yy, idBirthYear)
                && (yy.length() == 3 || idBirthYear.endsWith(yy))) {
            return m.group(1) + "/" + m.group(2) + "/" + idBirthYear;
        }
        return "";
    }

    private static boolean isSubsequence(String part, String whole) {
        int j = 0;
        for (int i = 0; i < whole.length() && j < part.length(); i++) {
            if (whole.charAt(i) == part.charAt(j)) {
                j++;
            }
        }
        return j == part.length();
    }

    private static LocalDate parseDisplayDate(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return LocalDate.parse(value, DateTimeFormatter.ofPattern("dd/MM/uuuu")
                    .withResolverStyle(java.time.format.ResolverStyle.STRICT));
        } catch (Exception e) {
            return null;
        }
    }

    // ── Sex and nationality ───────────────────────────────────────────────────

    private String extractGender(String text) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        Matcher explicit = GENDER_PATTERN.matcher(noArabic);
        if (explicit.find()) {
            String g = explicit.group(1).toLowerCase(Locale.ROOT);
            return (g.equals("male") || g.equals("m")) ? "Male" : "Female";
        }
        return "";
    }

    private String extractArabicGender(String text) {
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (t.equals("ذكر")) {
                return "ذكر";
            }
            if (t.equals("أنثى") || t.equals("انثى")) {
                return "أنثى";
            }
            if (t.contains("الجنس")) {
                if (t.contains("ذكر")) {
                    return "ذكر";
                }
                if (t.contains("أنثى") || t.contains("انثى")) {
                    return "أنثى";
                }
            }
        }
        return "";
    }

    private String extractNationality(String text) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        for (String line : noArabic.split("\n")) {
            String lo = line.toLowerCase(Locale.ROOT).trim();
            if (lo.startsWith("nationality")) {
                String val = line.replaceFirst("(?i)\\s*nationality\\s*[:.\\s]\\s*", "").trim();
                if (!val.isEmpty()) {
                    return val;
                }
            }
        }
        return "";
    }

    private String sanitizeNationalityEn(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String trimmed = value.trim();
        if (EN_FIELD_VALUE.matcher(trimmed).find()
                || trimmed.matches("(?i)^(date|birth|sex|signature|expiry|issuing).*")
                || NATIONALITY_EN_REJECT.matcher(trimmed).matches()) {
            return "";
        }
        // Single-token OCR noise after the Nationality label (not a usable country name)
        if (!trimmed.contains(" ") && trimmed.length() <= 6 && !trimmed.matches("(?i)[A-Z][a-z]{3,}")) {
            return "";
        }
        return trimmed;
    }

    private String extractArabicNationality(String text) {
        String[] lines = text.split("\n");
        for (String line : lines) {
            Matcher fragment = AR_NATIONALITY_FRAGMENT.matcher(line.trim());
            if (fragment.find()) {
                String val = fragment.group(1).trim();
                if (!val.isEmpty() && arabicTextProcessor.containsArabic(val) && !val.contains("الجنس")) {
                    return arabicTextProcessor.normalizeArabic(val);
                }
            }
        }
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (!t.startsWith("الجنسية") || t.contains("الجنس :")) {
                continue;
            }
            String val = t.replaceFirst("^الجنسية\\s*[:\\s]*", "").trim();
            if (!val.isEmpty() && arabicTextProcessor.containsArabic(val) && !AR_HEADER.matcher(val).find()) {
                return arabicTextProcessor.normalizeArabic(val);
            }
            // The label alone on its line, value on the next one.
            if (val.isEmpty() && i + 1 < lines.length && arabicTextProcessor.containsArabic(lines[i + 1])
                    && !lines[i + 1].contains("الجنس") && !AR_HEADER.matcher(lines[i + 1]).find()) {
                return arabicTextProcessor.normalizeArabic(lines[i + 1].trim());
            }
        }
        return "";
    }

    // ── Back side ─────────────────────────────────────────────────────────────

    private String extractOccupation(String text) {
        String value = extractEnglishLabeledValue(text, "occupation", "profession");
        if (value.isEmpty() || value.toLowerCase(Locale.ROOT).startsWith("employer")) {
            return "";
        }
        return sanitizeEnglishFieldValue(value);
    }

    private String extractEmployer(String text) {
        return sanitizeEnglishFieldValue(extractEnglishLabeledValue(text, "employer", "company"));
    }

    private String extractIssuingPlace(String text) {
        return sanitizeEnglishFieldValue(extractEnglishLabeledValue(text, "issuing place", "place of issue", "issued at"));
    }

    private String extractEnglishLabeledValue(String text, String... labels) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        for (String line : noArabic.split("\n")) {
            String trimmed = line.trim();
            String lower = trimmed.toLowerCase(Locale.ROOT);
            for (String label : labels) {
                if (!lower.startsWith(label.toLowerCase(Locale.ROOT))) {
                    continue;
                }
                Matcher inline = Pattern.compile("(?i)" + Pattern.quote(label) + "\\s*[:.]?\\s*(.+)$").matcher(trimmed);
                if (inline.find()) {
                    return inline.group(1).trim();
                }
            }
        }
        return "";
    }

    private String sanitizeEnglishFieldValue(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String trimmed = value.trim();
        if (EN_FIELD_VALUE.matcher(trimmed).find()) {
            return "";
        }
        if (trimmed.matches("(?i)^(?:employer|occupation|issuing\\s*place)\\s*[:.]?\\s*.*")) {
            String stripped = trimmed.replaceFirst("(?i)^(?:employer|occupation|issuing\\s*place)\\s*[:.]?\\s*", "").trim();
            return EN_FIELD_VALUE.matcher(stripped).find() ? "" : stripped;
        }
        return trimmed;
    }

    private String cleanOccupationAr(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String cleaned = value.trim().replaceFirst("^(?:المهنة|مهنة)\\s*[:\\s]*", "").trim();
        return arabicTextProcessor.normalizeArabic(cleaned);
    }

    private String extractEmployerAr(String text) {
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (t.startsWith("صاحب العمل")) {
                String val = t.replaceFirst("^صاحب\\s*العمل\\s*[:\\s]*", "").trim();
                if (!val.isEmpty()) {
                    return arabicTextProcessor.normalizeArabic(val);
                }
            }
        }
        return extractLabeledArabicField(text, "صاحب العمل", "صاحب العمل:");
    }

    private String extractLabeledArabicField(String text, String... arabicLabels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            for (String label : arabicLabels) {
                if (!lines[i].contains(label)) {
                    continue;
                }
                if (lines[i].contains(":")) {
                    String val = lines[i].substring(lines[i].indexOf(':') + 1).trim();
                    if (!val.isEmpty()) {
                        return arabicTextProcessor.normalizeArabic(val);
                    }
                }
                String inline = lines[i].replaceFirst(Pattern.quote(label) + "\\s*[:\\s]*", "").trim();
                if (!inline.isEmpty() && arabicTextProcessor.containsArabic(inline)) {
                    return arabicTextProcessor.normalizeArabic(inline);
                }
                if (i + 1 < lines.length && arabicTextProcessor.containsArabic(lines[i + 1])) {
                    return arabicTextProcessor.normalizeArabic(lines[i + 1].trim());
                }
            }
        }
        return "";
    }

    // ── Side detection ────────────────────────────────────────────────────────

    protected boolean hasEmiratesIdNumber(String ocrText) {
        return ocrText != null && !findIdNumbers(ocrText).isEmpty();
    }

    protected boolean looksLikeBackSide(String ocrText) {
        if (ocrText == null || ocrText.isEmpty()) {
            return false;
        }
        String lower = ocrText.toLowerCase(Locale.ROOT);
        return lower.contains("occupation") || lower.contains("employer")
                || lower.contains("issuing place") || lower.contains("card number")
                || ocrText.contains("صاحب العمل") || ocrText.contains("المهنة")
                || ocrText.contains("مكان الإصدار") || ocrText.contains("مكان الاصدار")
                || EmiratesIdMrz.parse(ocrText).isPresent();
    }

    protected boolean looksLikeFrontSide(String ocrText) {
        if (ocrText == null || ocrText.isEmpty()) {
            return false;
        }
        String lower = ocrText.toLowerCase(Locale.ROOT);
        boolean hasKeyword = lower.contains("emirates") || lower.contains("uae")
                || lower.contains("identity") || lower.contains("resident identity")
                || ocrText.contains("هوية") || ocrText.contains("بطاقة");
        boolean hasFrontLabel = lower.contains("date of birth") || lower.contains("nationality")
                || lower.contains("expiry") || ocrText.contains("تاريخ الميلاد")
                || ocrText.contains("الجنسية");
        return hasEmiratesIdNumber(ocrText) || (hasKeyword && hasFrontLabel);
    }
}
