package com.facetech.backend.util;

/**
 * ICAO 9303 check digits on the second MRZ line of a passport (TD3), used to
 * catch OCR misreads before trusting the passport for a face match.
 *
 * Line 2 layout (44 chars): document number 0-8 + check 9, nationality
 * 10-12, birth date 13-18 + check 19, sex 20, expiry 21-26 + check 27.
 */
public final class PassportMrzValidator {

    private static final int[] WEIGHTS = {7, 3, 1};

    private PassportMrzValidator() {
    }

    /** True when the document number, birth date and expiry check digits all match. */
    public static boolean isValidLine2(String line2) {
        if (line2 == null) {
            return false;
        }
        String l = line2.trim().toUpperCase();
        if (l.length() < 28) {
            return false;
        }
        return checks(l.substring(0, 9), l.charAt(9))
                && checks(l.substring(13, 19), l.charAt(19))
                && checks(l.substring(21, 27), l.charAt(27));
    }

    static boolean checks(String field, char checkDigit) {
        if (!Character.isDigit(checkDigit)) {
            // '<' is allowed as check digit only for an empty optional field.
            return checkDigit == '<' && field.chars().allMatch(c -> c == '<');
        }
        return checkDigit(field) == checkDigit - '0';
    }

    static int checkDigit(String field) {
        int sum = 0;
        for (int i = 0; i < field.length(); i++) {
            sum += value(field.charAt(i)) * WEIGHTS[i % 3];
        }
        return sum % 10;
    }

    private static int value(char c) {
        if (c >= '0' && c <= '9') {
            return c - '0';
        }
        if (c >= 'A' && c <= 'Z') {
            return c - 'A' + 10;
        }
        return 0; // '<' filler
    }
}
