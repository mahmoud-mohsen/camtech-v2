package com.facetech.backend.admin;

import com.facetech.backend.exception.FaceMatchException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/** Parsing of admin query parameters. */
public final class AdminParams {

    private static final ZoneId ZONE = ZoneId.of("Asia/Dubai");

    private AdminParams() {
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /** "%value%" in lower case for LIKE ... ESCAPE '\' searches, or null. */
    static String like(String q) {
        String v = blankToNull(q);
        if (v == null) {
            return null;
        }
        String escaped = v.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }

    public static <E extends Enum<E>> E enumOrNull(Class<E> type, String raw) {
        String v = blankToNull(raw);
        if (v == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, v.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                    "Unknown value '" + v + "' for " + type.getSimpleName());
        }
    }

    /** Start of the given day (YYYY-MM-DD, UAE time) or an ISO instant. */
    static Instant startOfDay(String raw) {
        return parse(raw, false);
    }

    /** Start of the day after the given day, so "to" is inclusive. */
    static Instant endOfDay(String raw) {
        return parse(raw, true);
    }

    static LocalDate date(String raw) {
        String v = blankToNull(raw);
        if (v == null) {
            return null;
        }
        try {
            return LocalDate.parse(v.length() > 10 ? v.substring(0, 10) : v);
        } catch (DateTimeParseException e) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Use dates as YYYY-MM-DD");
        }
    }

    public static Pageable page(int page, int size, Sort sort) {
        return PageRequest.of(Math.max(0, page), Math.max(1, Math.min(size, 200)), sort);
    }

    static String required(String value, String name) {
        String v = blankToNull(value);
        if (v == null) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", name + " is required");
        }
        return v;
    }

    private static Instant parse(String raw, boolean nextDay) {
        String v = blankToNull(raw);
        if (v == null) {
            return null;
        }
        if (v.length() > 10) {
            try {
                return Instant.parse(v);
            } catch (DateTimeParseException ignored) {
                // fall through to the date part
            }
        }
        LocalDate d = date(v);
        return (nextDay ? d.plusDays(1) : d).atStartOfDay(ZONE).toInstant();
    }
}
