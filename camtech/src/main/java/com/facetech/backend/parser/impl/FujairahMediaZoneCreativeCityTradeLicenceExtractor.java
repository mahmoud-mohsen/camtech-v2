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
 * Fujairah Creative City / Media Free Zone trade licences.
 * Heading-driven (EN + AR labels); does not hard-code licence-specific values.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FujairahMediaZoneCreativeCityTradeLicenceExtractor {

    private static final Pattern LICENSE_NO = Pattern.compile("(?i)\\b(\\d{3,6}/\\d{4})\\b");
    private static final Pattern PO_BOX = Pattern.compile("(?i)P\\.?\\s*O\\.?\\s*Box\\s*(\\d{3,6})");
    /** UAE tax / TRN is typically 15 digits starting with 10. */
    private static final Pattern TAX_NO = Pattern.compile("(?i)\\b(10\\d{13})\\b");
    private static final Pattern DIGITS_REG = Pattern.compile("^\\d{10,20}$");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = splitLines(normalized);

        String licenseNo = valueAfterLabel(lines, "License No", "Operating Name", "Owner", "Tax Registration");
        if (licenseNo.isBlank()) {
            licenseNo = valueAfterArabicLabel(lines, "رقم الرخصة", "الاسم التجاري", "المالك");
        }
        if (licenseNo.isBlank()) {
            Matcher m = LICENSE_NO.matcher(normalized);
            if (m.find()) {
                licenseNo = m.group(1);
            }
        }
        addIfNotEmpty(result, "licenseNo", licenseNo);
        addIfNotEmpty(result, "licenceType", "Trade License");

        String company = valueAfterLabel(lines, "Operating Name", "Owner", "Place of Inc", "Legal Status");
        String companyAr = valueAfterArabicLabel(lines, "الاسم التجاري", "المالك", "منشأ الشركة", "الشكل القانوني");
        addIfNotEmpty(result, "companyName", company);
        addIfNotEmpty(result, "businessName", company);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        String legal = valueAfterLabel(lines, "Legal Status", "Activity", "Address");
        String legalAr = valueAfterArabicLabel(lines, "الشكل القانوني", "النشاط", "العنوان");
        addIfNotEmpty(result, "legalType", legal);
        addIfNotEmpty(result, "legalTypeAr", legalAr);

        String place = valueAfterLabel(lines, "Place of Inc", "Legal Status", "Activity");
        addIfNotEmpty(result, "issuingPlace", place);

        String address = valueAfterLabel(lines, "Address", "Person in Charge", "Establishment Date", "Date of Issue");
        addIfNotEmpty(result, "address", address);
        Matcher po = PO_BOX.matcher(normalized);
        if (po.find()) {
            addIfNotEmpty(result, "poBox", po.group(1));
        }

        String issue = dateAfterLabel(lines, "Date of Issue");
        if (issue.isBlank()) {
            issue = dateNearArabicLabel(lines, "تاريخ الاصدار", "تاريخ الإصدار");
        }
        String expiry = dateAfterLabel(lines, "Expiry Date");
        if (expiry.isBlank()) {
            expiry = dateNearArabicLabel(lines, "تاريخ الانتهاء", "تاريخ الإنتهاء");
        }
        // Creative City OCR often dumps expiry near footer after English disclaimer.
        if (expiry.isBlank() || expiry.equals(issue)) {
            expiry = findFooterExpiry(lines, issue);
        }
        addIfNotEmpty(result, "issueDate", issue);
        addIfNotEmpty(result, "expiryDate", expiry);

        // Establishment Date EN line is often empty; value sits under تاريخ التأسيس (after Position).
        String est = establishmentDate(lines, issue);
        addIfNotEmpty(result, "establishmentDate", est);

        String registerNo = registrationNumber(lines, normalized);
        addIfNotEmpty(result, "registerNo", registerNo);
        addIfNotEmpty(result, "taxRegistrationNo", registerNo);

        List<String> enActs = extractEnglishActivities(lines);
        List<String> arActs = extractArabicActivities(lines, enActs.size());
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(enActs, arActs));

        String manager = valueAfterLabel(lines, "Person in Charge", "Establishment Date", "Date of Issue", "Position");
        String managerAr = valueAfterArabicLabel(lines, "الموظف المسؤول", "المهنة", "تاريخ", "CREATIVE");
        String position = valueAfterLabel(lines, "Position", "Date of Issue", "Expiry", "CREATIVE");
        if (position.isBlank()) {
            position = valueAfterArabicLabel(lines, "المهنة", "تاريخ");
        }
        // Strip trailing dates accidentally glued by OCR next to Position / المهنة.
        if (!position.isBlank()) {
            position = position.replaceAll("\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b", "").replaceAll("\\s{2,}", " ").trim();
        }
        addIfNotEmpty(result, "manager", manager);
        addIfNotEmpty(result, "managerAr", managerAr);

        List<Map<String, String>> members = extractMembers(lines, manager, managerAr, position);
        addIfNotEmpty(result, "licenseMembers", toPersonJson(members));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Fujairah Creative City trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private List<Map<String, String>> extractMembers(String[] lines, String manager, String managerAr,
                                                     String position) {
        List<Map<String, String>> people = new ArrayList<>();
        String ownersEn = valueAfterLabel(lines, "Owner", "Place of Inc", "Legal Status", "Activity");
        String ownersAr = valueAfterArabicLabel(lines, "المالك", "منشأ الشركة", "الشكل القانوني", "النشاط");
        List<String> enNames = splitPeople(ownersEn);
        List<String> arNames = alignOwnerArabicNames(enNames, splitPeopleAr(ownersAr), manager, managerAr);

        for (int i = 0; i < Math.max(enNames.size(), arNames.size()); i++) {
            Map<String, String> person = new LinkedHashMap<>();
            if (i < enNames.size()) {
                person.put("nameEn", enNames.get(i));
            }
            if (i < arNames.size() && arNames.get(i) != null && !arNames.get(i).isBlank()) {
                person.put("nameAr", arNames.get(i));
            }
            person.put("role", "Owner");
            if (manager != null && !manager.isBlank()
                    && i < enNames.size()
                    && namesLikelySame(enNames.get(i), manager)) {
                person.put("role", "Owner / Manager");
                if ((person.get("nameAr") == null || person.get("nameAr").isBlank())
                        && managerAr != null && !managerAr.isBlank()) {
                    person.put("nameAr", arabicTextProcessor.normalizeArabic(managerAr));
                }
                if (position != null && !position.isBlank()) {
                    person.put("roleAr", position);
                }
            }
            people.add(person);
        }

        if (manager != null && !manager.isBlank()
                && people.stream().noneMatch(p -> namesLikelySame(p.get("nameEn"), manager))) {
            Map<String, String> person = new LinkedHashMap<>();
            person.put("nameEn", manager);
            if (managerAr != null && !managerAr.isBlank()) {
                person.put("nameAr", arabicTextProcessor.normalizeArabic(managerAr));
            }
            person.put("role", position != null && !position.isBlank() ? position : "Manager");
            people.add(person);
        }
        return people;
    }

    /**
     * When Owner EN is comma-separated but المالك OCR glues Arabic names without ،,
     * use الموظف المسؤول Arabic as the person-in-charge owner and peel the remainder
     * for the other owner(s). Heading-driven — not hard-coded person values.
     */
    private List<String> alignOwnerArabicNames(List<String> enNames, List<String> arNames,
                                               String manager, String managerAr) {
        if (enNames.isEmpty()) {
            return arNames;
        }
        if (arNames.size() >= enNames.size()) {
            return arNames;
        }

        List<String> out = new ArrayList<>();
        for (int i = 0; i < enNames.size(); i++) {
            out.add("");
        }

        String glued = arNames.isEmpty() ? "" : arabicTextProcessor.normalizeArabic(arNames.get(0));
        int mgrIdx = -1;
        if (manager != null && !manager.isBlank()) {
            for (int i = 0; i < enNames.size(); i++) {
                if (namesLikelySame(enNames.get(i), manager)) {
                    mgrIdx = i;
                    break;
                }
            }
        }

        String mgrArNorm = (managerAr == null || managerAr.isBlank())
                ? ""
                : arabicTextProcessor.normalizeArabic(managerAr);

        if (mgrIdx >= 0 && !mgrArNorm.isBlank()) {
            out.set(mgrIdx, mgrArNorm);
            String remainder = peelArabicNamePrefix(glued, mgrArNorm);
            List<Integer> others = new ArrayList<>();
            for (int i = 0; i < enNames.size(); i++) {
                if (i != mgrIdx) {
                    others.add(i);
                }
            }
            if (others.size() == 1 && !remainder.isBlank()) {
                out.set(others.get(0), remainder);
            } else if (others.size() > 1 && !remainder.isBlank()) {
                List<String> parts = splitArabicByEnglishWordCounts(others, enNames, remainder);
                for (int o = 0; o < others.size() && o < parts.size(); o++) {
                    out.set(others.get(o), parts.get(o));
                }
            }
            return out;
        }

        // No person-in-charge Arabic: split glued المالك by EN token counts.
        if (!glued.isBlank() && enNames.size() >= 2) {
            List<Integer> all = new ArrayList<>();
            for (int i = 0; i < enNames.size(); i++) {
                all.add(i);
            }
            List<String> parts = splitArabicByEnglishWordCounts(all, enNames, glued);
            for (int i = 0; i < enNames.size() && i < parts.size(); i++) {
                out.set(i, parts.get(i));
            }
            return out;
        }

        if (!glued.isBlank() && enNames.size() == 1) {
            out.set(0, glued);
        }
        return out;
    }

    private String peelArabicNamePrefix(String glued, String prefix) {
        if (glued == null || glued.isBlank() || prefix == null || prefix.isBlank()) {
            return "";
        }
        String g = arabicTextProcessor.normalizeArabic(glued).replaceAll("\\s{2,}", " ").trim();
        String p = arabicTextProcessor.normalizeArabic(prefix).replaceAll("\\s{2,}", " ").trim();
        if (g.equals(p)) {
            return "";
        }
        if (g.startsWith(p)) {
            return g.substring(p.length()).replaceFirst("^[,،\\s]+", "").trim();
        }
        // Loose: drop shared leading tokens.
        String[] gt = g.split("\\s+");
        String[] pt = p.split("\\s+");
        int i = 0;
        while (i < gt.length && i < pt.length && gt[i].equals(pt[i])) {
            i++;
        }
        if (i == 0) {
            return g;
        }
        StringBuilder sb = new StringBuilder();
        for (int j = i; j < gt.length; j++) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(gt[j]);
        }
        return sb.toString().trim();
    }

    private List<String> splitArabicByEnglishWordCounts(List<Integer> indices, List<String> enNames,
                                                        String arabic) {
        List<String> out = new ArrayList<>();
        String[] tokens = arabicTextProcessor.normalizeArabic(arabic).replaceAll("\\s{2,}", " ")
                .trim().split("\\s+");
        if (tokens.length == 0 || indices.isEmpty()) {
            return out;
        }
        int[] weights = new int[indices.size()];
        int total = 0;
        for (int i = 0; i < indices.size(); i++) {
            int w = Math.max(2, enNames.get(indices.get(i)).trim().split("\\s+").length);
            weights[i] = w;
            total += w;
        }
        int cursor = 0;
        for (int i = 0; i < indices.size(); i++) {
            int take = (i == indices.size() - 1)
                    ? (tokens.length - cursor)
                    : Math.max(2, (int) Math.round(tokens.length * (weights[i] / (double) total)));
            take = Math.min(take, tokens.length - cursor - 2 * (indices.size() - i - 1));
            take = Math.max(1, take);
            StringBuilder sb = new StringBuilder();
            for (int k = 0; k < take && cursor < tokens.length; k++, cursor++) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(tokens[cursor]);
            }
            out.add(sb.toString().trim());
        }
        return out;
    }

    private List<String> extractEnglishActivities(String[] lines) {
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            String normalizedLabel = lines[i].toLowerCase(Locale.ROOT).replace(":", "").trim();
            if (normalizedLabel.equals("activity")) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return List.of();
        }
        StringBuilder block = new StringBuilder();
        for (int i = start + 1; i < Math.min(start + 14, lines.length); i++) {
            String line = lines[i].trim();
            if (line.replace(":", "").trim().equalsIgnoreCase("Address")
                    || line.replace(":", "").trim().equalsIgnoreCase("Person in Charge")
                    || line.replace(":", "").trim().equalsIgnoreCase("Establishment Date")
                    || line.replace(":", "").trim().equalsIgnoreCase("Date of Issue")
                    || line.replace(":", "").trim().equalsIgnoreCase("Position")
                    || isKnownArLabel(line)) {
                break;
            }
            if (line.matches("(?i)^Code\\s*:?$") || line.matches("(?i)^[A-Z]\\s*\\|\\s*[A-Z]{1,4}$")
                    || line.matches("(?i)^(Z|B|CC|COP)$")) {
                continue;
            }
            if (line.matches("(?i)CREATIVE CITY|MEDIA FREE ZONE|FUJAIRAH|THE EMIRATES|Approved electronic.*")
                    || line.contains("الموظف المسؤول") || line.contains("رخصة تجارية")) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (line.matches(".*[A-Za-z].*")) {
                if (block.length() > 0) {
                    block.append(' ');
                }
                block.append(line);
            }
        }
        String text = block.toString().replaceAll("\\s{2,}", " ").trim();
        if (text.isBlank()) {
            return List.of();
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String part : text.split("[,;]")) {
            String t = part.replaceAll("\\s{2,}", " ").trim();
            if (t.length() < 3) {
                continue;
            }
            if (t.matches("(?i)^(code|z|b|cc|cop)$")) {
                continue;
            }
            out.add(t);
        }
        if (out.isEmpty()) {
            out.add(text);
        }
        return new ArrayList<>(out);
    }

    private List<String> extractArabicActivities(String[] lines, int enCount) {
        String block = multiValueAfterArabicLabel(lines, "النشاط", "العنوان", "المهنة", "تاريخ");
        if (block.isBlank()) {
            return List.of();
        }
        List<String> parts = new ArrayList<>();
        for (String part : block.split("[,،;]")) {
            String t = arabicTextProcessor.normalizeArabic(part.replaceAll("\\s{2,}", " ").trim());
            if (t.length() >= 3) {
                parts.add(t);
            }
        }
        if (parts.isEmpty()) {
            String t = arabicTextProcessor.normalizeArabic(block);
            if (t.length() >= 3) {
                parts.add(t);
            }
        }
        // If English is a single activity phrase, keep Arabic as one paired value.
        if (enCount == 1 && parts.size() > 1) {
            return List.of(String.join(" ", parts));
        }
        // Split glued "وسيط … استشارات …" when EN has more activities than Arabic commas.
        if (enCount > parts.size()) {
            List<String> expanded = new ArrayList<>();
            for (String part : parts) {
                int idx = part.indexOf("استشارات");
                if (part.contains("وسيط") && idx > 2) {
                    String left = part.substring(0, idx).trim();
                    String right = part.substring(idx).trim();
                    if (left.length() >= 3) {
                        expanded.add(left);
                    }
                    if (right.length() >= 3) {
                        expanded.add(right);
                    }
                } else {
                    expanded.add(part);
                }
            }
            if (expanded.size() > parts.size()) {
                parts = expanded;
            }
        }
        // Align to EN count when OCR glued multiple Arabic activities into fewer/more chunks.
        while (enCount > 0 && parts.size() > enCount && parts.size() >= 2) {
            int mergeIdx = 1;
            int bestGap = Integer.MIN_VALUE;
            for (int i = 1; i < parts.size(); i++) {
                int gap = parts.get(i - 1).length() - parts.get(i).length();
                if (gap > bestGap) {
                    bestGap = gap;
                    mergeIdx = i;
                }
            }
            if (bestGap <= 0) {
                break;
            }
            parts.set(mergeIdx - 1, parts.get(mergeIdx - 1) + " " + parts.get(mergeIdx));
            parts.remove(mergeIdx);
        }
        return parts;
    }

    private String findFooterExpiry(String[] lines, String issue) {
        // Prefer date immediately before/after تاريخ الانتهاء.
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("تاريخ الانتهاء") && !lines[i].contains("تاريخ الإنتهاء")) {
                continue;
            }
            for (int j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 2); j++) {
                String d = firstDate(lines[j]);
                if (!d.isEmpty()) {
                    String n = normalizeDate(d);
                    if (!n.equals(issue)) {
                        return n;
                    }
                }
            }
        }
        // Fallback: last distinct dd/MM/yyyy in document that is not issue date.
        String last = "";
        for (String line : lines) {
            String d = firstDate(line);
            if (d.isEmpty()) {
                continue;
            }
            String n = normalizeDate(d);
            if (!n.equals(issue)) {
                last = n;
            }
        }
        return last;
    }

    private List<String> splitPeople(String value) {
        List<String> out = new ArrayList<>();
        if (value == null || value.isBlank()) {
            return out;
        }
        for (String part : value.split(",")) {
            String t = part.replaceAll("\\s{2,}", " ").trim();
            if (t.length() >= 3 && t.matches(".*[A-Za-z].*")) {
                out.add(t);
            }
        }
        return out;
    }

    private List<String> splitPeopleAr(String value) {
        List<String> out = new ArrayList<>();
        if (value == null || value.isBlank()) {
            return out;
        }
        // Arabic owners may be separated by Arabic comma or spaces between full names.
        for (String part : value.split("[,،]")) {
            String t = arabicTextProcessor.normalizeArabic(part.replaceAll("\\s{2,}", " ").trim());
            if (t.length() >= 3) {
                out.add(t);
            }
        }
        return out;
    }

    private boolean namesLikelySame(String a, String b) {
        if (a == null || b == null || a.isBlank() || b.isBlank()) {
            return false;
        }
        String x = a.toUpperCase(Locale.ROOT).replaceAll("[^A-Z]", "");
        String y = b.toUpperCase(Locale.ROOT).replaceAll("[^A-Z]", "");
        return !x.isBlank() && !y.isBlank() && (x.contains(y) || y.contains(x));
    }

    private String valueAfterLabel(String[] lines, String label, String... stops) {
        int start = findLabel(lines, label);
        if (start < 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (isStop(line, stops) || isKnownEnLabel(line) || isKnownArLabel(line)) {
                break;
            }
            if (line.matches("(?i)CREATIVE CITY|MEDIA FREE ZONE|FUJAIRAH|THE EMIRATES|Approved electronic.*")) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (line.matches(".*[A-Za-z0-9].*")) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(line.replaceFirst("^[:\\-–]\\s*", "").trim());
            }
            if (sb.length() > 120) {
                break;
            }
        }
        return sb.toString().replaceAll("\\s{2,}", " ").trim();
    }

    private String multiValueAfterLabel(String[] lines, String label, String... stops) {
        return valueAfterLabel(lines, label, stops);
    }

    private String valueAfterArabicLabel(String[] lines, String label, String... stops) {
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains(label)) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return "";
        }
        // Same-line value after label:
        String same = lines[start];
        int idx = same.indexOf(label);
        if (idx >= 0) {
            String after = same.substring(idx + label.length()).replaceFirst("^[:\\s]+", "").trim();
            if (arabicTextProcessor.containsArabic(after) && after.length() >= 3
                    && !after.matches(".*[A-Za-z]{4,}.*")) {
                return arabicTextProcessor.normalizeArabic(after);
            }
        }
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (isStop(line, stops) || isKnownArLabel(line) || isKnownEnLabel(line)) {
                break;
            }
            if (line.contains("https://") || line.contains("للإبداع") && line.contains("وثيقة")) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{4,}.*")
                    && line.length() >= 3) {
                return arabicTextProcessor.normalizeArabic(line.replaceFirst("^[:\\-–]\\s*", ""));
            }
        }
        return "";
    }

    private String multiValueAfterArabicLabel(String[] lines, String label, String... stops) {
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains(label)) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        String same = lines[start];
        int idx = same.indexOf(label);
        if (idx >= 0) {
            String after = same.substring(idx + label.length()).replaceFirst("^[:\\s]+", "").trim();
            if (arabicTextProcessor.containsArabic(after)) {
                sb.append(after);
            }
        }
        for (int i = start + 1; i < Math.min(start + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (isStop(line, stops) || isKnownArLabel(line) || isKnownEnLabel(line)) {
                break;
            }
            if (!arabicTextProcessor.containsArabic(line) || line.matches(".*[A-Za-z]{4,}.*")) {
                if (sb.length() > 0) {
                    break;
                }
                continue;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(line);
        }
        return arabicTextProcessor.normalizeArabic(sb.toString().replaceAll("\\s{2,}", " ").trim());
    }

    private String dateAfterLabel(String[] lines, String label) {
        int start = findLabel(lines, label);
        if (start < 0) {
            return "";
        }
        for (int i = start; i < Math.min(start + 5, lines.length); i++) {
            if (i > start && isDateStopLabel(lines[i])) {
                break;
            }
            String d = firstDate(lines[i]);
            if (!d.isEmpty()) {
                // Heading-only line with no trailing date — keep scanning.
                String stripped = lines[i].toLowerCase(Locale.ROOT)
                        .replace(":", "").replace(label.toLowerCase(Locale.ROOT), "").trim();
                if (stripped.isBlank() && i == start) {
                    continue;
                }
                return normalizeDate(d);
            }
        }
        return "";
    }

    private boolean isDateStopLabel(String line) {
        String t = line.replace(":", "").trim();
        return t.matches("(?i)^(Date of Issue|Establishment Date|Expiry Date|Position|Code)$")
                || t.contains("تاريخ الاصدار") || t.contains("تاريخ الإصدار")
                || t.contains("تاريخ الانتهاء") || t.contains("تاريخ الإنتهاء")
                || t.contains("تاريخ التأسيس");
    }

    /**
     * Creative City: EN "Establishment Date" is frequently blank. The value appears either:
     * - after Arabic تاريخ التأسيس (before تاريخ الاصدار), or
     * - under Position / المهنة just before تاريخ الاصدار (OCR column shuffle).
     */
    private String establishmentDate(String[] lines, String issue) {
        String fromAr = dateAfterArabicEstablishment(lines, issue);
        if (!fromAr.isBlank()) {
            return fromAr;
        }
        String fromPosition = dateBetweenPositionAndIssue(lines, issue);
        if (!fromPosition.isBlank()) {
            return fromPosition;
        }
        // EN path: do not spill into Date of Issue.
        int start = findLabel(lines, "Establishment Date");
        if (start < 0) {
            return "";
        }
        for (int i = start + 1; i < Math.min(start + 4, lines.length); i++) {
            String normalizedLine = lines[i].toLowerCase(Locale.ROOT).replace(":", "").trim();
            if (normalizedLine.startsWith("date of issue") || isDateStopLabel(lines[i])) {
                break;
            }
            String d = firstDate(lines[i]);
            if (!d.isEmpty()) {
                return normalizeDate(d);
            }
        }
        return "";
    }

    private String dateBetweenPositionAndIssue(String[] lines, String issue) {
        int start = findLabel(lines, "Position");
        if (start < 0) {
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].equals("المهنة") || lines[i].startsWith("المهنة")) {
                    start = i;
                    break;
                }
            }
        }
        if (start < 0) {
            return "";
        }
        String sameAsIssue = "";
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("تاريخ الاصدار") || line.contains("تاريخ الإصدار")
                    || line.contains("تاريخ الانتهاء") || line.contains("Expiry Date")
                    || line.matches("(?i)^Date of Issue.*")
                    || line.contains("The Licensee must")) {
                break;
            }
            if (line.matches("(?i)^(CEO|General Manager|Manager|Code)$")
                    || line.equals("رئيس تنفيذي") || line.equals("مدير عام")) {
                continue;
            }
            String d = firstDate(line);
            if (!d.isEmpty()) {
                String n = normalizeDate(d);
                if (issue == null || issue.isBlank() || !n.equals(issue)) {
                    return n;
                }
                sameAsIssue = n;
            }
        }
        return sameAsIssue;
    }

    private String dateAfterArabicEstablishment(String[] lines, String issue) {
        int start = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains("تاريخ التأسيس")) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return "";
        }
        String sameAsIssue = "";
        for (int i = start; i < Math.min(start + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (i > start && (line.contains("تاريخ الاصدار") || line.contains("تاريخ الإصدار")
                    || line.contains("تاريخ الانتهاء") || line.contains("Expiry Date")
                    || line.matches("(?i)^Date of Issue.*"))) {
                break;
            }
            if (line.matches("(?i)^(Position|CEO|General Manager|Code)$")
                    || line.equals("المهنة") || line.equals("رئيس تنفيذي") || line.equals("مدير عام")) {
                continue;
            }
            // Same-line date after تاريخ التأسيس
            if (i == start) {
                int idx = line.indexOf("تاريخ التأسيس");
                if (idx >= 0) {
                    String after = line.substring(idx + "تاريخ التأسيس".length());
                    String d = firstDate(after);
                    if (!d.isEmpty()) {
                        String n = normalizeDate(d);
                        if (issue == null || issue.isBlank() || !n.equals(issue)) {
                            return n;
                        }
                        sameAsIssue = n;
                    }
                }
                continue;
            }
            String d = firstDate(line);
            if (!d.isEmpty()) {
                String n = normalizeDate(d);
                if (issue == null || issue.isBlank() || !n.equals(issue)) {
                    return n;
                }
                if (sameAsIssue.isBlank()) {
                    sameAsIssue = n;
                }
            }
        }
        return sameAsIssue;
    }

    private String registrationNumber(String[] lines, String text) {
        // Heading: Tax Registration Number
        int idx = findLabel(lines, "Tax Registration Number");
        if (idx >= 0) {
            for (int i = idx; i < Math.min(idx + 4, lines.length); i++) {
                String line = lines[i].replace(":", " ").trim();
                Matcher m = TAX_NO.matcher(line);
                if (m.find()) {
                    return m.group(1);
                }
                Matcher digits = DIGITS_REG.matcher(line);
                if (digits.matches() && line.startsWith("10")) {
                    return line;
                }
            }
        }
        // Arabic: رقم التسجيل الضريبي
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("رقم التسجيل الضريبي") && !lines[i].contains("رقم التسجيل")) {
                continue;
            }
            for (int j = i; j < Math.min(i + 4, lines.length); j++) {
                Matcher m = TAX_NO.matcher(lines[j]);
                if (m.find()) {
                    return m.group(1);
                }
                String t = lines[j].replace(":", " ").trim();
                if (DIGITS_REG.matcher(t).matches() && t.startsWith("10")) {
                    return t;
                }
            }
        }
        Matcher tax = TAX_NO.matcher(text);
        return tax.find() ? tax.group(1) : "";
    }

    private String dateNearArabicLabel(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            String matched = null;
            for (String label : labels) {
                if (lines[i].contains(label)) {
                    matched = label;
                    break;
                }
            }
            if (matched == null) {
                continue;
            }
            String same = lines[i];
            int idx = same.indexOf(matched);
            if (idx >= 0) {
                String after = same.substring(idx + matched.length());
                String d = firstDate(after);
                if (!d.isEmpty()) {
                    return normalizeDate(d);
                }
            }
            for (int j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
                if (isDateStopLabel(lines[j]) && firstDate(lines[j]).isEmpty()) {
                    break;
                }
                String d = firstDate(lines[j]);
                if (!d.isEmpty()) {
                    return normalizeDate(d);
                }
            }
        }
        return "";
    }

    private int findLabel(String[] lines, String label) {
        String target = label.toLowerCase(Locale.ROOT);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].toLowerCase(Locale.ROOT).replace(":", "").trim();
            if (line.equals(target) || line.startsWith(target)) {
                return i;
            }
        }
        return -1;
    }

    private boolean isStop(String line, String... stops) {
        String lower = line.toLowerCase(Locale.ROOT);
        for (String s : stops) {
            if (lower.contains(s.toLowerCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }

    private boolean isKnownEnLabel(String line) {
        return line.matches("(?i)^(License No\\.?|Operating Name|Owner|Place of Inc\\.?|Legal Status|"
                + "Activity|Address|Person in Charge|Establishment Date|Date of Issue|Expiry Date|"
                + "Position|Tax Registration Number|Code)\\s*:?$");
    }

    private boolean isKnownArLabel(String line) {
        return line.equals("رقم الرخصة") || line.equals("الاسم التجاري") || line.equals("المالك")
                || line.equals("منشأ الشركة") || line.equals("الشكل القانوني") || line.equals("النشاط")
                || line.equals("العنوان") || line.equals("المهنة") || line.equals("الموظف المسؤول")
                || line.equals("تاريخ التأسيس") || line.equals("تاريخ الانتهاء")
                || line.equals("تاريخ الاصدار") || line.equals("تاريخ الإصدار")
                || line.contains("رقم التسجيل الضريبي") || line.contains("رقم التسجيل")
                || line.startsWith("رقم الرخصة") || line.startsWith("الاسم التجاري")
                || line.startsWith("المالك") || line.startsWith("النشاط")
                || line.startsWith("الشكل القانوني") || line.startsWith("العنوان");
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
