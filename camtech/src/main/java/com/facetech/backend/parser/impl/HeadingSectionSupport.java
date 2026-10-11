package com.facetech.backend.parser.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Predicate;

/**
 * Heading-driven OCR helpers: collect values between stable labels without hard-coding document values.
 */
final class HeadingSectionSupport {

    private HeadingSectionSupport() {
    }

    static String[] splitLines(String text) {
        List<String> out = new ArrayList<>();
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (!t.isEmpty()) {
                out.add(t);
            }
        }
        return out.toArray(new String[0]);
    }

    static int findHeading(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            if (matchesHeading(lines[i], labels)) {
                return i;
            }
        }
        return -1;
    }

    static int findHeadingFrom(String[] lines, int from, String... labels) {
        for (int i = Math.max(0, from); i < lines.length; i++) {
            if (matchesHeading(lines[i], labels)) {
                return i;
            }
        }
        return -1;
    }

    static boolean matchesHeading(String line, String... labels) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String trimmed = line.trim();
        String lower = trimmed.toLowerCase(Locale.ROOT);
        for (String label : labels) {
            if (label == null || label.isBlank()) {
                continue;
            }
            if (trimmed.equalsIgnoreCase(label) || trimmed.contains(label)) {
                return true;
            }
            if (lower.contains(label.toLowerCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }

    static String inlineAfterLabel(String line, String... labels) {
        if (line == null) {
            return "";
        }
        String lower = line.toLowerCase(Locale.ROOT);
        for (String label : labels) {
            int idx = lower.indexOf(label.toLowerCase(Locale.ROOT));
            if (idx < 0) {
                continue;
            }
            String rest = line.substring(idx + label.length()).replaceFirst("^\\s*[:./|]*\\s*", "").trim();
            // Drop bilingual trailing label after slash, e.g. "Foo / إسم الشركة"
            if (rest.contains("/")) {
                String left = rest.substring(0, rest.indexOf('/')).trim();
                if (!left.isBlank() && !matchesHeading(left, labels)) {
                    return left;
                }
            }
            if (!rest.isBlank() && !matchesHeading(rest, labels)) {
                return rest;
            }
        }
        return "";
    }

    static List<String> collectUntil(String[] lines, int startExclusive, Predicate<String> stop,
                                     Predicate<String> accept) {
        List<String> out = new ArrayList<>();
        for (int i = startExclusive; i < lines.length; i++) {
            String line = lines[i].trim();
            if (stop.test(line)) {
                break;
            }
            if (accept == null || accept.test(line)) {
                out.add(line);
            }
        }
        return out;
    }

    static String firstAccepted(String[] lines, int startExclusive, Predicate<String> stop,
                                Predicate<String> accept) {
        List<String> collected = collectUntil(lines, startExclusive, stop, accept);
        return collected.isEmpty() ? "" : collected.get(0);
    }

    static boolean looksLikeCodeOnly(String line) {
        return line != null && line.trim().matches("\\d{2,6}(?:\\.\\d{1,4})?");
    }

    static boolean looksLikeLicenseToken(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String t = line.trim();
        return t.matches("\\d{3,8}(?:\\.\\d{1,3})?")
                || t.matches("(?i)SC\\d{6,12}")
                || t.matches("[٠-٩0-9]{3,8}");
    }

    static boolean hasLatinLetters(String line) {
        return line != null && line.matches(".*[A-Za-z].*");
    }

    static boolean hasArabicLetters(String line) {
        return line != null && line.matches(".*[\\u0600-\\u06FF].*");
    }

    static boolean isNoiseLine(String line) {
        if (line == null || line.isBlank()) {
            return true;
        }
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.contains("page ")
                || lower.contains("www.")
                || lower.contains("http")
                || lower.contains("portal.")
                || lower.contains("to check")
                || lower.contains("send an sms")
                || lower.contains("scan the")
                || lower.contains("visit the website")
                || lower.contains("any alteration")
                || lower.contains("approved electronic")
                || lower.contains("وثيقة")
                || lower.contains("للتحقق")
                || lower.contains("أي كشط")
                || lower.contains("اي كشط")
                || lower.contains("هذه الرخصة")
                || lower.contains("emiri decree")
                || lower.contains("this license is")
                || lower.contains("certificate")
                || lower.equals("a")
                || lower.equals("e")
                || lower.equals("code")
                || lower.equals("verification qr");
    }
}
