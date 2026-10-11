package com.facetech.backend.parser.util;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses ICAO 9303 machine-readable zones for TD1 (3×30), TD2 (2×36), and TD3 (2×44).
 */
public final class PassportMrzParser {

    public enum MrzFormat {
        TD1, TD2, TD3, UNKNOWN
    }

    public static final class MrzResult {
        public MrzFormat format = MrzFormat.UNKNOWN;
        public String documentType = "";
        public String issuingCountry = "";
        public String documentNumber = "";
        public String fullNameEn = "";
        public String nationalityCode = "";
        public String nationalityEn = "";
        public String dateOfBirth = "";
        public String expiryDate = "";
        public String genderEn = "";
        public String mrzRaw = "";
    }

    /** An MRZ line holding a name: letters and fillers only, with the "<<" between surname and given names. */
    private static final Pattern NAME_LINE = Pattern.compile("^(?=.*<<)[A-Z<]{10,}$");
    private static final Pattern TD3_LINE2 = Pattern.compile(
            "^([A-Z0-9<]{9})([0-9<])([A-Z<]{3})([0-9<]{6})([0-9<])([MF<])([0-9<]{6})"
    );
    private static final Pattern TD2_LINE2 = Pattern.compile(
            "^([A-Z0-9<]{9})([0-9<])([A-Z<]{3})([0-9<]{6})([0-9<])([MF<])([0-9<]{6})"
    );
    private static final Pattern TD1_LINE2 = Pattern.compile(
            "^([0-9<]{6})([0-9<])([MF<])([0-9<]{6})([0-9<])([A-Z<]{3})"
    );

    private static final Map<String, String> ISO3_TO_NATIONALITY = Map.ofEntries(
            Map.entry("EGY", "Egypt"),
            Map.entry("IND", "India"),
            Map.entry("PAK", "Pakistan"),
            Map.entry("PHL", "Philippines"),
            Map.entry("BGD", "Bangladesh"),
            Map.entry("NPL", "Nepal"),
            Map.entry("LKA", "Sri Lanka"),
            Map.entry("JOR", "Jordan"),
            Map.entry("LBN", "Lebanon"),
            Map.entry("SYR", "Syria"),
            Map.entry("IRQ", "Iraq"),
            Map.entry("IRN", "Iran"),
            Map.entry("AFG", "Afghanistan"),
            Map.entry("YEM", "Yemen"),
            Map.entry("SDN", "Sudan"),
            Map.entry("ARE", "United Arab Emirates"),
            Map.entry("GBR", "United Kingdom"),
            Map.entry("USA", "United States"),
            Map.entry("DEU", "Germany"),
            Map.entry("FRA", "France"),
            Map.entry("UTO", "Utopia")
    );

    public PassportMrzParser() {
    }

    public MrzResult parse(String text) {
        MrzResult result = new MrzResult();
        if (text == null || text.isBlank()) {
            return result;
        }

        List<String> lines = extractMrzLines(text);
        if (lines.isEmpty()) {
            return result;
        }

        result.mrzRaw = String.join("\n", lines);

        if (lines.size() >= 3 && isTd1(lines)) {
            return parseTd1(lines, result);
        }
        if (lines.size() >= 2 && isTd3(lines)) {
            return parseTd3(lines, result);
        }
        if (lines.size() >= 2 && isTd2(lines)) {
            return parseTd2(lines, result);
        }
        if (lines.size() >= 2 && lines.get(0).startsWith("P<")) {
            return parseTd3(lines, result);
        }
        return result;
    }

    private List<String> extractMrzLines(String text) {
        List<String> candidates = new ArrayList<>();
        for (String raw : text.split("\n")) {
            String line = normalizeMrzLine(raw);
            if (isMrzLine(line)) {
                candidates.add(line);
            }
        }

        List<String> best = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) {
            List<String> group = new ArrayList<>();
            group.add(candidates.get(i));
            for (int j = i + 1; j < candidates.size() && group.size() < 3; j++) {
                if (areCompatibleMrzLines(group.get(group.size() - 1), candidates.get(j))) {
                    group.add(candidates.get(j));
                } else {
                    break;
                }
            }
            if (scoreMrzGroup(group) > scoreMrzGroup(best)) {
                best = group;
            }
        }
        return best;
    }

    private int scoreMrzGroup(List<String> group) {
        if (group.isEmpty()) {
            return 0;
        }
        int score = group.size() * 10;
        if (group.get(0).startsWith("P<")) {
            score += 20;
        }
        if (group.get(0).startsWith("I<")) {
            score += 15;
        }
        for (String line : group) {
            score += (int) line.chars().filter(ch -> ch == '<').count();
        }
        return score;
    }

    private boolean isMrzLine(String line) {
        if (line.length() < 28) {
            return false;
        }
        if (line.length() > 44) {
            line = line.substring(0, 44);
        }
        if (!line.matches("^[A-Z0-9<]+$")) {
            return false;
        }
        if (line.startsWith("P<") || line.startsWith("I<") || line.startsWith("A<")
                || line.startsWith("C<") || line.startsWith("V<")) {
            return true;
        }
        if (line.startsWith("IL") || line.startsWith("ID") || line.startsWith("IR")
                || line.startsWith("AC") || line.startsWith("AR")) {
            return true;
        }
        if (line.chars().filter(ch -> ch == '<').count() < 2) {
            return false;
        }
        if (TD3_LINE2.matcher(padTd3(line)).find()) {
            return true;
        }
        if (TD2_LINE2.matcher(padTd2(line)).find()) {
            return true;
        }
        if (TD1_LINE2.matcher(padTd1(line)).find()) {
            return true;
        }
        return line.contains("<<");
    }

    private boolean areCompatibleMrzLines(String previous, String next) {
        if (previous.length() >= 40 && next.length() >= 40) {
            return TD3_LINE2.matcher(padTd3(next)).find();
        }
        if (previous.length() >= 32 && previous.length() <= 38
                && next.length() >= 32 && next.length() <= 38) {
            return TD2_LINE2.matcher(padTd2(next)).find();
        }
        if (previous.length() <= 32 && next.length() <= 32) {
            return TD1_LINE2.matcher(padTd1(next)).find() || next.contains("<<");
        }
        if (previous.contains("<<")) {
            return next.contains("<<") || TD1_LINE2.matcher(padTd1(next)).find();
        }
        return next.contains("<<") || TD3_LINE2.matcher(padTd3(next)).find()
                || TD2_LINE2.matcher(padTd2(next)).find();
    }

    private boolean isTd1(List<String> lines) {
        if (lines.size() < 3) {
            return false;
        }
        return lines.get(0).startsWith("IL") || lines.get(0).startsWith("ID")
                || lines.get(0).startsWith("IR") || lines.get(0).startsWith("AC")
                || (lines.get(0).length() <= 32 && lines.get(2).contains("<<"));
    }

    private boolean isTd2(List<String> lines) {
        return lines.get(0).length() >= 32 && lines.get(0).length() <= 38
                && lines.get(0).startsWith("I<");
    }

    private boolean isTd3(List<String> lines) {
        String line1 = lines.get(0);
        return line1.startsWith("P<")
                || (line1.length() >= 40 && lines.size() >= 2
                && TD3_LINE2.matcher(padTd3(lines.get(1))).find());
    }

    private MrzResult parseTd3(List<String> lines, MrzResult result) {
        result.format = MrzFormat.TD3;
        String line1 = padTd3(lines.get(0));
        String line2 = padTd3(lines.get(1));

        result.documentType = safeChar(line1, 0);
        result.issuingCountry = line1.substring(2, 5).replace("<", "");
        result.fullNameEn = parseNameFromLine1(line1.substring(5));

        Matcher m = TD3_LINE2.matcher(line2);
        if (m.find()) {
            result.documentNumber = m.group(1).replace("<", "");
            result.nationalityCode = m.group(3).replace("<", "");
            result.nationalityEn = nationalityFromIso3(result.nationalityCode);
            result.dateOfBirth = yyMmDdToDisplay(m.group(4));
            result.genderEn = genderFromCode(m.group(6));
            result.expiryDate = yyMmDdToDisplay(m.group(7));
        }
        return result;
    }

    private MrzResult parseTd2(List<String> lines, MrzResult result) {
        result.format = MrzFormat.TD2;
        String line1 = padTd2(lines.get(0));
        String line2 = padTd2(lines.get(1));

        result.documentType = safeChar(line1, 0);
        result.issuingCountry = line1.substring(2, 5).replace("<", "");
        result.fullNameEn = parseNameFromLine1(line1.substring(5));

        Matcher m = TD2_LINE2.matcher(line2);
        if (m.find()) {
            result.documentNumber = m.group(1).replace("<", "");
            result.nationalityCode = m.group(3).replace("<", "");
            result.nationalityEn = nationalityFromIso3(result.nationalityCode);
            result.dateOfBirth = yyMmDdToDisplay(m.group(4));
            result.genderEn = genderFromCode(m.group(6));
            result.expiryDate = yyMmDdToDisplay(m.group(7));
        }
        return result;
    }

    private MrzResult parseTd1(List<String> lines, MrzResult result) {
        result.format = MrzFormat.TD1;
        String line1 = padTd1(lines.get(0));
        String line2 = padTd1(lines.get(1));
        String line3 = padTd1(lines.get(2));

        result.documentType = safeChar(line1, 0);
        result.issuingCountry = line1.substring(2, 5).replace("<", "");
        result.documentNumber = line1.substring(5).replace("<", "").trim();

        Matcher m = TD1_LINE2.matcher(line2);
        if (m.find()) {
            result.dateOfBirth = yyMmDdToDisplay(m.group(1));
            result.genderEn = genderFromCode(m.group(3));
            result.expiryDate = yyMmDdToDisplay(m.group(4));
            result.nationalityCode = m.group(6).replace("<", "");
            result.nationalityEn = nationalityFromIso3(result.nationalityCode);
        }
        if (line3.contains("<<")) {
            result.fullNameEn = parseNameFromLine1(line3);
        }
        return result;
    }

    private String parseNameFromLine1(String nameField) {
        if (nameField == null || nameField.isBlank()) {
            return "";
        }
        if (!nameField.contains("<<")) {
            return titleCaseWords(nameField.replace("<", " ").trim());
        }
        String[] parts = nameField.split("<<", 2);
        String surname = parts[0].replace("<", " ").trim();
        String given = parts.length > 1 ? parts[1].replace("<", " ").trim() : "";
        return titleCaseWords((given + " " + surname).trim());
    }

    private String normalizeMrzLine(String raw) {
        if (raw == null) {
            return "";
        }
        String upper = raw.trim().toUpperCase(Locale.ROOT);
        String compact = upper.replace(" ", "");
        // Name lines (letters and fillers only, e.g. "P<EGYHASSAN<<AHMED<ALI"): OCR often reads a filler between two
        // names as a space ("AHMED ALI"); dropping it would glue the names together.
        if (NAME_LINE.matcher(compact).matches()) {
            return upper.replaceAll("(?<=[A-Z])\\s+(?=[A-Z])", "<").replace(" ", "");
        }
        return compact;
    }

    private String padTd1(String line) {
        return padRight(line, 30);
    }

    private String padTd2(String line) {
        return padRight(line, 36);
    }

    private String padTd3(String line) {
        return padRight(line, 44);
    }

    private String padRight(String line, int length) {
        if (line.length() >= length) {
            return line.substring(0, length);
        }
        return line + "<".repeat(length - line.length());
    }

    private String safeChar(String line, int index) {
        return index < line.length() ? String.valueOf(line.charAt(index)).replace("<", "") : "";
    }

    private String yyMmDdToDisplay(String raw) {
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.length() != 6) {
            return "";
        }
        try {
            int yy = Integer.parseInt(digits.substring(0, 2));
            int year = yy >= 50 ? 1900 + yy : 2000 + yy;
            LocalDate d = LocalDate.of(
                    year,
                    Integer.parseInt(digits.substring(2, 4)),
                    Integer.parseInt(digits.substring(4, 6))
            );
            return d.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"));
        } catch (Exception ignored) {
            return "";
        }
    }

    private String genderFromCode(String code) {
        String c = code == null ? "" : code.replace("<", "");
        if ("M".equals(c)) {
            return "Male";
        }
        if ("F".equals(c)) {
            return "Female";
        }
        return "";
    }

    private String nationalityFromIso3(String iso3) {
        if (iso3 == null || iso3.length() != 3) {
            return "";
        }
        return ISO3_TO_NATIONALITY.getOrDefault(iso3, iso3);
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
}
