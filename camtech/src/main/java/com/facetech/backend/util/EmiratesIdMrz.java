package com.facetech.backend.util;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The machine-readable zone on the back of the Emirates ID (ICAO 9303 TD1: three lines of 30 characters).
 *
 * <pre>
 * Line 1: I D ARE | card number 5-13 | check 14 | optional 15-29 (the 15-digit Emirates ID number)
 * Line 2: birth date 0-5 | check 6 | sex 7 | expiry 8-13 | check 14 | nationality 15-17 | optional 18-28 | composite 29
 * Line 3: SURNAME&lt;&lt;GIVEN&lt;NAMES
 * </pre>
 *
 * OCR of the MRZ font is reliable but not perfect, so letters read in digit positions are corrected (O→0, I→1...)
 * and every value comes with whether its check digit matched: only checked values should be trusted.
 */
public final class EmiratesIdMrz {

    private static final int LEN = 30;
    private static final Pattern LINE1 = Pattern.compile("^I[A-Z<]ARE[0-9A-Z<]{20,27}$");
    private static final Pattern LINE2 = Pattern.compile("^[0-9OIDQSBZGL]{7}[MFX<][0-9OIDQSBZGL]{7}[A-Z<]{3}[0-9A-Z<]{8,14}$");
    private static final Pattern LINE3 = Pattern.compile("^[A-Z<]{8,32}$");

    private EmiratesIdMrz() {
    }

    /**
     * @param cardNumber       9-character card number from line 1, or null
     * @param emiratesIdNumber 784-YYYY-NNNNNNN-C from line 1, or null when absent or its Luhn digit is wrong
     * @param sex              "M", "F" or null
     * @param nationality      ISO 3166 alpha-3 code, or null
     * @param fullName         "GIVEN NAMES SURNAME", or null
     */
    public record Result(String cardNumber, boolean cardNumberValid, String emiratesIdNumber,
                         LocalDate dateOfBirth, boolean dateOfBirthValid, LocalDate expiryDate, boolean expiryValid,
                         String sex, String nationality, String fullName, boolean compositeValid) {

        /** Card number, birth date and expiry check digits all matched (the composite too, when present). */
        public boolean verified() {
            return cardNumberValid && dateOfBirthValid && expiryValid && compositeValid;
        }
    }

    /** Finds and decodes the MRZ in OCR text; empty when no line 2 (the dates) was found. */
    public static Optional<Result> parse(String ocrText) {
        if (ocrText == null || ocrText.isBlank()) {
            return Optional.empty();
        }
        String line1 = null;
        String line2 = null;
        String line3 = null;
        List<String> lines = new ArrayList<>();
        // Same lines with each run of spaces read as one filler: OCR often prints "MOHAMED<AHMED" as "MOHAMED AHMED".
        List<String> nameLines = new ArrayList<>();
        for (String raw : ocrText.split("\\R")) {
            String l = clean(raw);
            if (!l.isEmpty()) {
                lines.add(l);
                nameLines.add(clean(raw.trim().replaceAll("\\s+", "<")));
            }
        }
        for (int i = 0; i < lines.size(); i++) {
            String l = lines.get(i);
            if (line1 == null && LINE1.matcher(l).matches()) {
                line1 = pad(l);
            } else if (line2 == null && LINE2.matcher(l).matches()) {
                line2 = pad(l);
                // The name line follows the dates line.
                if (i + 1 < lines.size() && lines.get(i + 1).contains("<<") && LINE3.matcher(lines.get(i + 1)).matches()) {
                    line3 = nameLines.get(i + 1);
                }
            }
        }
        if (line2 == null) {
            return Optional.empty();
        }

        String dob = digits(line2.substring(0, 6));
        boolean dobValid = check(dob, digit(line2.charAt(6)));
        String expiry = digits(line2.substring(8, 14));
        boolean expiryValid = check(expiry, digit(line2.charAt(14)));
        char sexChar = line2.charAt(7);
        String sex = sexChar == 'M' || sexChar == 'F' ? String.valueOf(sexChar) : null;
        String nationality = line2.substring(15, 18).replace("<", "");

        String cardNumber = null;
        boolean cardValid = false;
        String eid = null;
        boolean compositeValid = true;
        if (line1 != null) {
            String card = line1.substring(5, 14);
            cardNumber = card.replace("<", "");
            cardValid = check(card, digit(line1.charAt(14)));
            String optional = digits(line1.substring(15, 30)).replace("<", "");
            if (optional.length() >= 15 && optional.startsWith("784")) {
                String n = optional.substring(0, 15);
                if (EmiratesIdValidator.isValidNumber(n)) {
                    eid = n.replaceFirst("(\\d{3})(\\d{4})(\\d{7})(\\d)", "$1-$2-$3-$4");
                }
            }
            char composite = digit(line2.charAt(29));
            if (Character.isDigit(composite)) {
                String upper = line1.substring(5, 30) + dob + digit(line2.charAt(6)) + expiry + digit(line2.charAt(14))
                        + line2.substring(18, 29);
                compositeValid = PassportMrzValidator.checkDigit(upper) == composite - '0';
            }
        }

        return Optional.of(new Result(cardNumber, cardValid, eid,
                dobValid ? date(dob, true) : null, dobValid,
                expiryValid ? date(expiry, false) : null, expiryValid,
                sex, nationality.length() == 3 ? nationality : null, name(line3), compositeValid));
    }

    /** Upper case, no spaces; OCR variants of the filler '&lt;' turned back into '&lt;'. */
    private static String clean(String raw) {
        return raw.toUpperCase(Locale.ROOT)
                .replace("«", "<<").replace("‹", "<").replace("〈", "<").replace("＜", "<")
                .replaceAll("\\s+", "");
    }

    private static String pad(String l) {
        if (l.length() >= LEN) {
            return l.substring(0, LEN);
        }
        return l + "<".repeat(LEN - l.length());
    }

    /** Letters OCR confuses with digits, in positions that can only hold digits. */
    private static String digits(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (char c : s.toCharArray()) {
            b.append(digit(c));
        }
        return b.toString();
    }

    private static char digit(char c) {
        return switch (c) {
            case 'O', 'D', 'Q' -> '0';
            case 'I', 'L' -> '1';
            case 'Z' -> '2';
            case 'S' -> '5';
            case 'G' -> '6';
            case 'B' -> '8';
            default -> c;
        };
    }

    private static boolean check(String field, char checkDigit) {
        return Character.isDigit(checkDigit) && field.chars().allMatch(Character::isDigit)
                && PassportMrzValidator.checkDigit(field) == checkDigit - '0';
    }

    /** YYMMDD; birth dates in the future belong to the previous century, expiries are always 20YY. */
    private static LocalDate date(String yymmdd, boolean birth) {
        try {
            int yy = Integer.parseInt(yymmdd.substring(0, 2));
            int year = 2000 + yy;
            if (birth && year > LocalDate.now().getYear()) {
                year -= 100;
            }
            return LocalDate.of(year, Integer.parseInt(yymmdd.substring(2, 4)), Integer.parseInt(yymmdd.substring(4, 6)));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String name(String line3) {
        if (line3 == null) {
            return null;
        }
        String[] parts = line3.split("<<", 2);
        String surname = parts[0].replace("<", " ").trim();
        String given = parts.length > 1 ? parts[1].replaceAll("<+", " ").trim() : "";
        String full = (given + " " + surname).trim().replaceAll("\\s+", " ");
        return full.isEmpty() ? null : full;
    }
}
