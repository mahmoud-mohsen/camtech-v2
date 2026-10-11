package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractEmail;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.firstDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.normalizeDate;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;

/**
 * Fujairah Municipality (DED) trade licences.
 * Heading-driven; does not hard-code licence-specific company or person values.
 * Dibba Municipality licences use {@link FujairahDibbaDedTradeLicenceExtractor}.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FujairahDedTradeLicenceExtractor {

    private static final Pattern LICENSE_NO_LINE = Pattern.compile("^\\d{4,8}$");
    private static final Pattern SHARE_DEC = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*%?$");
    private static final Pattern PHONE = Pattern.compile("(?<!\\d)(0?5\\d{8}|\\+?9715\\d{8})(?!\\d)");
    private static final Pattern ROLE_EN = Pattern.compile(
            "(?i)^(manager|owner|partner|owner\\s+and\\s+manager|مالك|مدير|مدیر)$");
    private static final Pattern EN_COMPANY = Pattern.compile(
            "(?i).*(L\\.L\\.C|LLC|SPC|CENTER|SERVICES|COMPANY|TRADING|FZE|FZCO|FZ\\s*LLE).*");
    private static final Pattern EN_PERSON = Pattern.compile("^[A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){1,8}$");
    /** Investor English names may be title-case or all-lowercase OCR. */
    private static final Pattern EN_PERSON_LOOSE = Pattern.compile(
            "(?i)^[A-Za-z][A-Za-z'\\-]+(?:\\s+[A-Za-z][A-Za-z'\\-]+){1,8}-?$");
    private static final Pattern CS_NO = Pattern.compile("(?i)(CS-\\d+)");
    private static final Pattern SHARE_HEADING = Pattern.compile("(?i)share|الحصص");
    private static final Pattern TYPE_HEADING = Pattern.compile("(?i)^type\\s*/|الصفة");
    private static final Pattern NAT_HEADING = Pattern.compile("(?i)nationality|الجنسية");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String[] lines = splitLines(normalized);
        extractMunicipality(result, normalized, lines);

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setConfidence(result, filled);
        log.debug("Fujairah DED trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private void extractMunicipality(DocumentFieldsDto result, String text, String[] lines) {
        addIfNotEmpty(result, "licenceType", extractLicenceType(lines));
        addIfNotEmpty(result, "licenseNo", extractMunicipalityLicenseNo(lines));

        String company = extractMunicipalityCompanyEn(lines);
        String companyAr = firstArabicCompany(lines);
        if (companyAr.contains("مسئولية") || companyAr.contains("مسؤولية") || companyAr.contains("الفردية")
                || companyAr.contains("الشكل القانوني") || companyAr.contains("تجديد") || companyAr.contains("تجدید")
                || companyAr.contains("تاريخ") || companyAr.contains("الانتهاء") || companyAr.contains("الإنتهاء")
                || companyAr.matches(".*\\d{4}.*")) {
            companyAr = "";
        }
        if (companyAr.isBlank()) {
            companyAr = findArabicTradeName(lines);
        }
        // Prefer distinct trade-name lines like ريتاج للطباعة when present.
        for (String line : lines) {
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")
                    && line.length() >= 5 && line.length() <= 40
                    && (line.contains("للطباعة") || line.contains("للخدمات") || line.contains("للتجارة"))
                    && !line.contains("شكل") && !line.contains("سجل")) {
                companyAr = arabicTextProcessor.normalizeArabic(line);
                break;
            }
        }
        addIfNotEmpty(result, "companyName", company);
        addIfNotEmpty(result, "businessName", company);
        addIfNotEmpty(result, "companyNameAr", companyAr);
        addIfNotEmpty(result, "businessNameAr", companyAr);

        String legal = extractMunicipalityLegalType(lines);
        String legalAr = valueContainingArabic(lines, "شركة ذات|المؤسسة الفردية|الشخص الواحد");
        addIfNotEmpty(result, "legalType", legal);
        addIfNotEmpty(result, "legalTypeAr", legalAr);

        addIfNotEmpty(result, "issueDate", dateNear(lines, "Issue Date", "تاريخ الإصدار", "تاريخ الاصدار"));
        addIfNotEmpty(result, "expiryDate", dateNear(lines, "Expiry Date", "تاريخ الانتهاء", "تاريخ الإنتهاء"));
        addIfNotEmpty(result, "establishmentDate", dateNear(lines, "Est. Date", "تاريخ التأسيس"));

        addIfNotEmpty(result, "email", extractEmail(text));
        Matcher phone = PHONE.matcher(text);
        if (phone.find()) {
            addIfNotEmpty(result, "mobileNo", phone.group(1));
        }

        List<String> enActs = extractMunicipalityEnActivities(lines);
        List<String> arActs = extractMunicipalityArActivities(lines);
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(enActs, arActs));

        String addressAr = valueAfterArabicContains(lines, "العنوان", "رقم", "نوع", "الملاحظات");
        addIfNotEmpty(result, "addressAr", addressAr);

        List<Map<String, String>> members = extractMunicipalityMembers(lines);
        addIfNotEmpty(result, "licenseMembers", toPersonJson(members));
        addIfNotEmpty(result, "manager", extractManagerName(members));
        addIfNotEmpty(result, "managerAr", extractManagerNameAr(members));
    }

    private String findArabicTradeName(String[] lines) {
        for (String label : List.of("الإسم التجاري", "الاسم التجاري", "الاسم الاقتصادي")) {
            int idx = indexContaining(lines, label);
            if (idx < 0) {
                continue;
            }
            for (int i = Math.max(0, idx - 6); i < Math.min(lines.length, idx + 8); i++) {
                String line = lines[i].trim();
                if (!arabicTextProcessor.containsArabic(line) || line.matches(".*[A-Za-z]{3,}.*")) {
                    continue;
                }
                if (line.contains(label) || line.contains("الشكل القانوني") || line.contains("السجل")
                        || line.contains("البريد") || line.contains("الامارات") || line.contains("الإمارات")
                        || line.contains("مسئولية") || line.contains("مسؤولية") || line.equals("المؤسسة الفردية")
                        || line.contains("بلدية") || line.contains("تجديد") || line.contains("تجدید")
                        || line.contains("رقم السجل") || line.contains("الموحد")) {
                    continue;
                }
                if (line.length() >= 4) {
                    return arabicTextProcessor.normalizeArabic(line);
                }
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

    private String extractMunicipalityLicenseNo(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].matches("(?i)Professional License|Commercial License|Industrial License")
                    || lines[i].equals("رقم الرخصة")) {
                for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    if (LICENSE_NO_LINE.matcher(lines[j]).matches()) {
                        return lines[j];
                    }
                }
            }
            if (lines[i].equalsIgnoreCase("License No.") || lines[i].equalsIgnoreCase("License No")) {
                for (int j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                    if (LICENSE_NO_LINE.matcher(lines[j]).matches()) {
                        return lines[j];
                    }
                }
            }
        }
        return "";
    }

    private List<String> extractMunicipalityEnActivities(String[] lines) {
        List<String> out = new ArrayList<>();
        int start = indexContaining(lines, "English Activity Name");
        if (start < 0) {
            return out;
        }
        StringBuilder current = new StringBuilder();
        for (int i = start + 1; i < Math.min(start + 10, lines.length); i++) {
            String line = lines[i].trim();
            if (line.matches("(?i)Share.*|Type/.*|Nationality.*|Manager|Owner|Address|Remarks|Phone|Email")
                    || line.contains("اسم النشاط") || line.contains("الحصص") || isExactRole(line)) {
                break;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (!line.matches(".*[A-Za-z].*")) {
                continue;
            }
            if (current.length() > 0
                    && line.matches("(?i)^(workers|services|trading|domestic\\s+workers)$")) {
                current.append(' ').append(line);
                out.add(current.toString().replaceAll("\\s{2,}", " ").trim());
                current.setLength(0);
                continue;
            }
            if (current.length() > 0) {
                // Keep open when previous line looks wrapped (ends with for/and/of/domestic).
                if (current.toString().matches("(?i).*\\b(for|and|of|the|domestic)$")) {
                    current.append(' ').append(line);
                    if (line.matches("(?i).*\\b(services?|trading|workers|employment)\\b.*")
                            || line.matches("(?i)^workers$")) {
                        out.add(current.toString().replaceAll("\\s{2,}", " ").trim());
                        current.setLength(0);
                    }
                    continue;
                }
                out.add(current.toString().replaceAll("\\s{2,}", " ").trim());
                current.setLength(0);
            }
            if (line.matches("(?i).*\\b(services?|trading|employment|typing|photocopying)\\b.*")) {
                if (line.matches("(?i).*\\b(for|and|of|the|domestic)$")) {
                    current.append(line);
                } else {
                    out.add(line);
                }
            } else {
                current.append(line);
            }
        }
        if (current.length() > 0) {
            out.add(current.toString().replaceAll("\\s{2,}", " ").trim());
        }
        return out;
    }

    private List<String> extractMunicipalityArActivities(String[] lines) {
        List<String> out = new ArrayList<>();
        int start = indexContaining(lines, "اسم النشاط باللغة العربية");
        if (start < 0) {
            start = indexContaining(lines, "اسم النشاط");
        }
        if (start < 0) {
            return out;
        }
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.contains("إسم المستثمر") || line.contains("اسم المستثمر") || line.contains("العنوان")
                    || line.contains("رقم المستثمر") || line.contains("نوع الوحدة") || line.contains("رقم /")
                    || line.contains("الملاحظات")
                    || isExactRole(line) || isHeading(line)) {
                break;
            }
            if (line.matches("^\\d{4,}$")) {
                continue; // activity code
            }
            if (line.matches(".*\\d{3,}.*") && !arabicTextProcessor.containsArabic(line)) {
                break;
            }
            if (!arabicTextProcessor.containsArabic(line) || line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            // Skip short address/area fragments.
            if (line.length() < 8 || line.chars().filter(ch -> ch == ',' || ch == '،').count() >= 2) {
                break;
            }
            String ar = arabicTextProcessor.normalizeArabic(line);
            if (ar.length() >= 6) {
                out.add(ar);
            }
        }
        return out;
    }

    private List<Map<String, String>> extractMunicipalityMembers(String[] lines) {
        List<Integer> investorIdx = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            if (isInvestorNameHeading(lines[i])) {
                investorIdx.add(i);
            }
        }

        List<Map<String, String>> people = new ArrayList<>();
        for (int n = 0; n < investorIdx.size(); n++) {
            int start = investorIdx.get(n);
            int end = n + 1 < investorIdx.size()
                    ? investorIdx.get(n + 1)
                    : Math.min(start + 25, lines.length);
            for (int k = start + 1; k < end; k++) {
                // Appendix heading is part of the investor block (CS + English name follow it).
                if (lines[k].contains("الشروط") || lines[k].matches("(?i)Terms\\s*&\\s*Conditions")) {
                    end = k;
                    break;
                }
            }
            Map<String, String> person = extractInvestorBlock(lines, start, end);
            if (person.isEmpty()) {
                continue;
            }
            people.add(person);
        }

        // Pair Share/Type/Nationality clusters to investors in document order
        // (main-page columns first, appendix page second).
        List<MemberAttrBundle> bundles = findMemberAttrBundles(lines);
        for (int p = 0; p < people.size(); p++) {
            if (p < bundles.size()) {
                applyAttrBundle(people.get(p), bundles.get(p));
            }
            if (!people.get(p).containsKey("role") || people.get(p).get("role").isBlank()) {
                people.get(p).put("role", "Owner");
            }
        }

        // Deduplicate same person appearing on main page + appendix.
        Map<String, Map<String, String>> byKey = new LinkedHashMap<>();
        for (Map<String, String> person : people) {
            String key = (person.getOrDefault("personNumber", "") + "|"
                    + person.getOrDefault("nameEn", "") + "|"
                    + person.getOrDefault("nameAr", "")).toUpperCase(Locale.ROOT);
            if (key.replace("|", "").isBlank()) {
                continue;
            }
            String cs = person.getOrDefault("personNumber", "").toUpperCase(Locale.ROOT);
            if (!cs.isBlank()) {
                key = cs;
            }
            Map<String, String> existing = byKey.get(key);
            if (existing == null) {
                byKey.put(key, person);
            } else {
                mergePerson(existing, person);
            }
        }
        return new ArrayList<>(byKey.values());
    }

    private boolean isInvestorNameHeading(String line) {
        return line.contains("إسم المستثمر") || line.contains("اسم المستثمر");
    }

    private Map<String, String> extractInvestorBlock(String[] lines, int start, int end) {
        String nameAr = "";
        String nameEn = "";
        String investorNo = "";
        for (int j = start + 1; j < end; j++) {
            String line = lines[j].trim();
            if (isInvestorNameHeading(line)) {
                break;
            }
            if (line.contains("الشروط") || line.matches("(?i)Terms\\s*&\\s*Conditions")) {
                break;
            }
            // Keep scanning after appendix heading — CS number + English name usually follow.
            if (line.contains("ملحق أصحاب")) {
                continue;
            }
            if (isHeading(line) && !investorNo.isBlank() && (!nameAr.isBlank() || !nameEn.isBlank())) {
                // Stop only after we already have identity and hit a new form heading.
                if (line.matches("(?i)^(Nationality.*|Type/.*|Share.*|Expiry Date|License No\\.?)$")
                        || line.contains("الحصص") || line.contains("الجنسية") || line.contains("الصفة")) {
                    break;
                }
            }
            Matcher cs = CS_NO.matcher(line);
            if (cs.find()) {
                investorNo = cs.group(1).toUpperCase(Locale.ROOT);
                continue;
            }
            if (line.contains("رقم المستثمر") || line.contains("رقم /") || line.contains("اسم العقار")
                    || line.contains("إسم العقار") || line.startsWith("PROPH") || line.startsWith("PROPE")
                    || line.contains("وثيقة") || line.matches("(?i)This is a certified.*")
                    || line.contains("العنوان") || line.contains("الملاحظات")) {
                continue;
            }
            if (nameAr.isBlank() && arabicTextProcessor.containsArabic(line)
                    && !line.matches(".*[A-Za-z]{3,}.*") && line.length() >= 6
                    && !line.contains("الفجيرة") && !line.contains("بلدية")
                    && !line.contains("حكومة") && !line.contains("تأسيس")) {
                nameAr = arabicTextProcessor.normalizeArabic(line);
                continue;
            }
            if (nameEn.isBlank() && looksLikePersonNameEn(line)) {
                nameEn = line.replaceAll("\\s{2,}", " ").trim();
            }
        }
        // CS sometimes appears a few lines after English/Arabic name past certified footer.
        if (investorNo.isBlank()) {
            for (int j = start + 1; j < Math.min(end + 8, lines.length); j++) {
                Matcher cs = CS_NO.matcher(lines[j]);
                if (cs.find()) {
                    investorNo = cs.group(1).toUpperCase(Locale.ROOT);
                    break;
                }
            }
        }
        if (nameEn.isBlank() && nameAr.isBlank()) {
            return Map.of();
        }
        Map<String, String> person = new LinkedHashMap<>();
        if (!nameEn.isBlank()) {
            person.put("nameEn", nameEn);
        }
        if (!nameAr.isBlank()) {
            person.put("nameAr", nameAr);
        }
        if (!investorNo.isBlank()) {
            person.put("personNumber", investorNo);
        }
        return person;
    }

    private boolean looksLikePersonNameEn(String line) {
        if (line == null || line.isBlank() || line.contains("@") || isHeading(line)) {
            return false;
        }
        if (EN_PERSON.matcher(line).matches() || EN_PERSON_LOOSE.matcher(line).matches()) {
            return !line.matches("(?i).*(municipality|government|emirates|license|activity|share|owner|manager|"
                    + "address|remarks|nationality|egypt|india|pakistan|united|fujairah|renew|page).*");
        }
        return false;
    }

    private static final class MemberAttrBundle {
        final int center;
        final String role;
        final String share;
        final String nationality;
        final String nationalityAr;

        MemberAttrBundle(int center, String role, String share, String nationality, String nationalityAr) {
            this.center = center;
            this.role = role;
            this.share = share;
            this.nationality = nationality;
            this.nationalityAr = nationalityAr;
        }
    }

    /**
     * Build attribute bundles from Share / Type / Nationality heading clusters (not hard-coded values).
     */
    private List<MemberAttrBundle> findMemberAttrBundles(String[] lines) {
        List<Integer> anchors = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (SHARE_HEADING.matcher(line).find() || TYPE_HEADING.matcher(line).find()
                    || NAT_HEADING.matcher(line).find()) {
                // Same-page column block: Share/Type often appear before Nationality (≤ ~18 lines).
                if (!anchors.isEmpty() && i - anchors.get(anchors.size() - 1) <= 18) {
                    continue;
                }
                anchors.add(i);
            }
        }
        List<MemberAttrBundle> bundles = new ArrayList<>();
        for (int a = 0; a < anchors.size(); a++) {
            int from = Math.max(0, anchors.get(a) - 1);
            int defaultTo = Math.min(lines.length, anchors.get(a) + 22);
            int to = a + 1 < anchors.size()
                    ? Math.min(anchors.get(a + 1), defaultTo)
                    : defaultTo;
            // Stop at next page marker / terms so appendix cluster stays separate.
            for (int i = from + 1; i < to; i++) {
                if (lines[i].matches("(?i)صفحة\\s*\\d+|Page\\s*\\d+|Terms\\s*&\\s*Conditions")
                        || lines[i].contains("الشروط و الأحكام")) {
                    // Keep values on the same page as the anchor; allow through first صفحة after values.
                    if (i > anchors.get(a) + 3 && (lines[i].matches("(?i)صفحة\\s*\\d+|Page\\s*\\d+"))) {
                        // include a few lines after Nationality before page break
                        to = Math.min(to, i + 4);
                        break;
                    }
                }
            }
            String role = "";
            String share = "";
            String nationality = "";
            String nationalityAr = "";
            boolean sawShareHeading = false;
            boolean sawTypeHeading = false;
            boolean sawNatHeading = false;
            for (int i = from; i < to; i++) {
                String line = lines[i].trim();
                if (SHARE_HEADING.matcher(line).find()) {
                    sawShareHeading = true;
                }
                if (TYPE_HEADING.matcher(line).find()) {
                    sawTypeHeading = true;
                }
                if (NAT_HEADING.matcher(line).find()) {
                    sawNatHeading = true;
                }
                String r = normalizeRole(line);
                if (!r.isBlank()) {
                    role = r;
                }
                if (SHARE_DEC.matcher(line).matches()) {
                    share = formatShare(line);
                }
                if (line.matches("(?i)^(UAE|Egypt|India|Pakistan|United Arab Emirates)$")) {
                    nationality = line.equalsIgnoreCase("UAE") ? "United Arab Emirates" : capitalize(line);
                }
                // Prefer specific country lines; skip generic "الإمارات" header strip when Egypt/etc. present later.
                if ((line.equals("مصر") || line.equals("الهند") || line.equals("باكستان")
                        || line.contains("الامارات العربية") || line.contains("الإمارات العربية"))
                        && !line.matches(".*[A-Za-z]{3,}.*")) {
                    nationalityAr = arabicTextProcessor.normalizeArabic(line);
                } else if (nationalityAr.isBlank()
                        && (line.equals("الامارات") || line.equals("الإمارات"))
                        && !line.matches(".*[A-Za-z]{3,}.*")) {
                    nationalityAr = arabicTextProcessor.normalizeArabic(line);
                }
            }
            if (!sawShareHeading && !sawTypeHeading && !sawNatHeading) {
                continue;
            }
            if (role.isBlank() && share.isBlank() && nationality.isBlank() && nationalityAr.isBlank()) {
                continue;
            }
            bundles.add(new MemberAttrBundle(anchors.get(a), role, share, nationality, nationalityAr));
        }
        return bundles;
    }

    private String formatShare(String line) {
        String share = line.replace("%", "").trim();
        if (!share.contains(".")) {
            share = share + ".0000";
        }
        return share.endsWith("%") ? share : share + "%";
    }

    private double shareValue(String share) {
        if (share == null || share.isBlank()) {
            return -1;
        }
        try {
            return Double.parseDouble(share.replace("%", "").trim());
        } catch (NumberFormatException ex) {
            return -1;
        }
    }

    private void applyAttrBundle(Map<String, String> person, MemberAttrBundle bundle) {
        if (bundle.role != null && !bundle.role.isBlank()) {
            String existing = person.getOrDefault("role", "");
            if (existing.isBlank()) {
                person.put("role", bundle.role);
            } else {
                String existingLower = existing.toLowerCase(Locale.ROOT);
                String incomingLower = bundle.role.toLowerCase(Locale.ROOT);
                if ((existingLower.contains("owner") && incomingLower.contains("manager"))
                        || (existingLower.contains("manager") && incomingLower.contains("owner"))) {
                    person.put("role", "Owner / Manager");
                } else if (!existingLower.contains(incomingLower)) {
                    person.put("role", existing + " / " + bundle.role);
                }
            }
        }
        if (bundle.share != null && !bundle.share.isBlank()
                && (!person.containsKey("share") || person.get("share").isBlank())) {
            person.put("share", bundle.share);
        }
        if (bundle.nationality != null && !bundle.nationality.isBlank()
                && (!person.containsKey("nationality") || person.get("nationality").isBlank())) {
            person.put("nationality", bundle.nationality);
        }
        if (bundle.nationalityAr != null && !bundle.nationalityAr.isBlank()
                && (!person.containsKey("nationalityAr") || person.get("nationalityAr").isBlank())) {
            person.put("nationalityAr", bundle.nationalityAr);
        }
    }

    private void mergePerson(Map<String, String> target, Map<String, String> extra) {
        for (Map.Entry<String, String> e : extra.entrySet()) {
            if (e.getValue() == null || e.getValue().isBlank()) {
                continue;
            }
            if ("role".equals(e.getKey())) {
                String existing = target.getOrDefault("role", "");
                String incoming = e.getValue();
                String existingLower = existing.toLowerCase(Locale.ROOT);
                String incomingLower = incoming.toLowerCase(Locale.ROOT);
                if (existing.isBlank()) {
                    target.put("role", incoming);
                } else if (existingLower.contains(incomingLower) || incomingLower.contains(existingLower)) {
                    if (incomingLower.length() > existingLower.length()) {
                        target.put("role", incoming);
                    }
                } else if ((existingLower.contains("owner") && incomingLower.contains("manager"))
                        || (existingLower.contains("manager") && incomingLower.contains("owner"))) {
                    target.put("role", "Owner / Manager");
                } else {
                    target.put("role", existing + " / " + incoming);
                }
            } else if ("share".equals(e.getKey())) {
                String existing = target.getOrDefault("share", "");
                if (existing.isBlank() || shareValue(existing) < shareValue(e.getValue())) {
                    target.put("share", e.getValue());
                }
            } else if (!target.containsKey(e.getKey()) || target.get(e.getKey()).isBlank()) {
                target.put(e.getKey(), e.getValue());
            }
        }
    }

    private String normalizeRole(String line) {
        String t = line.trim();
        if (t.equalsIgnoreCase("Manager") || t.equals("مدير") || t.equals("مدیر")) {
            return "Manager";
        }
        if (t.equalsIgnoreCase("Owner") || t.equals("مالك")) {
            return "Owner";
        }
        if (t.matches("(?i)Owner and\\s*Manager") || t.contains("مالك ومدير")) {
            return "Owner / Manager";
        }
        return "";
    }

    private boolean isExactRole(String line) {
        return ROLE_EN.matcher(line.trim()).matches();
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

    private String extractMunicipalityCompanyEn(String[] lines) {
        String company = firstMatchingLine(lines, EN_COMPANY, 0, Math.min(100, lines.length));
        if (!company.isBlank()
                && !isHeading(company)
                && !isDateOrMetaLabel(company)
                && !company.matches("(?i).*\\b(services for|photocopying|employment|mediation)\\b.*")) {
            return company;
        }
        // Short trade names like "RETAJ TYPING" sit immediately before Email on this template.
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].equalsIgnoreCase("Email") || i == 0) {
                continue;
            }
            String prev = lines[i - 1].trim();
            if (looksLikeMunicipalityTradeName(prev)) {
                return prev;
            }
        }
        // Near Legal Form / Sole Establishment: previous English trade-name line(s).
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].matches("(?i).*Limited Liability.*|Sole Establishment|Legal Form")) {
                continue;
            }
            for (int j = Math.max(0, i - 10); j < i; j++) {
                String line = lines[j].trim();
                if (looksLikeMunicipalityTradeName(line)) {
                    return line;
                }
            }
        }
        // Fallback: first plausible ALL-CAPS short trade name (never headings/dates).
        for (String line : lines) {
            if (looksLikeMunicipalityTradeName(line)
                    && line.matches("^[A-Z]{3,}(?:\\s+[A-Z0-9]{2,}){1,4}$")) {
                return line;
            }
        }
        return "";
    }

    private boolean looksLikeMunicipalityTradeName(String line) {
        if (line == null || line.isBlank() || isHeading(line) || isDateOrMetaLabel(line)
                || line.contains("@") || LICENSE_NO_LINE.matcher(line).matches()) {
            return false;
        }
        if (line.matches("(?i).*\\b(mediation|photocopying|employment services|temporary|typing and)\\b.*")) {
            return false;
        }
        if (line.matches("(?i).*(MUNICIPALITY|GOVERNMENT|EMIRATES|LICENSE|ACTIVITY|NATIONALITY|"
                + "COC|ERN|PHONE|EMAIL|ADDRESS|REMARKS|SHARE|TYPE|RENEW|EXPIRY|ISSUE|ESTABLISHMENT|"
                + "PROFESSIONAL|COMMERCIAL|INDUSTRIAL|MANAGER|OWNER|PARTNER|UNITED|FUJAIRAH|DIBBA|"
                + "SOLE|LEGAL\\s*FORM|TRADE\\s*NAME).*")) {
            return false;
        }
        return (line.matches("^[A-Z][A-Za-z0-9 &'./\\-]{4,}$")
                || line.matches("(?i)^[A-Z][A-Za-z0-9 &'./\\-]{3,}(?:\\s+[A-Za-z0-9 &'./\\-]+){0,6}$"))
                && line.split("\\s+").length >= 2;
    }

    private boolean isDateOrMetaLabel(String line) {
        return line.matches("(?i)^(Expiry Date|Issue Date|Est\\.? Date|Date Expiry|Date Issuance|"
                + "Date Receipt|Renew|THE EMIRATES|Page\\s*\\d.*)$");
    }

    private String extractMunicipalityLegalType(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].equalsIgnoreCase("Legal Form") && i + 1 < lines.length) {
                String next = lines[i + 1].trim();
                if (next.matches("(?i).*(Limited Liability|Sole Establishment|Sole Proprietorship|"
                        + "Single Person).*")
                        && !next.matches("(?i).*(SERVICES|CENTER|TRADING|WORKS|DOMESTIC).*")) {
                    return next;
                }
            }
        }
        for (String line : lines) {
            if (line.matches("(?i)^Sole Establishment$|^Sole Proprietorship$|"
                    + "^Single Person(?: Company)?$|^Limited Liability(?: Company)?$"
                    + "|^Limited Liability Company\\b.*")) {
                if (!line.matches("(?i).*(SERVICES|CENTER|TRADING|WORKS|DOMESTIC).*")) {
                    return line.trim();
                }
            }
        }
        return "";
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

    private String firstArabicCompany(String[] lines) {
        for (String line : lines) {
            if (!arabicTextProcessor.containsArabic(line) || line.matches(".*[A-Za-z]{3,}.*")) {
                continue;
            }
            if (line.contains("ذ.م.م") || line.contains("ش.ش.و") || line.contains("مؤسسة")
                    || line.contains("مركز") || line.contains("شركة")) {
                if (line.length() >= 8 && !line.contains("الشكل القانوني") && !line.contains("الإسم التجاري")) {
                    return arabicTextProcessor.normalizeArabic(line);
                }
            }
        }
        return "";
    }

    private String firstMatchingLine(String[] lines, Pattern pattern, int from, int to) {
        for (int i = from; i < Math.min(to, lines.length); i++) {
            if (pattern.matcher(lines[i]).matches() || pattern.matcher(lines[i]).find()) {
                if (lines[i].matches("(?i).*License|.*Municipality|.*Government|.*Activity.*|"
                        + "Sole Establishment|Limited Liability.*|Single Person|Legal Form")) {
                    continue;
                }
                return lines[i].trim();
            }
        }
        return "";
    }

    private String valueNearLabel(String[] lines, String label, int window) {
        int idx = indexContaining(lines, label);
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + window, lines.length); i++) {
            if (lines[i].matches(".*[A-Za-z]{3,}.*") && !isHeading(lines[i])) {
                return lines[i];
            }
        }
        return "";
    }

    private String valueContaining(String[] lines, String regex) {
        Pattern p = Pattern.compile(regex);
        for (String line : lines) {
            if (p.matcher(line).find() && line.length() >= 5) {
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

    private String findLineBeforeLabel(String[] lines, String label, String valueRegex) {
        int idx = indexContaining(lines, label);
        if (idx < 0) {
            return "";
        }
        Pattern p = Pattern.compile(valueRegex);
        for (int i = Math.max(0, idx - 8); i < idx; i++) {
            if (p.matcher(lines[i]).matches()) {
                return lines[i].trim();
            }
        }
        return "";
    }

    private String findArabicBeforeOrAfter(String[] lines, String label, String... stops) {
        int idx = indexContaining(lines, label);
        if (idx < 0) {
            return "";
        }
        for (int i = Math.max(0, idx - 6); i < Math.min(lines.length, idx + 6); i++) {
            if (i == idx) {
                continue;
            }
            String line = lines[i].trim();
            boolean stop = false;
            for (String s : stops) {
                if (line.contains(s)) {
                    stop = true;
                    break;
                }
            }
            if (stop) {
                if (i > idx) {
                    break;
                }
                continue;
            }
            if (arabicTextProcessor.containsArabic(line) && !line.matches(".*[A-Za-z]{3,}.*")
                    && line.length() >= 4
                    && !line.equals(label)) {
                return arabicTextProcessor.normalizeArabic(line);
            }
        }
        return "";
    }

    private String valueAfterArabicContains(String[] lines, String label, String... stops) {
        int idx = indexContaining(lines, label);
        if (idx < 0) {
            return "";
        }
        for (int i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
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
            if (arabicTextProcessor.containsArabic(line)) {
                return arabicTextProcessor.normalizeArabic(line);
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

    private String dateNear(String[] lines, String... labels) {
        for (int i = 0; i < lines.length; i++) {
            boolean hit = false;
            for (String label : labels) {
                if (lines[i].toLowerCase(Locale.ROOT).contains(label.toLowerCase(Locale.ROOT))) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                continue;
            }
            for (int j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++) {
                String d = firstDate(lines[j]);
                if (d.isEmpty()) {
                    // also ISO dates yyyy-MM-dd
                    Matcher iso = Pattern.compile("(\\d{4}-\\d{2}-\\d{2})").matcher(lines[j]);
                    if (iso.find()) {
                        return normalizeIso(iso.group(1));
                    }
                    continue;
                }
                return normalizeDate(d);
            }
        }
        return "";
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
                || line.contains("الشكل القانوني") || line.contains("تاريخ الانتهاء")
                || line.contains("تاريخ الإنتهاء");
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

    private String firstGroup(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text);
        return m.find() ? m.group(1) : "";
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
