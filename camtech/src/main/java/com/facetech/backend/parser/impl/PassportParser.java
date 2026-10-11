package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.model.DocumentType;
import com.facetech.backend.parser.DocumentParser;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import com.facetech.backend.parser.util.ConfidenceCalculator;
import com.facetech.backend.parser.util.PassportMrzParser;
import com.facetech.backend.parser.util.PassportMrzParser.MrzResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@RequiredArgsConstructor
@Slf4j
public class PassportParser implements DocumentParser {

    private final ConfidenceCalculator confidenceCalculator;
    private final ArabicTextProcessor arabicTextProcessor;
    private final PassportMrzParser passportMrzParser = new PassportMrzParser();

    private static final Pattern PASSPORT_NUMBER = Pattern.compile("(?<!\\d)([A-Z]{1,2}\\d{6,9})(?!\\d)");
    private static final Pattern DATE_PATTERN = Pattern.compile("\\b(\\d{2})/(\\d{2})/(\\d{4})\\b");
    private static final Pattern GENDER_PATTERN = Pattern.compile(
            "(?i)\\b(?:sex|gender)\\s*[:.]?\\s*(male|female|m|f)\\b"
    );

    private static final Map<String, String> AR_NATIONALITY_TO_EN = Map.ofEntries(
            Map.entry("مصرى", "Egyptian"),
            Map.entry("مصري", "Egyptian"),
            Map.entry("مصر", "Egyptian"),
            Map.entry("الامارات", "Emirati"),
            Map.entry("الإمارات", "Emirati")
    );

    @Override
    public DocumentFieldsDto parse(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);

        if (ocrText == null || ocrText.isBlank()) {
            log.warn("Passport parse skipped: OCR text is empty");
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        MrzResult mrz = passportMrzParser.parse(normalized);
        if (mrz.mrzRaw.isBlank()) {
            log.debug("Passport MRZ not found; falling back to visual-zone extraction only");
        }

        String passportNumber = firstNonEmpty(extractPassportNumber(normalized), mrz.documentNumber);
        addField(result, "passportNumber", passportNumber, normalized);

        String fullName = firstNonEmpty(mrz.fullNameEn, extractFullNameEn(normalized));
        addField(result, "fullName", fullName, normalized);
        addField(result, "fullNameEn", fullName, normalized);

        String fullNameAr = extractFullNameAr(normalized);
        addField(result, "fullNameAr", fullNameAr, normalized);

        String nationalityAr = extractArabicNationality(normalized);
        String nationality = firstNonEmpty(
                extractNationalityEn(normalized),
                nationalityFromArabic(nationalityAr),
                mrz.nationalityEn,
                mrz.nationalityCode
        );
        addField(result, "nationality", nationality, normalized);
        addField(result, "nationalityAr", nationalityAr, normalized);

        String dateOfBirth = firstNonEmpty(
                extractDateAfterLabel(normalized, "date of birth", "date of birth /", "تاريخ الميلاد"),
                mrz.dateOfBirth
        );
        addField(result, "dateOfBirth", dateOfBirth, normalized);

        String issueDate = firstNonEmpty(
                extractIssueDate(normalized),
                extractDateAfterLabel(normalized, "date of issue", "تاريخ الإصدار", "تاريخ الاصدار")
        );
        addField(result, "issueDate", issueDate, normalized);

        String expiryDate = firstNonEmpty(
                extractExpiryDate(normalized),
                extractDateAfterLabel(normalized, "date of expiry", "expiry", "تاريخ الانتهاء", "تاريخ الإنتهاء"),
                mrz.expiryDate
        );
        addField(result, "expiryDate", expiryDate, normalized);

        String gender = firstNonEmpty(extractGender(normalized), mrz.genderEn);
        addField(result, "gender", gender, normalized);
        addField(result, "genderAr", firstNonEmpty(extractArabicGender(normalized), genderArFromEn(gender)), normalized);

        addField(result, "placeOfBirth", extractPlaceOfBirth(normalized), normalized);
        addField(result, "placeOfBirthAr", extractPlaceOfBirthAr(normalized), normalized);
        addField(result, "nationalId", extractNationalId(normalized), normalized);
        addField(result, "profession", extractProfession(normalized), normalized);
        addField(result, "professionAr", extractProfessionAr(normalized), normalized);
        addField(result, "countryCode", firstNonEmpty(extractCountryCode(normalized), mrz.issuingCountry), normalized);
        addField(result, "documentType", firstNonEmpty(extractDocumentType(normalized), mrz.documentType), normalized);
        addField(result, "issuingOffice", extractIssuingOffice(normalized), normalized);

        if (!mrz.mrzRaw.isBlank()) {
            result.addField("mrzData", mrz.mrzRaw, BigDecimal.valueOf(0.90));
            result.addField("mrzFormat", mrz.format.name(), BigDecimal.valueOf(0.95));
        }

        BigDecimal[] confidences = result.getFields().values().stream()
                .filter(v -> v instanceof BigDecimal)
                .map(v -> (BigDecimal) v)
                .toArray(BigDecimal[]::new);
        result.setOverallConfidence(confidenceCalculator.calculateOverallConfidence(confidences));

        log.debug("Passport parsed (MRZ {}): {} fields, confidence={}",
                mrz.format, countDataFields(result), result.getOverallConfidence());
        return result;
    }

    private String extractPassportNumber(String text) {
        Matcher labeled = Pattern.compile(
                "(?i)(?:passport\\s*no\\.?|passport\\s*number|رقم\\s*الجواز)\\s*[:.]?\\s*([A-Z]{1,2}\\d{6,9})"
        ).matcher(text);
        if (labeled.find()) {
            return labeled.group(1);
        }

        for (String line : text.split("\n")) {
            String t = line.trim();
            if (t.matches("^[A-Z]\\d{7,9}$")) {
                return t;
            }
        }

        Matcher m = PASSPORT_NUMBER.matcher(text);
        if (m.find()) {
            return m.group(1);
        }
        return "";
    }

    private String extractFullNameEn(String text) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        for (String line : noArabic.split("\n")) {
            String t = line.trim();
            if (t.matches("^[A-Z]{2,}(?:\\s+[A-Z]{2,})+$") && t.length() >= 6 && t.length() <= 80) {
                if (!t.matches("(?i).*(PASSPORT|REPPORT|REPUBLIC|EGYPT|ARAB|TYPE|COUNTRY|NATIONALITY|DATE).*")
                        && !t.contains("<")) {
                    return titleCaseWords(t);
                }
            }
        }
        Matcher m = Pattern.compile("(?i)(?:full\\s*name|name)\\s*[:.]?\\s*([A-Z][A-Z\\s]{4,})").matcher(noArabic);
        if (m.find()) {
            return titleCaseWords(m.group(1).trim());
        }
        return "";
    }

    private String extractFullNameAr(String text) {
        StringBuilder name = new StringBuilder();
        boolean afterLabel = false;
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (t.equals("الاسم") || t.startsWith("الاسم:") || t.startsWith("Full Name")) {
                afterLabel = true;
                if (t.contains(":")) {
                    String val = t.substring(t.indexOf(':') + 1).trim();
                    if (arabicTextProcessor.containsArabic(val)) {
                        return arabicTextProcessor.normalizeArabic(val);
                    }
                }
                continue;
            }
            if (afterLabel && arabicTextProcessor.containsArabic(t) && !t.contains(":")) {
                if (name.length() > 0) {
                    name.append(' ');
                }
                name.append(t);
                if (name.toString().split("\\s+").length >= 4) {
                    break;
                }
            }
        }
        if (name.length() > 0) {
            return arabicTextProcessor.normalizeArabic(name.toString());
        }

        for (String line : text.split("\n")) {
            String t = line.trim();
            if (arabicTextProcessor.containsArabic(t)
                    && !Pattern.compile("\\d").matcher(t).find()
                    && t.split("\\s+").length >= 3
                    && !t.contains("جواز")
                    && !t.contains("الجنسية")
                    && !t.contains("العنوان")
                    && !t.contains("المهنة")
                    && !t.contains("الوظيفة")
                    && !t.contains("التجنيد")) {
                return arabicTextProcessor.normalizeArabic(t);
            }
        }
        return "";
    }

    private String extractNationalityEn(String text) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        Matcher m = Pattern.compile("(?i)nationality\\s*[:.]?\\s*([A-Za-z]+)").matcher(noArabic);
        if (m.find()) {
            String val = m.group(1).trim();
            if (!val.equalsIgnoreCase("sex") && val.length() >= 3) {
                return titleCaseWords(val);
            }
        }
        for (String line : noArabic.split("\n")) {
            if (line.trim().equalsIgnoreCase("EGYPTIAN")) {
                return "Egyptian";
            }
        }
        return "";
    }

    private String nationalityFromArabic(String nationalityAr) {
        if (nationalityAr == null || nationalityAr.isBlank()) {
            return "";
        }
        String normalized = arabicTextProcessor.normalizeArabic(nationalityAr);
        for (Map.Entry<String, String> entry : AR_NATIONALITY_TO_EN.entrySet()) {
            if (normalized.contains(arabicTextProcessor.normalizeArabic(entry.getKey()))) {
                return entry.getValue();
            }
        }
        return "";
    }

    private String extractArabicNationality(String text) {
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (t.startsWith("الجنسية") && t.contains(":")) {
                return arabicTextProcessor.normalizeArabic(t.substring(t.indexOf(':') + 1).trim());
            }
            if (t.equals("مصرى") || t.equals("مصري")) {
                return arabicTextProcessor.normalizeArabic(t);
            }
        }
        return "";
    }

    private String extractIssueDate(String text) {
        return extractPairedDate(text, true);
    }

    private String extractExpiryDate(String text) {
        String labeled = extractPairedDate(text, false);
        if (!labeled.isEmpty()) {
            return labeled;
        }
        return extractDateAfterLabel(text, "date of expiry", "expiry", "تاريخ الانتهاء", "تاريخ الإنتهاء");
    }

    private String extractPairedDate(String text, boolean issueFirst) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase(Locale.ROOT);
            if (lo.contains("date of issue") && lo.contains("expiry")) {
                if (i + 1 < lines.length) {
                    List<String> dates = new ArrayList<>();
                    Matcher m = DATE_PATTERN.matcher(lines[i + 1]);
                    while (m.find()) {
                        dates.add(m.group());
                    }
                    if (dates.size() >= 2) {
                        return issueFirst ? dates.get(0) : dates.get(1);
                    }
                }
            }
        }
        return "";
    }

    private String extractDateAfterLabel(String text, String... labels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lo = lines[i].toLowerCase(Locale.ROOT);
            for (String label : labels) {
                if (lo.contains(label.toLowerCase(Locale.ROOT)) || lines[i].contains(label)) {
                    Matcher sameLine = DATE_PATTERN.matcher(lines[i]);
                    while (sameLine.find()) {
                        return sameLine.group();
                    }
                    for (int offset = 1; offset <= 2 && i + offset < lines.length; offset++) {
                        Matcher next = DATE_PATTERN.matcher(lines[i + offset]);
                        if (next.find()) {
                            return next.group();
                        }
                    }
                }
            }
        }

        if (labels.length > 0 && labels[0].contains("issue")) {
            for (String line : lines) {
                if (line.toLowerCase(Locale.ROOT).contains("date of issue")
                        || line.contains("تاريخ الإصدار")) {
                    Matcher m = DATE_PATTERN.matcher(line);
                    if (m.find()) {
                        return m.group();
                    }
                }
            }
        }
        if (labels.length > 0 && labels[0].contains("expiry")) {
            for (String line : lines) {
                if (line.toLowerCase(Locale.ROOT).contains("expiry")
                        || line.contains("تاريخ الانتهاء")) {
                    Matcher m = DATE_PATTERN.matcher(line);
                    String last = "";
                    while (m.find()) {
                        last = m.group();
                    }
                    if (!last.isEmpty()) {
                        return last;
                    }
                }
            }
        }
        return "";
    }

    private String extractGender(String text) {
        Matcher m = GENDER_PATTERN.matcher(arabicTextProcessor.removeArabicText(text));
        if (m.find()) {
            String g = m.group(1).toLowerCase(Locale.ROOT);
            return g.startsWith("m") ? "Male" : "Female";
        }
        return "";
    }

    private String extractArabicGender(String text) {
        for (String line : text.split("\n")) {
            if (line.contains("ذكر")) {
                return "ذكر";
            }
            if (line.contains("أنثى") || line.contains("انثى")) {
                return "أنثى";
            }
        }
        return "";
    }

    private String extractPlaceOfBirth(String text) {
        String noArabic = arabicTextProcessor.removeArabicText(text);
        for (String line : noArabic.split("\n")) {
            if (line.toLowerCase(Locale.ROOT).contains("place of birth")
                    || line.toLowerCase(Locale.ROOT).contains("birth")) {
                Matcher date = DATE_PATTERN.matcher(line);
                if (date.find()) {
                    String after = line.substring(date.end()).trim();
                    after = after.replaceAll("[\\u0660-\\u0669\\u06F0-\\u06F9()]+.*", "").trim();
                    if (!after.isBlank() && after.length() <= 40) {
                        return titleCaseWords(after);
                    }
                }
            }
        }
        return "";
    }

    private String extractPlaceOfBirthAr(String text) {
        for (String line : text.split("\n")) {
            if (line.contains("الوادي") || line.contains("وادي")) {
                Matcher m = Pattern.compile("[\\u0600-\\u06FF\\s]+").matcher(line);
                if (m.find()) {
                    return arabicTextProcessor.normalizeArabic(m.group().trim());
                }
            }
        }
        return "";
    }

    private String extractNationalId(String text) {
        for (String line : text.split("\n")) {
            if (line.contains("الرقم القومي") || line.toLowerCase(Locale.ROOT).contains("national id")) {
                String normalized = normalizeDigits(line);
                Matcher m = Pattern.compile("(\\d{14})").matcher(normalized);
                if (m.find()) {
                    return m.group(1);
                }
            }
        }
        return "";
    }

    private String extractProfession(String text) {
        Matcher m = Pattern.compile("(?i)profession\\s*[:.-]*\\s*([A-Za-z\\s]+)").matcher(text);
        if (m.find()) {
            return m.group(1).trim();
        }
        return "";
    }

    private String extractProfessionAr(String text) {
        for (String line : text.split("\n")) {
            if (line.contains("الوظيفة") || line.contains("المهنة")) {
                String val = line.replaceFirst(".*(?:الوظيفة|المهنة)\\s*[:/\\s]+", "").trim();
                if (arabicTextProcessor.containsArabic(val)) {
                    return arabicTextProcessor.normalizeArabic(val);
                }
            }
        }
        return "";
    }

    private String extractCountryCode(String text) {
        Matcher m = Pattern.compile("(?i)country\\s*code\\s*[:/]?\\s*([A-Z]{3})\\b").matcher(text);
        if (m.find()) {
            return m.group(1);
        }
        return "";
    }

    private String extractDocumentType(String text) {
        Matcher m = Pattern.compile("(?i)(?:^|\\s)type\\s*[:/]?\\s*([ACPV])\\b").matcher(text);
        if (m.find()) {
            return m.group(1);
        }
        return "";
    }

    private String extractIssuingOffice(String text) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase(Locale.ROOT).contains("issuing office")
                    || lines[i].contains("جهة إصدار")) {
                for (int offset = 1; offset <= 2 && i + offset < lines.length; offset++) {
                    String val = normalizeDigits(lines[i + offset].trim());
                    if (val.matches("\\d{1,4}")) {
                        return val;
                    }
                }
            }
        }
        return "";
    }

    private String genderArFromEn(String gender) {
        if ("Male".equalsIgnoreCase(gender)) {
            return "ذكر";
        }
        if ("Female".equalsIgnoreCase(gender)) {
            return "أنثى";
        }
        return "";
    }

    private String normalizeDigits(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(value.length());
        for (char c : value.toCharArray()) {
            if (c >= '\u0660' && c <= '\u0669') {
                sb.append((char) ('0' + (c - '\u0660')));
            } else if (c >= '\u06F0' && c <= '\u06F9') {
                sb.append((char) ('0' + (c - '\u06F0')));
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private String titleCaseWords(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String[] parts = value.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(part.substring(0, 1).toUpperCase(Locale.ROOT));
            if (part.length() > 1) {
                sb.append(part.substring(1).toLowerCase(Locale.ROOT));
            }
        }
        return sb.toString();
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private void addField(DocumentFieldsDto result, String key, String value, String ocrText) {
        if (value != null && !value.isBlank()) {
            result.addField(key, value, confidenceCalculator.calculateFieldConfidence(key, value, ocrText));
        }
    }

    private int countDataFields(DocumentFieldsDto result) {
        return (int) result.getFields().keySet().stream()
                .filter(k -> !k.endsWith("_confidence"))
                .count();
    }

    @Override
    public DocumentType getSupportedDocumentType() {
        return DocumentType.PASSPORT;
    }

    @Override
    public boolean canParse(String ocrText) {
        if (ocrText == null || ocrText.isEmpty()) {
            return false;
        }
        String lower = ocrText.toLowerCase(Locale.ROOT);
        boolean hasKeywords = lower.contains("passport")
                || lower.contains("travel document")
                || lower.contains("جواز")
                || lower.contains("p<");
        boolean hasPassportNumber = PASSPORT_NUMBER.matcher(ocrText).find();
        boolean hasMrz = passportMrzParser.parse(ocrText).format != PassportMrzParser.MrzFormat.UNKNOWN;
        return hasMrz || (hasKeywords && hasPassportNumber) || hasPassportNumber;
    }
}




