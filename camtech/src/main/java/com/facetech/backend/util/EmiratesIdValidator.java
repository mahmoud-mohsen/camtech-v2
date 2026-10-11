package com.facetech.backend.util;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Optional;

/**
 * Sanity checks on OCR'd Emirates ID fields, used to catch misreads and
 * expired cards before trusting the card for a face match.
 */
public final class EmiratesIdValidator {

    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ofPattern("dd/MM/yyyy"),
            DateTimeFormatter.ofPattern("d/M/yyyy"),
            DateTimeFormatter.ofPattern("dd-MM-yyyy"),
            DateTimeFormatter.ofPattern("yyyy-MM-dd"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("dd.MM.yyyy"));

    private EmiratesIdValidator() {
    }

    /** Digits only, e.g. "784-1990-1234567-1" -> "784199012345671". */
    public static String normalizeNumber(String raw) {
        return raw == null ? "" : raw.replaceAll("\\D", "");
    }

    /**
     * Emirates ID numbers are 15 digits, start with the UAE country code 784,
     * and end with a Luhn check digit.
     */
    public static boolean isValidNumber(String raw) {
        String digits = normalizeNumber(raw);
        return digits.length() == 15 && digits.startsWith("784") && luhnValid(digits);
    }

    static boolean luhnValid(String digits) {
        int sum = 0;
        boolean doubleIt = false;
        for (int i = digits.length() - 1; i >= 0; i--) {
            int d = digits.charAt(i) - '0';
            if (doubleIt) {
                d *= 2;
                if (d > 9) {
                    d -= 9;
                }
            }
            sum += d;
            doubleIt = !doubleIt;
        }
        return sum % 10 == 0;
    }

    /** Parses an OCR'd date in any of the common card formats. */
    public static Optional<LocalDate> parseDate(String raw) {
        if (raw == null || raw.isBlank()) {
            return Optional.empty();
        }
        String value = raw.trim();
        for (DateTimeFormatter f : DATE_FORMATS) {
            try {
                return Optional.of(LocalDate.parse(value, f));
            } catch (DateTimeParseException ignore) {
                // try next format
            }
        }
        return Optional.empty();
    }
}
