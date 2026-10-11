package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * Fujairah Dibba Municipality trade licences (Local Registry / Business Name / Activity Name layout).
 * Heading-driven; separate from Fujairah Municipality (FUJAIRAH_DED).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FujairahDibbaDedTradeLicenceExtractor {

    private static final Pattern PHONE = Pattern.compile("(?<!\\d)(0?5\\d{8}|\\+?9715\\d{8})(?!\\d)");
    private static final Pattern EN_PERSON = Pattern.compile("^[A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){1,8}$");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = splitLines(normalized);

        addIfNotEmpty(result, "licenceType", extractLicenceType(lines));
        addIfNotEmpty(result, "licenseNo", extractLicenseNo(lines));

        String register = valueAfterExact(lines, "Local Registry No", "Business Name", "Acronym");
        if (register.isBlank() || !register.matches("\\d{6,12}")) {
            for (String line : lines) {
                if (line.matches("^\\d{7,12}$")) {
                    register = line;
                    break;
                }
            }
        }
        addIfNotEmpty(result, "registerNo", register);

        String company = findLineAfterLabel(lines, "رقم الرخصة",
                "(?i).*(CENTER|SERVICES|COMPANY|ESTABLISHMENT|TRADING).*", 8);
        if (company.isBlank()) {
            company = findLineAfterLabel(lines, "Business Name",
                    "(?i).*(CENTER|SERVICES|COMPANY|ESTABLISHMENT|TRADING).*", 12);
        }
        String companyAr = extractCompanyAr(lines);
        addIfNotEmpty(result, "companyName", company);
        addIfNotEmpty(result, "businessName", company);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        String legal = valueAfterExact(lines, "Legal Type", "Percentage", "Activity Name", "رقم الرخصة");
        if (legal.isBlank() || legal.matches("\\d+")) {
            legal = valueContaining(lines, "(?i)Sole Proprietorship|Limited Liability|Establishment");
        }
        if (legal.matches("(?i).*(SERVICES|CENTER|TRADING|WORKS|DOMESTIC).*")) {
            legal = valueContaining(lines, "(?i)^Sole Proprietorship$|^Limited Liability");
        }
        String legalAr = valueContainingArabic(lines, "مؤسسة فردية|ذات مسئولية|ذات مسؤولية");
        addIfNotEmpty(result, "legalType", legal);
        addIfNotEmpty(result, "legalTypeAr", legalAr);

        String issueDate = dateAfterLabel(lines, "Date Issuance", "تاريخ الإصدار", "تاريخ الاصدار");
        String expiryDate = dateAfterLabel(lines, "Date Expiry", "تاريخ الإنتهاء", "تاريخ الانتهاء");
        String establishmentDate = dateAfterLabel(lines, "Est. Date", "تاريخ التأسيس");
        // Dibba OCR often flips year digits (2016→2026, 2007→2027). Correct using heading order only.
        issueDate = correctIssueIfBeforeEstablishment(issueDate, establishmentDate);
        expiryDate = correctExpiryIfBeforeIssue(expiryDate, issueDate);
        addIfNotEmpty(result, "issueDate", issueDate);
        addIfNotEmpty(result, "expiryDate", expiryDate);
        addIfNotEmpty(result, "establishmentDate", establishmentDate);

        Matcher phone = PHONE.matcher(normalized);
        if (phone.find()) {
            addIfNotEmpty(result, "mobileNo", phone.group(1));
        }

        List<String> enActs = extractEnActivities(lines);
        List<String> arActs = extractArActivities(lines, enActs.size());
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(enActs, arActs));

        String address = sectionAfter(lines, "العنوان / Address", "Main Area", "Date Issuance", "This document");
        addIfNotEmpty(result, "address", address);

        List<Map<String, String>> members = extractMembers(lines);
        addIfNotEmpty(result, "licenseMembers", toPersonJson(members));
        addIfNotEmpty(result, "manager", extractManagerName(members));
        addIfNotEmpty(result, "managerAr", extractManagerNameAr(members));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Fujairah Dibba DED trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String extractCompanyAr(String[] lines) {
        for (String line : lines) {
            if (!arabicTextProcessor.containsArabic(line) || line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (line.contains("رقم السجل") || line.contains("الموحد") || line.contains("الاسم")
                    || line.contains("الشكل") || line.contains("بلدية") || line.contains("حكومة")
                    || line.contains("الامارات") || line.contains("الإمارات") || line.contains("تجديد")
                    || line.contains("تجدید") || line.equals("مؤسسة فردية") || line.equals("تدبير")) {
                continue;
            }
            if (line.contains("مركز") || line.contains("خدمات")
                    || (line.contains("مؤسسة") && !line.contains("فردية"))) {
                if (line.length() >= 8) {
                    return arabicTextProcessor.normalizeArabic(line);
                }
            }
        }
        return "";
    }

    private String extractLicenseNo(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (!(lines[i].contains("رقم الرخصة") || lines[i].equalsIgnoreCase("License Number")
                    || lines[i].equalsIgnoreCase("Legal Type"))) {
                continue;
            }
            for (int j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 2); j++) {
                if (lines[j].matches("^\\d{4,6}$")) {
                    return lines[j];
                }
            }
        }
        for (String line : lines) {
            if (line.matches("^\\d{4,6}$")) {
                return line;
            }
        }
        return "";
    }

    private String extractLicenceType(String[] lines) {
        for (String line : lines) {
            if (line.matches("(?i)Professional License|Commercial License|Industrial License")) {
                return line.replaceAll("(?i)\\s*License", " License").trim();
            }
            if (line.contains("رخصة مهنية")) {
                return "Professional License";
            }
            if (line.contains("رخصة تجارية")) {
                return "Commercial License";
            }
            if (line.contains("رخصة صناعية")) {
                return "Industrial License";
            }
        }
        return "";
    }

    private List<String> extractEnActivities(String[] lines) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        int start = indexContaining(lines, "Activity Name");
        int end = indexContaining(lines, "اسم النشاط");
        if (end < 0) {
            end = indexContaining(lines, "Stakeholders");
        }
        if (start < 0) {
            return new ArrayList<>();
        }
        if (end <= start) {
            end = Math.min(start + 12, lines.length);
        }
        StringBuilder current = new StringBuilder();
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.equalsIgnoreCase("Cafeteria")) {
                flushActivity(out, current);
                out.add("Cafeteria");
                continue;
            }
            if (isHeading(line)
                    || line.matches("(?i)^(Local Registry No|Business Name|Acronym|Legal Type|"
                    + "License Number|Percentage.*|Type\\s*/.*)$")) {
                continue;
            }
            if (line.matches("(?i)Unit.*|Fax|Owner.*|Nationality.*|Percentage.*")
                    || line.contains("الجنسية") || line.contains("اسم النشاط")) {
                if (line.contains("Nationality") || line.contains("الجنسية") || line.contains("Owner")) {
                    break;
                }
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (!line.matches(".*[A-Za-z].*")) {
                continue;
            }
            if (current.length() > 0
                    && (line.matches("(?i)^(workers|services|trading|domestic\\s+workers)$")
                    || current.toString().matches("(?i).*\\b(for|and|of|the|domestic)$"))) {
                current.append(' ').append(line);
                if (line.matches("(?i).*\\b(services?|trading|workers|employment|cafeteria)\\b.*")
                        || line.matches("(?i)^workers$")
                        || line.matches("(?i)^domestic\\s+workers$")) {
                    flushActivity(out, current);
                }
                continue;
            }
            if (current.length() > 0 && looksCompleteEnActivity(current.toString())
                    && Character.isUpperCase(line.charAt(0)) && !line.matches("(?i)^(and|of|for|domestic)\\b.*")) {
                flushActivity(out, current);
            }
            if (current.length() > 0) {
                current.append(' ');
            }
            current.append(line);
            if (looksCompleteEnActivity(current.toString()) && !line.matches("(?i).*\\bfor\\s*$")) {
                flushActivity(out, current);
            }
        }
        flushActivity(out, current);
        return new ArrayList<>(out);
    }

    private List<String> extractArActivities(String[] lines, int enCount) {
        List<String> out = new ArrayList<>();
        int start = indexContaining(lines, "اسم النشاط");
        if (start < 0) {
            return out;
        }
        StringBuilder current = new StringBuilder();
        for (int i = start + 1; i < Math.min(start + 12, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("أصحاب") || line.contains("Stakeholders") || line.contains("Owner")
                    || line.contains("Name /") || line.contains("الأنشطة الإقتصادية")) {
                break;
            }
            if (!arabicTextProcessor.containsArabic(line)) {
                continue;
            }
            if (current.length() > 0 && line.length() < 20
                    && !line.contains("بيع") && !line.contains("خدمات")) {
                current.append(' ').append(line);
                out.add(arabicTextProcessor.normalizeArabic(current.toString()));
                current.setLength(0);
                continue;
            }
            if (current.length() > 0) {
                out.add(arabicTextProcessor.normalizeArabic(current.toString()));
                current.setLength(0);
            }
            current.append(line);
        }
        if (current.length() > 0) {
            out.add(arabicTextProcessor.normalizeArabic(current.toString()));
        }
        while (enCount > 0 && out.size() > enCount && out.size() >= 2) {
            int mergeIdx = 1;
            int bestGap = Integer.MIN_VALUE;
            for (int i = 1; i < out.size(); i++) {
                int gap = out.get(i - 1).length() - out.get(i).length();
                if (gap > bestGap) {
                    bestGap = gap;
                    mergeIdx = i;
                }
            }
            if (bestGap <= 0) {
                break;
            }
            out.set(mergeIdx - 1, out.get(mergeIdx - 1) + " " + out.get(mergeIdx));
            out.remove(mergeIdx);
        }
        return out;
    }

    private void flushActivity(LinkedHashSet<String> out, StringBuilder current) {
        if (current.length() == 0) {
            return;
        }
        String t = current.toString().replaceAll("\\s{2,}", " ").trim();
        if (t.length() >= 3) {
            out.add(t);
        }
        current.setLength(0);
    }

    private boolean looksCompleteEnActivity(String text) {
        return text.matches("(?i).*\\b(services?|trading|employment|workers|cafeteria)\\b.*");
    }

    private List<Map<String, String>> extractMembers(String[] lines) {
        List<Map<String, String>> people = new ArrayList<>();
        int start = indexContaining(lines, "Stakeholders");
        if (start < 0) {
            start = indexContaining(lines, "أصحاب العلاقة");
        }
        if (start < 0) {
            start = indexContaining(lines, "Name / الاسم");
        }
        String nameAr = "";
        String nameEn = "";
        String share = "";
        String role = "";
        String nationality = "";
        String nationalityAr = "";

        // Percentage / Type headings sit above Activity Name on this template (before Stakeholders).
        int pctIdx = indexContaining(lines, "Percentage");
        if (pctIdx < 0) {
            pctIdx = indexContaining(lines, "النسبة");
        }
        if (pctIdx >= 0) {
            for (int i = pctIdx; i < Math.min(pctIdx + 8, lines.length); i++) {
                String line = lines[i].trim();
                if (line.matches("(?i)Activity Name|Unit.*") || line.contains("اسم النشاط")) {
                    break;
                }
                String r = normalizeRole(line);
                if (!r.isBlank()) {
                    role = r;
                }
                if (line.matches("\\d{1,3}(?:\\.\\d+)?\\s*%")) {
                    share = formatShare(line);
                }
            }
        }

        int from = start >= 0 ? start : 0;
        // Also scan a short window before Stakeholders for Nationality / Owner and Manager.
        int pre = Math.max(0, from - 12);
        for (int i = pre; i < from; i++) {
            String line = lines[i].trim();
            String r = normalizeRole(line);
            if (!r.isBlank() && (role.isBlank() || r.contains("Owner"))) {
                role = r;
            }
            if (line.matches("(?i)United Arab Emirates|UAE|Egypt|India")) {
                nationality = line.equalsIgnoreCase("UAE") ? "United Arab Emirates" : capitalize(line);
            }
            if (line.contains("الامارات") || line.contains("الإمارات") || line.equals("مصر")) {
                nationalityAr = arabicTextProcessor.normalizeArabic(line);
            }
            if (share.isBlank() && line.matches("\\d{1,3}(?:\\.\\d+)?\\s*%")) {
                share = formatShare(line);
            }
        }

        for (int i = from; i < Math.min(from + 40, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("الأنشطة الإقتصادية") || line.contains("Business Activities")
                    || line.contains("Date Expiry") || line.contains("Date Issuance")) {
                break;
            }
            if (line.matches("(?i)Owner and") && i + 1 < lines.length
                    && lines[i + 1].trim().equalsIgnoreCase("Manager")) {
                role = "Owner / Manager";
                continue;
            }
            String r = normalizeRole(line);
            if (!r.isBlank()) {
                role = r;
                continue;
            }
            if (line.matches("\\d{1,3}(?:\\.\\d+)?\\s*%")) {
                share = formatShare(line);
                continue;
            }
            if (line.matches("(?i)United Arab Emirates|UAE|Egypt|India")) {
                nationality = line.equalsIgnoreCase("UAE") ? "United Arab Emirates" : capitalize(line);
                continue;
            }
            if (line.contains("الامارات") || line.contains("الإمارات") || line.equals("مصر")) {
                nationalityAr = arabicTextProcessor.normalizeArabic(line);
                continue;
            }
            if (nameAr.isBlank() && arabicTextProcessor.containsArabic(line)
                    && !line.matches(".*[A-Za-z]{3,}.*") && line.length() >= 8
                    && !line.contains("الجنسية") && !line.contains("مالك")
                    && !line.contains("الرمز") && !line.contains("الصفة") && !line.contains("النسبة")) {
                nameAr = arabicTextProcessor.normalizeArabic(line);
                continue;
            }
            if (EN_PERSON.matcher(line).matches()
                    || (line.matches("^[A-Z][A-Z\\s'\\-]{8,}$") && line.split("\\s+").length >= 2)) {
                if (nameEn.isBlank()) {
                    nameEn = line.replaceAll("\\s{2,}", " ").trim();
                } else if (!nameEn.contains(line) && line.split("\\s+").length >= 2) {
                    nameEn = (nameEn + " " + line).replaceAll("\\s{2,}", " ").trim();
                }
            }
        }
        if (!nameEn.isBlank() || !nameAr.isBlank()) {
            Map<String, String> person = new LinkedHashMap<>();
            if (!nameEn.isBlank()) {
                person.put("nameEn", nameEn);
            }
            if (!nameAr.isBlank()) {
                person.put("nameAr", nameAr);
            }
            person.put("role", role.isBlank() ? "Owner / Manager" : role);
            if (!share.isBlank()) {
                person.put("share", share);
            }
            if (!nationality.isBlank()) {
                person.put("nationality", nationality);
            }
            if (!nationalityAr.isBlank()) {
                person.put("nationalityAr", nationalityAr);
            }
            people.add(person);
        }
        return people;
    }

    private String normalizeRole(String line) {
        String t = line.trim();
        if (t.equalsIgnoreCase("Manager") || t.equals("مدير") || t.equals("مدیر")) {
            return "Manager";
        }
        if (t.equalsIgnoreCase("Owner") || t.equals("مالك")) {
            return "Owner";
        }
        if (t.matches("(?i)Owner and\\s*Manager") || t.contains("مالك ومدير") || t.contains("مالك ومدیر")) {
            return "Owner / Manager";
        }
        return "";
    }

    private String formatShare(String line) {
        String share = line.replace("%", "").trim();
        if (!share.contains(".")) {
            share = share + ".0000";
        }
        return share.endsWith("%") ? share : share + "%";
    }

    private String extractManagerName(List<Map<String, String>> members) {
        for (Map<String, String> p : members) {
            String role = p.getOrDefault("role", "").toLowerCase(Locale.ROOT);
            if (role.contains("manager") && p.get("nameEn") != null) {
                return p.get("nameEn");
            }
        }
        return members.isEmpty() ? "" : members.get(0).getOrDefault("nameEn", "");
    }

    private String extractManagerNameAr(List<Map<String, String>> members) {
        for (Map<String, String> p : members) {
            String role = p.getOrDefault("role", "").toLowerCase(Locale.ROOT);
            if (role.contains("manager") && p.get("nameAr") != null) {
                return p.get("nameAr");
            }
        }
        return members.isEmpty() ? "" : members.get(0).getOrDefault("nameAr", "");
    }

    private String findLineAfterLabel(String[] lines, String label, String valueRegex, int window) {
        int idx = indexContaining(lines, label);
        if (idx < 0) {
            return "";
        }
        Pattern p = Pattern.compile(valueRegex);
        for (int i = idx + 1; i < Math.min(idx + window, lines.length); i++) {
            if (p.matcher(lines[i]).matches() || p.matcher(lines[i]).find()) {
                return lines[i].trim();
            }
        }
        return "";
    }

    private String valueContaining(String[] lines, String regex) {
        Pattern p = Pattern.compile(regex);
        for (String line : lines) {
            if (p.matcher(line).find() && line.length() >= 5
                    && !line.matches("(?i).*(SERVICES|CENTER|TRADING|WORKS|DOMESTIC).*")) {
                return line.trim();
            }
        }
        return "";
    }

    private String valueContainingArabic(String[] lines, String regex) {
        Pattern p = Pattern.compile(regex);
        for (String line : lines) {
            if (p.matcher(line).find() && arabicTextProcessor.containsArabic(line)
                    && !line.matches(".*[A-Za-z]{3,}.*")) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String valueAfterExact(String[] lines, String label, String... stops) {
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].equalsIgnoreCase(label) || lines[i].equals(label)) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            start = indexContaining(lines, label);
        }
        if (start < 0) {
            return "";
        }
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            boolean stop = false;
            for (String s : stops) {
                if (line.equalsIgnoreCase(s) || line.contains(s)) {
                    stop = true;
                    break;
                }
            }
            if (stop || isHeading(line)) {
                break;
            }
            if (line.length() >= 2) {
                return line;
            }
        }
        return "";
    }

    private String sectionAfter(String[] lines, String label, String... stops) {
        int idx = indexContaining(lines, label);
        if (idx < 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
            String line = lines[i].trim();
            boolean stop = false;
            for (String s : stops) {
                if (line.contains(s)) {
                    stop = true;
                    break;
                }
            }
            if (stop) {
                break;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(line);
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    /**
     * Prefer the date immediately after the matched heading on the same line
     * (Dibba packs Date Issuance + Est. Date on one OCR line).
     */
    private String dateAfterLabel(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String lower = line.toLowerCase(Locale.ROOT);
            for (String label : labels) {
                int idx = lower.indexOf(label.toLowerCase(Locale.ROOT));
                if (idx < 0) {
                    continue;
                }
                String after = line.substring(idx + label.length());
                String same = firstDate(after);
                if (!same.isEmpty()) {
                    return normalizeDate(same);
                }
                Matcher iso = Pattern.compile("(\\d{4}-\\d{2}-\\d{2})").matcher(after);
                if (iso.find()) {
                    return normalizeIso(iso.group(1));
                }
                for (int j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
                    String d = firstDate(lines[j]);
                    if (!d.isEmpty()) {
                        return normalizeDate(d);
                    }
                    Matcher nextIso = Pattern.compile("(\\d{4}-\\d{2}-\\d{2})").matcher(lines[j]);
                    if (nextIso.find()) {
                        return normalizeIso(nextIso.group(1));
                    }
                }
            }
        }
        return "";
    }

    /**
     * Dibba OCR often reads issuance year 2026 as 2016. If labeled issue is before Est. Date,
     * try 201X→202X (heading-bound; does not hard-code licence values).
     */
    private String correctIssueIfBeforeEstablishment(String issue, String establishment) {
        if (issue == null || issue.isBlank() || establishment == null || establishment.isBlank()) {
            return issue;
        }
        if (!isDateBefore(issue, establishment)) {
            return issue;
        }
        Matcher m = Pattern.compile("^(\\d{2})/(\\d{2})/(20)(1)(\\d)$").matcher(issue);
        if (m.matches()) {
            String candidate = m.group(1) + "/" + m.group(2) + "/202" + m.group(5);
            if (!isDateBefore(candidate, establishment)) {
                return candidate;
            }
        }
        return issue;
    }

    /**
     * Dibba OCR often reads expiry year 2027 as 2007. If labeled expiry is before issuance,
     * try a single 200X→202X year correction (still heading-bound, not value hard-coded).
     */
    private String correctExpiryIfBeforeIssue(String expiry, String issue) {
        if (expiry == null || expiry.isBlank() || issue == null || issue.isBlank()) {
            return expiry;
        }
        if (!isDateBefore(expiry, issue)) {
            return expiry;
        }
        Matcher m = Pattern.compile("^(\\d{2})/(\\d{2})/(20)(0)(\\d)$").matcher(expiry);
        if (m.matches()) {
            String candidate = m.group(1) + "/" + m.group(2) + "/202" + m.group(5);
            if (!isDateBefore(candidate, issue)) {
                return candidate;
            }
        }
        return expiry;
    }

    private boolean isDateBefore(String left, String right) {
        int[] a = parseSlashDate(left);
        int[] b = parseSlashDate(right);
        if (a == null || b == null) {
            return false;
        }
        if (a[2] != b[2]) {
            return a[2] < b[2];
        }
        if (a[1] != b[1]) {
            return a[1] < b[1];
        }
        return a[0] < b[0];
    }

    private int[] parseSlashDate(String value) {
        Matcher m = Pattern.compile("^(\\d{2})/(\\d{2})/(\\d{4})$").matcher(value.trim());
        if (!m.matches()) {
            return null;
        }
        return new int[]{
                Integer.parseInt(m.group(1)),
                Integer.parseInt(m.group(2)),
                Integer.parseInt(m.group(3))
        };
    }

    private String normalizeIso(String iso) {
        Matcher m = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})").matcher(iso);
        if (m.find()) {
            return m.group(3) + "/" + m.group(2) + "/" + m.group(1);
        }
        return iso;
    }

    private int indexContaining(String[] lines, String text) {
        String target = text.toLowerCase(Locale.ROOT);
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase(Locale.ROOT).contains(target)) {
                return i;
            }
        }
        return -1;
    }

    private boolean isHeading(String line) {
        return line.matches("(?i)^(License No\\.?|Trade Name|Legal Form|Phone|Email|Address|Remarks|"
                + "Issue Date|Expiry Date|Est\\. Date|Date Expiry|Date Issuance|Date Receipt|Renew|"
                + "English Activity Name|Share.*|Type/.*|"
                + "Nationality.*|Business Name|Acronym|Legal Type|Activity Name|Local Registry No|"
                + "License Number|Percentage.*|THE EMIRATES)$")
                || line.contains("رقم الرخصة") || line.contains("الإسم التجاري")
                || line.contains("الشكل القانوني");
    }

    private String capitalize(String s) {
        if (s == null || s.isBlank()) {
            return s;
        }
        if (s.equalsIgnoreCase("uae")) {
            return "UAE";
        }
        return s.substring(0, 1).toUpperCase(Locale.ROOT) + s.substring(1).toLowerCase(Locale.ROOT);
    }

    private String[] splitLines(String text) {
        List<String> out = new ArrayList<>();
        for (String line : text.split("\n")) {
            String t = line.trim();
            if (!t.isEmpty()) {
                out.add(t);
            }
        }
        return out.toArray(new String[0]);
    }
}
