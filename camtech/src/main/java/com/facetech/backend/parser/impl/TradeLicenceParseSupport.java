package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TradeLicenceParseSupport {

    static final Pattern SLASH_DATE = Pattern.compile("\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b");
    static final Pattern DASH_DATE = Pattern.compile("\\b(\\d{1,2})-(\\d{1,2})-(\\d{4})\\b");
    static final Pattern ISO_DATE = Pattern.compile("\\b(\\d{4})-(\\d{2})-(\\d{2})\\b");
    static final Pattern MONTH_DATE = Pattern.compile(
            "(?i)\\b(January|February|March|April|May|June|July|August|September|October|November|December)"
                    + "\\s+(\\d{1,2}),\\s+(\\d{4})\\b");
    /** e.g. 21 May 2025 / 05 November 2007 */
    static final Pattern DAY_MONTH_DATE = Pattern.compile(
            "(?i)\\b(\\d{1,2})\\s+(January|February|March|April|May|June|July|August|September|October|November|December)"
                    + "\\s+(\\d{4})\\b");
    /** e.g. 18-Dec-2024 */
    static final Pattern DAY_MON_DASH_DATE = Pattern.compile(
            "(?i)\\b(\\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-(\\d{4})\\b");
    static final Pattern EMAIL = Pattern.compile("[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}");
    static final Pattern NAT_EN = Pattern.compile(
            "(?i)\\b(united arab emirates|uae|pakistan|saudi arabia|egypt|jordan|india|oman|kuwait|bahrain|qatar|lebanon|morocco)\\b");

    private TradeLicenceParseSupport() {
    }

    static void addIfNotEmpty(DocumentFieldsDto result, String key, String value) {
        if (value != null && !value.isBlank()) {
            result.addField(key, value);
        }
    }

    static void setConfidence(DocumentFieldsDto result, int filledFieldCount) {
        result.setOverallConfidence(BigDecimal.valueOf(Math.min(1.0, filledFieldCount / 8.0)));
    }

    static String normalizeDate(String value) {
        Matcher slash = SLASH_DATE.matcher(value);
        if (slash.find()) {
            return padDate(slash.group(1), slash.group(2), slash.group(3));
        }
        Matcher dash = DASH_DATE.matcher(value);
        if (dash.find()) {
            return padDate(dash.group(1), dash.group(2), dash.group(3));
        }
        Matcher iso = ISO_DATE.matcher(value);
        if (iso.find()) {
            return padDate(iso.group(3), iso.group(2), iso.group(1));
        }
        Matcher month = MONTH_DATE.matcher(value);
        if (month.find()) {
            return String.format("%02d/%02d/%s",
                    Integer.parseInt(month.group(2)),
                    monthToNumber(month.group(1)),
                    month.group(3));
        }
        Matcher dayMonth = DAY_MONTH_DATE.matcher(value);
        if (dayMonth.find()) {
            return String.format("%02d/%02d/%s",
                    Integer.parseInt(dayMonth.group(1)),
                    monthToNumber(dayMonth.group(2)),
                    dayMonth.group(3));
        }
        Matcher dayMonDash = DAY_MON_DASH_DATE.matcher(value);
        if (dayMonDash.find()) {
            return String.format("%02d/%02d/%s",
                    Integer.parseInt(dayMonDash.group(1)),
                    shortMonthToNumber(dayMonDash.group(2)),
                    dayMonDash.group(3));
        }
        return value.trim();
    }

    private static int shortMonthToNumber(String month) {
        return switch (month.toLowerCase()) {
            case "jan" -> 1;
            case "feb" -> 2;
            case "mar" -> 3;
            case "apr" -> 4;
            case "may" -> 5;
            case "jun" -> 6;
            case "jul" -> 7;
            case "aug" -> 8;
            case "sep" -> 9;
            case "oct" -> 10;
            case "nov" -> 11;
            case "dec" -> 12;
            default -> 0;
        };
    }

    private static String padDate(String day, String month, String year) {
        return String.format("%02d/%02d/%s", Integer.parseInt(day), Integer.parseInt(month), year);
    }

    private static int monthToNumber(String month) {
        return switch (month.toLowerCase()) {
            case "january" -> 1;
            case "february" -> 2;
            case "march" -> 3;
            case "april" -> 4;
            case "may" -> 5;
            case "june" -> 6;
            case "july" -> 7;
            case "august" -> 8;
            case "september" -> 9;
            case "october" -> 10;
            case "november" -> 11;
            case "december" -> 12;
            default -> 0;
        };
    }

    static String extractDateAfterLabel(String text, String... labels) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length; i++) {
            String lower = lines[i].toLowerCase();
            for (String label : labels) {
                if (!lower.contains(label.toLowerCase())) {
                    continue;
                }
                String sameLine = firstDate(lines[i]);
                if (!sameLine.isEmpty()) {
                    return normalizeDate(sameLine);
                }
                for (int j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                    String next = firstDate(lines[j]);
                    if (!next.isEmpty()) {
                        return normalizeDate(next);
                    }
                }
            }
        }
        return "";
    }

    static String firstDate(String line) {
        Matcher slash = SLASH_DATE.matcher(line);
        if (slash.find()) {
            return slash.group();
        }
        Matcher dash = DASH_DATE.matcher(line);
        if (dash.find()) {
            return dash.group();
        }
        Matcher iso = ISO_DATE.matcher(line);
        if (iso.find()) {
            return iso.group();
        }
        Matcher month = MONTH_DATE.matcher(line);
        if (month.find()) {
            return month.group();
        }
        Matcher dayMonth = DAY_MONTH_DATE.matcher(line);
        if (dayMonth.find()) {
            return dayMonth.group();
        }
        Matcher dayMonDash = DAY_MON_DASH_DATE.matcher(line);
        if (dayMonDash.find()) {
            return dayMonDash.group();
        }
        return "";
    }

    static String extractEmail(String text) {
        Matcher matcher = EMAIL.matcher(text);
        if (matcher.find()) {
            return matcher.group().trim();
        }
        return "";
    }

    static String buildSimpleJson(Map<String, String> fields) {
        if (fields == null || fields.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> entry : fields.entrySet()) {
            if (entry.getValue() == null || entry.getValue().isBlank()) {
                continue;
            }
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('"').append(escape(entry.getKey())).append("\":\"")
                    .append(escape(entry.getValue())).append('"');
        }
        sb.append('}');
        return first ? "" : sb.toString();
    }

    static String buildActivitiesJson(List<String> enActivities, List<String> arActivities) {
        if (enActivities.isEmpty() && arActivities.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("[");
        int count = Math.max(enActivities.size(), arActivities.size());
        for (int i = 0; i < count; i++) {
            if (i > 0) {
                sb.append(',');
            }
            String en = i < enActivities.size() ? enActivities.get(i) : "";
            String ar = i < arActivities.size() ? arActivities.get(i) : "";
            sb.append("{\"en\":\"")
                    .append(escape(en))
                    .append("\",\"ar\":\"")
                    .append(escape(ar))
                    .append("\"}");
        }
        sb.append(']');
        return sb.toString();
    }

    static String toPersonJson(List<Map<String, String>> people) {
        if (people == null || people.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Map<String, String> record : people) {
            String nameEn = record.getOrDefault("nameEn", "");
            String nameAr = record.getOrDefault("nameAr", "");
            if (!nameEn.matches(".*[A-Za-z]{3,}.*") && nameAr.length() < 3) {
                continue;
            }
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('{');
            boolean fieldFirst = true;
            for (Map.Entry<String, String> entry : record.entrySet()) {
                if (entry.getValue() == null || entry.getValue().isBlank()) {
                    continue;
                }
                if (!fieldFirst) {
                    sb.append(',');
                }
                fieldFirst = false;
                sb.append('"').append(escape(entry.getKey())).append("\":\"")
                        .append(escape(entry.getValue().replaceAll("\\s{2,}", " ").trim()))
                        .append('"');
            }
            sb.append('}');
        }
        sb.append(']');
        return first ? "" : sb.toString();
    }

    static int findLine(String[] lines, String pattern) {
        Pattern compiled = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
        for (int i = 0; i < lines.length; i++) {
            if (compiled.matcher(lines[i]).find()) {
                return i;
            }
        }
        return -1;
    }

    static int findLineFrom(String[] lines, int from, String pattern) {
        Pattern compiled = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE);
        for (int i = Math.max(0, from); i < lines.length; i++) {
            if (compiled.matcher(lines[i]).find()) {
                return i;
            }
        }
        return -1;
    }

    static String valueAfterLabel(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            String lower = lines[i].toLowerCase();
            for (String label : labels) {
                if (!lower.contains(label.toLowerCase())) {
                    continue;
                }
                String inline = lines[i].replaceFirst("(?i).*" + Pattern.quote(label) + "\\s*[:\\.]?\\s*", "").trim();
                if (inline.length() >= 2 && !inline.equalsIgnoreCase(label)) {
                    return inline;
                }
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    String next = lines[j].trim();
                    if (!next.isEmpty() && !looksLikeLabel(next)) {
                        return next;
                    }
                }
            }
        }
        return "";
    }

    static boolean looksLikeLabel(String line) {
        return isSeddHeadingOrFooter(line);
    }

    static boolean isSeddHeadingOrFooter(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String trimmed = line.trim();
        String lower = trimmed.toLowerCase();
        if (lower.equals("user name") || lower.startsWith("user name ")) {
            return true;
        }
        if (lower.contains("printing date") || trimmed.contains("تاريخ الطباعة")) {
            return true;
        }
        if (lower.contains("www.sedd") || lower.contains("official document")
                || lower.contains("economic development department")
                || lower.contains("government of sharjah")) {
            return true;
        }
        if (lower.contains("issue date") || lower.contains("expiry date")
                || lower.contains("license no") || lower.contains("registration no")
                || lower.contains("trade name") || lower.contains("legal status")
                || lower.contains("license members") || lower.contains("license details")) {
            return true;
        }
        if (trimmed.contains("تاريخ الإصدار") || trimmed.contains("تاريخ الإنتهاء")
                || trimmed.contains("تاريخ الانتهاء") || trimmed.contains("رقم الرخصة")
                || trimmed.contains("رقم السجل") || trimmed.contains("الاسم التجاري")
                || trimmed.contains("الشكل القانوني") || trimmed.contains("أطراف الرخصة")
                || trimmed.contains("تفاصيل الرخصة") || trimmed.contains("أنشطة الرخصة")
                || trimmed.contains("رقم الهوية") || trimmed.contains("رقم المستثمر")
                || trimmed.contains("اسم المستثمر") || trimmed.contains("رقم المستخدم")) {
            return true;
        }
        if (isSeddColumnHeader(trimmed)) {
            return true;
        }
        return false;
    }

    static boolean isSeddColumnHeader(String line) {
        String lower = line.toLowerCase().trim();
        return lower.equals("shares")
                || lower.equals("share")
                || lower.equals("type")
                || lower.equals("nationality")
                || lower.equals("partner")
                || lower.equals("manager")
                || lower.equals("investor name")
                || lower.equals("investor no")
                || line.equals("الحصص")
                || line.equals("الجنسية")
                || line.equals("الصفة")
                || line.equals("شريك")
                || line.equals("المدير");
    }

    static boolean isSeddSectionHeading(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String trimmed = line.trim();
        return trimmed.equals("أطراف الرخصة")
                || trimmed.equalsIgnoreCase("license members")
                || trimmed.contains("License Details")
                || trimmed.contains("تفاصيل الرخصة");
    }

    static String valueBeforeLabel(String line, String label) {
        if (line == null || label == null) {
            return "";
        }
        int idx = line.indexOf(label);
        if (idx > 0) {
            return line.substring(0, idx).trim();
        }
        return "";
    }

    static String valueAfterEnglishLabel(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            String lower = lines[i].toLowerCase();
            for (String label : labels) {
                if (!lower.contains(label.toLowerCase())) {
                    continue;
                }
                String inline = lines[i].replaceFirst("(?i).*" + Pattern.quote(label) + "\\s*[:\\.]?\\s*", "").trim();
                if (inline.length() >= 2 && !inline.equalsIgnoreCase(label) && !isSeddHeadingOrFooter(inline)) {
                    return inline;
                }
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    String next = lines[j].trim();
                    if (!next.isEmpty() && !isSeddHeadingOrFooter(next)) {
                        return next;
                    }
                }
            }
        }
        return "";
    }

    static String[] extractCapitalBlockNumbers(String[] lines) {
        int capitalIdx = findLine(lines, "(?i)^capital$");
        if (capitalIdx < 0) {
            capitalIdx = findLine(lines, "(?i)\\bcapital\\b");
        }
        if (capitalIdx < 0) {
            return new String[0];
        }
        List<String> numbers = new java.util.ArrayList<>();
        for (int i = capitalIdx + 1; i < lines.length; i++) {
            String candidate = lines[i].trim();
            if (candidate.contains("رأس المال")
                    || candidate.contains("الاسم التجاري")
                    || candidate.toLowerCase().contains("trade name")) {
                break;
            }
            if (candidate.matches("\\d{3,12}") && !candidate.startsWith("784")) {
                numbers.add(candidate);
            }
        }
        return numbers.toArray(new String[0]);
    }

    static String pickPermitNoAfterHeading(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("رقم التصريح")) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                String candidate = lines[j].trim();
                if (candidate.matches("\\d{5,8}") && !firstDate(candidate).equals(candidate)) {
                    return candidate;
                }
            }
        }
        return "";
    }

    static void setSeddConfidence(DocumentFieldsDto result, int filledFieldCount, boolean registerDetailsConsistent) {
        double score = Math.min(0.95, filledFieldCount / 12.0);
        if (!registerDetailsConsistent) {
            score = Math.max(0.6, score - 0.15);
        }
        result.setOverallConfidence(BigDecimal.valueOf(score));
    }

    static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "'");
    }

    static Map<String, String> linkedMap(String... keyValues) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            if (keyValues[i + 1] != null && !keyValues[i + 1].isBlank()) {
                map.put(keyValues[i], keyValues[i + 1]);
            }
        }
        return map;
    }
}
