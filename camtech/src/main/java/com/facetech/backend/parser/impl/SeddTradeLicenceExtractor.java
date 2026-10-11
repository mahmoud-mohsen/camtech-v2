package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.addIfNotEmpty;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildActivitiesJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.buildSimpleJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractCapitalBlockNumbers;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractDateAfterLabel;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.extractEmail;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLine;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.findLineFrom;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.isSeddColumnHeader;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.isSeddHeadingOrFooter;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.isSeddSectionHeading;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.linkedMap;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.pickPermitNoAfterHeading;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.setSeddConfidence;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.toPersonJson;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.valueAfterEnglishLabel;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.valueAfterLabel;
import static com.facetech.backend.parser.impl.TradeLicenceParseSupport.valueBeforeLabel;

@Component
@RequiredArgsConstructor
@Slf4j
public class SeddTradeLicenceExtractor {

    private static final Pattern LICENSE_NO_INLINE = Pattern.compile("(?i)license\\s*no\\.?\\s*(\\d{4,8})");
    private static final Pattern REGISTER_NO_INLINE = Pattern.compile("(?i)registration\\s*no\\.?\\s*(\\d{3,8})");
    private static final Pattern STANDALONE_NUMBER = Pattern.compile("^\\d{4,8}$");
    private static final Pattern EMIRATES_ID = Pattern.compile("^784\\d{12}$");
    private static final Pattern SHARE = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*%\\s*$");
    private static final Pattern EN_NAME = Pattern.compile("^[A-Z][A-Z0-9'\\-.\\s]{8,}$");
    private static final Pattern MOBILE = Pattern.compile("(?:^|\\D)(05\\d{8})(?:\\D|$)");
    private static final Pattern POBOX = Pattern.compile("(?i)(?:p\\.?\\s*o\\.?\\s*box|صندوق البريد)\\s*[:\\s]?(\\d{3,10})");

    private final ArabicTextProcessor arabicTextProcessor;

    DocumentFieldsDto extract(String ocrText) {
        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(ocrText);
        if (ocrText == null || ocrText.isBlank()) {
            return result;
        }

        String normalized = ocrText.replace("\r\n", "\n").replace("\r", "\n");
        String mainScope = scopeMainTradingLicense(normalized);
        String registerScope = scopeRegisterCertificate(normalized);
        String[] mainLines = mainScope.split("\n");
        String[] allLines = normalized.split("\n");
        String[] registerLines = registerScope.isBlank() ? new String[0] : registerScope.split("\n");

        String licenseNo = extractLicenseNo(mainScope, mainLines);
        String registerNo = extractRegisterNo(mainScope, mainLines);

        addIfNotEmpty(result, "licenseNo", licenseNo);
        addIfNotEmpty(result, "registerNo", registerNo);
        addIfNotEmpty(result, "companyName", extractEnglishTradeName(mainLines));
        addIfNotEmpty(result, "businessName", extractEnglishTradeName(mainLines));
        addIfNotEmpty(result, "companyNameAr", extractArabicTradeName(mainLines));
        addIfNotEmpty(result, "businessNameAr", extractArabicTradeName(mainLines));
        addIfNotEmpty(result, "legalType", extractLegalType(mainLines));
        addIfNotEmpty(result, "legalTypeAr", extractArabicLegalType(mainLines, registerLines));
        addIfNotEmpty(result, "issueDate", extractDateAfterLabel(mainScope, "issue date", "تاريخ الإصدار"));
        addIfNotEmpty(result, "expiryDate", extractDateAfterLabel(mainScope, "expiry date", "تاريخ الإنتهاء", "تاريخ الانتهاء"));
        addIfNotEmpty(result, "manager", extractManager(mainLines));
        addIfNotEmpty(result, "licenseMembers", toPersonJson(extractMembers(mainLines, allLines)));
        addIfNotEmpty(result, "licenseActivities", buildActivitiesJson(extractActivities(mainLines), extractArabicActivities(mainLines)));
        addIfNotEmpty(result, "address", extractAddress(mainLines));
        addIfNotEmpty(result, "mobileNo", extractMobile(mainScope));
        addIfNotEmpty(result, "email", extractEmail(mainScope));
        addIfNotEmpty(result, "poBox", extractPoBox(mainScope));

        String registerDetails = extractRegisterDetails(registerScope, registerLines, licenseNo, registerNo);
        addIfNotEmpty(result, "registerDetails", registerDetails);
        addIfNotEmpty(result, "capitalDetails", extractCapitalDetails(registerLines));
        addIfNotEmpty(result, "licenseAddress", extractLicenseAddress(registerLines, mainLines));
        addIfNotEmpty(result, "userName", extractPrintingUserName(mainScope));
        addIfNotEmpty(result, "receipt", extractPrintingReceipt(mainScope));

        int filled = (int) result.getFields().keySet().stream()
                .filter(key -> !key.endsWith("_confidence"))
                .count();
        setSeddConfidence(result, filled, isRegisterDetailsConsistent(registerNo, registerDetails));
        log.debug("Sharjah DED trade licence parsed: {} fields extracted, confidence={}", filled, result.getOverallConfidence());
        return result;
    }

    private String scopeMainTradingLicense(String text) {
        String[] lines = text.split("\n");
        int endIdx = findLine(lines, "(?i)trading register certificate|شهادة سجل تجارية|warehouse permit|تصريح مستودع");
        if (endIdx < 0) {
            return text;
        }
        return String.join("\n", java.util.Arrays.copyOfRange(lines, 0, endIdx));
    }

    private String scopeRegisterCertificate(String text) {
        String[] lines = text.split("\n");
        int start = findLine(lines, "(?i)trading register certificate|شهادة سجل تجارية");
        int end = findLineFrom(lines, start + 1, "(?i)warehouse permit|تصريح مستودع|main board permit|تصريح اللوحة");
        if (start < 0) {
            return "";
        }
        if (end < 0) {
            end = lines.length;
        }
        return String.join("\n", java.util.Arrays.copyOfRange(lines, start, end));
    }

    private String scopeWarehousePermit(String text) {
        String[] lines = text.split("\n");
        int start = findLine(lines, "(?i)warehouse permit|تصريح مستودع");
        int end = findLineFrom(lines, start + 1, "(?i)main board permit|تصريح اللوحة الإعلانية الرئيسية|additional sign board");
        if (start < 0) {
            return "";
        }
        if (end < 0) {
            end = Math.min(start + 80, lines.length);
        }
        return String.join("\n", java.util.Arrays.copyOfRange(lines, start, end));
    }

    private String extractLicenseNo(String scope, String[] lines) {
        String[] capitalNumbers = extractCapitalBlockNumbers(lines);
        if (capitalNumbers.length >= 1) {
            return capitalNumbers[0];
        }

        Matcher pair = Pattern.compile("(?m)^(\\d{5,7})\\s*\\r?\\n(\\d{3,8})\\s*\\r?\\n\\1\\s*$").matcher(scope);
        if (pair.find()) {
            return pair.group(1);
        }
        Matcher inline = LICENSE_NO_INLINE.matcher(scope);
        if (inline.find()) {
            return inline.group(1);
        }
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().contains("license no") || lines[i].contains("رقم الرخصة")) {
                Matcher same = STANDALONE_NUMBER.matcher(lines[i].replaceAll("(?i)license\\s*no\\.?", "").trim());
                if (same.find()) {
                    return same.group();
                }
                for (int j = i + 1; j < Math.min(i + 12, lines.length); j++) {
                    String candidate = lines[j].trim();
                    if (STANDALONE_NUMBER.matcher(candidate).matches() && !candidate.startsWith("784")) {
                        return candidate;
                    }
                }
            }
        }
        Matcher fallback = Pattern.compile("(?m)^\\s*(\\d{5,7})\\s*$").matcher(scope);
        while (fallback.find()) {
            String candidate = fallback.group(1);
            if (!candidate.startsWith("784")) {
                return candidate;
            }
        }
        return "";
    }

    private String extractRegisterNo(String scope, String[] lines) {
        String[] capitalNumbers = extractCapitalBlockNumbers(lines);
        if (capitalNumbers.length >= 2) {
            return capitalNumbers[1];
        }

        Matcher pair = Pattern.compile("(?m)^(\\d{5,7})\\s*\\r?\\n(\\d{3,8})\\s*\\r?\\n\\1\\s*$").matcher(scope);
        if (pair.find()) {
            return pair.group(2);
        }
        Matcher inline = REGISTER_NO_INLINE.matcher(scope);
        if (inline.find()) {
            return inline.group(1);
        }
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().contains("registration no") || lines[i].contains("رقم السجل")) {
                for (int j = i; j < Math.min(i + 8, lines.length); j++) {
                    String candidate = lines[j].trim();
                    if (candidate.matches("\\d{3,8}") && !candidate.startsWith("784")) {
                        return candidate;
                    }
                }
            }
        }
        return "";
    }

    private String extractEnglishTradeName(String[] lines) {
        String value = valueAfterEnglishLabel(lines, "trade name");
        if (value.matches("(?i)trade name.*")) {
            return "";
        }
        return value.replaceAll("(?i)trade name", "").trim();
    }

    private String extractArabicTradeName(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("الاسم التجاري")) {
                continue;
            }
            String sameLine = arabicTextProcessor.extractArabicText(
                    lines[i].replace("الاسم التجاري", "").trim());
            if (sameLine.length() >= 4) {
                return arabicTextProcessor.normalizeArabic(sameLine);
            }
            for (int j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                if (isSeddHeadingOrFooter(lines[j])) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(lines[j])) {
                    return arabicTextProcessor.normalizeArabic(lines[j].trim());
                }
            }
        }
        return "";
    }

    private String extractLegalType(String[] lines) {
        return valueAfterEnglishLabel(lines, "legal status", "legal type")
                .replaceAll("(?i)legal status", "")
                .trim();
    }

    private String extractArabicLegalType(String[] mainLines, String[] registerLines) {
        String fromRegister = extractArabicLegalTypeFromLines(registerLines);
        if (!fromRegister.isBlank()) {
            return fromRegister;
        }
        return extractArabicLegalTypeFromLines(mainLines);
    }

    private String extractArabicLegalTypeFromLines(String[] lines) {
        for (String line : lines) {
            if (!line.contains("الشكل القانوني")) {
                continue;
            }
            String before = valueBeforeLabel(line, "الشكل القانوني");
            String arabicBefore = arabicTextProcessor.extractArabicText(before);
            if (arabicBefore.length() >= 4 && !isSeddSectionHeading(arabicBefore)) {
                return arabicTextProcessor.normalizeArabic(arabicBefore);
            }
            String after = line.replace("الشكل القانوني", "").trim();
            String arabicAfter = arabicTextProcessor.extractArabicText(after);
            if (arabicAfter.length() >= 4 && !isSeddSectionHeading(arabicAfter)) {
                return arabicTextProcessor.normalizeArabic(arabicAfter);
            }
        }
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("الشكل القانوني")) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                String next = lines[j].trim();
                if (isSeddHeadingOrFooter(next) || isSeddSectionHeading(next)) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(next)) {
                    return arabicTextProcessor.normalizeArabic(arabicTextProcessor.extractArabicText(next));
                }
            }
        }
        return "";
    }

    private List<Map<String, String>> extractMembers(String[] mainLines, String[] allLines) {
        Map<String, Map<String, String>> idMetadata = buildIdMetadata(mainLines);
        Map<String, String> beneficiaryIdByNameEn = buildBeneficiaryIdByNameEn(allLines);
        Map<String, String> beneficiaryNationalityById = buildBeneficiaryNationalityById(allLines);
        List<String> orderedMemberIds = listOrderedMemberIds(mainLines);

        LinkedHashMap<String, Map<String, String>> membersByKey = new LinkedHashMap<>();

        List<Map.Entry<String, String>> investorPairs = extractInvestorNamePairs(mainLines);
        List<String> investorNos = extractInvestorNumbers(mainLines);
        for (int i = 0; i < investorPairs.size(); i++) {
            String nameEn = investorPairs.get(i).getKey();
            String nameAr = investorPairs.get(i).getValue();
            Map<String, String> member = membersByKey.computeIfAbsent(nameKey(nameEn), key -> new LinkedHashMap<>());
            member.put("nameEn", nameEn);
            if (!nameAr.isBlank()) {
                member.put("nameAr", nameAr);
            }
            if (i < investorNos.size()) {
                member.putIfAbsent("srNo", investorNos.get(i));
            }
            mergeMemberFromOrderedId(member, orderedMemberIds, i, idMetadata, beneficiaryNationalityById);
        }

        mergeLateInvestorNamePairs(mainLines, membersByKey, investorPairs.size(), investorNos, orderedMemberIds,
                idMetadata, beneficiaryNationalityById);
        mergeBeneficiaryArabicNames(allLines, membersByKey);
        mergeAdhocArabicEnglishPairs(mainLines, membersByKey, orderedMemberIds, idMetadata, beneficiaryNationalityById);

        for (Map<String, String> member : membersByKey.values()) {
            String nameEn = member.get("nameEn");
            if (nameEn == null || nameEn.isBlank()) {
                continue;
            }
            String id = findIdForNameEn(nameEn, idMetadata, beneficiaryIdByNameEn);
            if (id != null) {
                mergeMemberMeta(member, idMetadata.get(id));
                applyBeneficiaryNationality(member, id, beneficiaryNationalityById);
            }
            if (member.containsKey("share") && !member.containsKey("role")) {
                member.put("role", "Partner");
            }
        }

        return new ArrayList<>(membersByKey.values());
    }

    private List<String> listOrderedMemberIds(String[] lines) {
        List<String> ids = new ArrayList<>();
        int start = findLine(lines, "(?i)license members|أطراف الرخصة");
        if (start < 0) {
            start = 0;
        }
        int end = findLineFrom(lines, start + 1, "(?i)trading register certificate|شهادة سجل تجارية");
        if (end < 0) {
            end = lines.length;
        }
        for (int i = start; i < end; i++) {
            String line = lines[i].trim();
            if (EMIRATES_ID.matcher(line).matches()) {
                ids.add(line);
            }
        }
        return ids;
    }

    private void mergeMemberFromOrderedId(
            Map<String, String> member,
            List<String> orderedMemberIds,
            int index,
            Map<String, Map<String, String>> idMetadata,
            Map<String, String> beneficiaryNationalityById) {
        if (index < 0 || index >= orderedMemberIds.size()) {
            return;
        }
        String id = orderedMemberIds.get(index);
        mergeMemberMeta(member, idMetadata.get(id));
        applyBeneficiaryNationality(member, id, beneficiaryNationalityById);
    }

    private void applyBeneficiaryNationality(
            Map<String, String> member,
            String id,
            Map<String, String> beneficiaryNationalityById) {
        if (beneficiaryNationalityById.containsKey(id)) {
            member.put("nationality", beneficiaryNationalityById.get(id));
        }
    }

    private Map<String, Map<String, String>> buildIdMetadata(String[] lines) {
        Map<String, Map<String, String>> byId = new LinkedHashMap<>();
        int start = findLine(lines, "(?i)license members|أطراف الرخصة");
        if (start < 0) {
            start = 0;
        }
        int end = findLineFrom(lines, start + 1, "(?i)trading register certificate|شهادة سجل تجارية");
        if (end < 0) {
            end = lines.length;
        }

        for (int i = start; i < end; i++) {
            String line = lines[i].trim();
            if (!EMIRATES_ID.matcher(line).matches()) {
                continue;
            }
            Map<String, String> meta = new LinkedHashMap<>();
            collectMemberFieldsAroundIndex(lines, start, end, i, meta);
            byId.put(line, meta);
        }
        return byId;
    }

    private void collectMemberFieldsAroundIndex(String[] lines, int start, int end, int index, Map<String, String> meta) {
        for (int j = index - 1; j >= Math.max(start, index - 12); j--) {
            applyMemberFieldLine(lines[j].trim(), meta);
        }
        for (int j = index + 1; j < Math.min(end, index + 12); j++) {
            String next = lines[j].trim();
            applyMemberFieldLine(next, meta);
            if (!meta.containsKey("nameEn") && EN_NAME.matcher(next).matches()) {
                meta.put("nameEn", next);
            }
        }
    }

    private void applyMemberFieldLine(String line, Map<String, String> meta) {
        if (line.isEmpty() || isSeddHeadingOrFooter(line) || isSeddColumnHeader(line)) {
            return;
        }
        if (!meta.containsKey("share") && SHARE.matcher(line).matches()) {
            meta.put("share", line.contains("%") ? line : line + "%");
        }
        if (!meta.containsKey("role") && isPartnerRoleHeading(line)) {
            meta.put("role", normalizeRole(line));
        }
        if (!meta.containsKey("nationality") && isNationalityLabelLine(line)
                && arabicTextProcessor.containsArabic(line)) {
            meta.put("nationality", line.trim());
        }
        if (!meta.containsKey("nationality") && TradeLicenceParseSupport.NAT_EN.matcher(line).find()) {
            meta.put("nationality", normalizeNationality(line));
        }
        if (!meta.containsKey("nationality") && isNationalityLabelLine(line)) {
            meta.put("nationality", line.trim());
        }
    }

    private Map<String, String> buildBeneficiaryIdByNameEn(String[] lines) {
        Map<String, String> idByName = new LinkedHashMap<>();
        int start = findLine(lines, "(?i)real beneficiary|سجل المستفيد الحقيقي");
        if (start < 0) {
            return idByName;
        }
        int end = findLineFrom(lines, start + 1, "(?i)user name|printing date|هذه الوثيقة");
        if (end < 0) {
            end = lines.length;
        }

        int englishNameIdx = findLineFrom(lines, start, "(?i)^english name$|الاسم الانجليزي");
        int arabicNameIdx = findLineFrom(lines, start, "(?i)^arabic name$|الاسم العربي");
        if (englishNameIdx < 0 || englishNameIdx >= end) {
            return idByName;
        }

        String pendingId = null;
        for (int i = englishNameIdx + 1; i < (arabicNameIdx > 0 ? arabicNameIdx : end); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isSeddHeadingOrFooter(line)) {
                continue;
            }
            if (EMIRATES_ID.matcher(line).matches()) {
                pendingId = line;
                continue;
            }
            if (pendingId != null && EN_NAME.matcher(line).matches()) {
                idByName.put(pendingId, line);
                pendingId = null;
            }
        }
        return idByName;
    }

    private Map<String, String> buildBeneficiaryNationalityById(String[] lines) {
        Map<String, String> nationalityById = new LinkedHashMap<>();
        int start = findLine(lines, "(?i)real beneficiary|سجل المستفيد الحقيقي");
        if (start < 0) {
            return nationalityById;
        }
        int end = findLineFrom(lines, start + 1, "(?i)user name|printing date|هذه الوثيقة");
        if (end < 0) {
            end = lines.length;
        }

        int nationalityIdx = findLineFrom(lines, start, "(?i)^nationality$|الجنسية");
        int englishNameIdx = findLineFrom(lines, start, "(?i)^english name$|الاسم الانجليزي");
        if (nationalityIdx < 0 || englishNameIdx < 0) {
            return nationalityById;
        }

        List<String> nationalities = new ArrayList<>();
        for (int i = nationalityIdx + 1; i < englishNameIdx; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isSeddHeadingOrFooter(line)) {
                continue;
            }
            if (isNationalityLabelLine(line) || TradeLicenceParseSupport.NAT_EN.matcher(line).find()) {
                nationalities.add(normalizeNationality(line));
            }
        }

        List<String> ids = new ArrayList<>(buildBeneficiaryIdByNameEn(lines).keySet());
        for (int i = 0; i < ids.size() && i < nationalities.size(); i++) {
            nationalityById.put(ids.get(i), nationalities.get(i));
        }
        return nationalityById;
    }

    private void mergeMemberMeta(Map<String, String> member, Map<String, String> meta) {
        if (meta == null || meta.isEmpty()) {
            return;
        }
        for (Map.Entry<String, String> entry : meta.entrySet()) {
            String value = entry.getValue();
            if (value == null || value.isBlank()) {
                continue;
            }
            String key = entry.getKey();
            if (!member.containsKey(key) || member.get(key).isBlank()) {
                member.put(key, value);
            }
        }
    }

    private String findIdForNameEn(
            String nameEn,
            Map<String, Map<String, String>> idMetadata,
            Map<String, String> beneficiaryIdByNameEn) {
        for (Map.Entry<String, String> entry : beneficiaryIdByNameEn.entrySet()) {
            if (namesMatch(entry.getValue(), nameEn)) {
                return entry.getKey();
            }
        }
        for (Map.Entry<String, Map<String, String>> entry : idMetadata.entrySet()) {
            String metaName = entry.getValue().get("nameEn");
            if (metaName != null && namesMatch(metaName, nameEn)) {
                return entry.getKey();
            }
        }
        return null;
    }

    private boolean namesMatch(String left, String right) {
        String a = nameKey(left);
        String b = nameKey(right);
        if (a.equals(b) || a.contains(b) || b.contains(a)) {
            return true;
        }
        String[] aParts = a.split(" ");
        String[] bParts = b.split(" ");
        if (aParts.length == 0 || bParts.length == 0) {
            return false;
        }
        return aParts[0].equals(bParts[0]) && aParts[aParts.length - 1].equals(bParts[bParts.length - 1]);
    }

    private void mergeLateInvestorNamePairs(
            String[] lines,
            Map<String, Map<String, String>> membersByKey,
            int pairedInvestorCount,
            List<String> investorNos,
            List<String> orderedMemberIds,
            Map<String, Map<String, String>> idMetadata,
            Map<String, String> beneficiaryNationalityById) {
        int investorNoIdx = findInvestorNoHeadingIndex(lines);
        if (investorNoIdx < 0) {
            return;
        }
        int numbersBlockEnd = findInvestorNumbersBlockEnd(lines, investorNoIdx);
        int end = findLineFrom(lines, numbersBlockEnd, "(?i)user name|printing date|هذه الوثيقة|أنشطة الرخصة|license activit");
        if (end < 0) {
            end = Math.min(numbersBlockEnd + 20, lines.length);
        }

        List<String> allArabicBeforeNo = new ArrayList<>();
        int investorNameIdx = findLine(lines, "(?i)^investor name$|(?i)investor name\\b|اسم المستثمر");
        if (investorNameIdx >= 0) {
            for (int i = investorNameIdx + 1; i < investorNoIdx; i++) {
                String line = lines[i].trim();
                if (isPersonArabicLine(line)) {
                    allArabicBeforeNo.add(arabicTextProcessor.normalizeArabic(line));
                }
            }
        }
        List<String> orphanArabic = allArabicBeforeNo.size() > pairedInvestorCount
                ? new ArrayList<>(allArabicBeforeNo.subList(pairedInvestorCount, allArabicBeforeNo.size()))
                : new ArrayList<>();

        List<String> lateEnglish = new ArrayList<>();
        for (int i = numbersBlockEnd; i < end; i++) {
            String line = lines[i].trim();
            if (EN_NAME.matcher(line).matches() && !isSeddHeadingOrFooter(line)) {
                lateEnglish.add(line);
            }
        }

        for (int i = 0; i < lateEnglish.size(); i++) {
            String nameEn = lateEnglish.get(i);
            Map<String, String> member = membersByKey.computeIfAbsent(nameKey(nameEn), key -> new LinkedHashMap<>());
            member.put("nameEn", nameEn);
            if (i < orphanArabic.size()) {
                member.putIfAbsent("nameAr", orphanArabic.get(i));
            }
            int srIdx = pairedInvestorCount + i;
            if (srIdx < orderedMemberIds.size()) {
                String emiratesId = orderedMemberIds.get(srIdx);
                mergeMemberFromOrderedId(member, orderedMemberIds, srIdx, idMetadata, beneficiaryNationalityById);
                String lateSrNo = findInvestorSrNoAfterEmiratesId(lines, numbersBlockEnd, end, emiratesId);
                if (!lateSrNo.isBlank()) {
                    member.putIfAbsent("srNo", lateSrNo);
                }
            }
        }
    }

    private void mergeBeneficiaryArabicNames(String[] lines, Map<String, Map<String, String>> membersByKey) {
        int start = findLine(lines, "(?i)real beneficiary|سجل المستفيد الحقيقي");
        if (start < 0) {
            return;
        }
        int end = findLineFrom(lines, start + 1, "(?i)user name|printing date|هذه الوثيقة");
        if (end < 0) {
            end = lines.length;
        }

        int englishNameIdx = findLineFrom(lines, start, "(?i)^english name$|الاسم الانجليزي");
        int arabicNameIdx = findLineFrom(lines, start, "(?i)^arabic name$|الاسم العربي");
        if (englishNameIdx < 0 || arabicNameIdx < 0) {
            return;
        }

        List<String> namesEn = new ArrayList<>();
        for (int i = englishNameIdx + 1; i < arabicNameIdx; i++) {
            String line = lines[i].trim();
            if (EN_NAME.matcher(line).matches()) {
                namesEn.add(line);
            }
        }

        List<String> namesAr = new ArrayList<>();
        for (int i = arabicNameIdx + 1; i < end; i++) {
            String line = lines[i].trim();
            if (isPersonArabicLine(line)) {
                namesAr.add(arabicTextProcessor.normalizeArabic(line));
            }
        }

        for (int i = 0; i < namesEn.size(); i++) {
            Map<String, String> member = membersByKey.computeIfAbsent(nameKey(namesEn.get(i)), key -> new LinkedHashMap<>());
            member.putIfAbsent("nameEn", namesEn.get(i));
            if (i < namesAr.size()) {
                member.putIfAbsent("nameAr", namesAr.get(i));
            }
        }
    }

    private String extractManager(String[] lines) {
        for (int i = 0; i < lines.length; i++) {
            if (!isManagerHeading(lines[i].trim())) {
                continue;
            }
            for (int j = i - 1; j >= Math.max(0, i - 4); j--) {
                String prev = lines[j].trim();
                if (prev.isEmpty() || isSeddHeadingOrFooter(prev) || prev.matches("\\d{4,7}")) {
                    continue;
                }
                if (arabicTextProcessor.containsArabic(prev)) {
                    return buildSimpleJson(linkedMap(
                            "role", "Manager",
                            "roleAr", "المدير",
                            "nameAr", arabicTextProcessor.normalizeArabic(prev)
                    ));
                }
            }
        }
        return "";
    }

    private List<Map.Entry<String, String>> extractInvestorNamePairs(String[] lines) {
        int start = findLine(lines, "(?i)^investor name$|(?i)investor name\\b|اسم المستثمر");
        int end = findLineFrom(lines, start + 1, "(?i)^investor no$|(?i)investor no\\b|رقم المستثمر");
        if (start < 0 || end < 0) {
            return List.of();
        }

        List<Map.Entry<String, String>> pairs = new ArrayList<>();
        String pendingArabic = null;
        for (int i = start + 1; i < end; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isSeddHeadingOrFooter(line) || isSeddColumnHeader(line)) {
                continue;
            }
            if (EN_NAME.matcher(line).matches()) {
                pairs.add(new AbstractMap.SimpleEntry<>(line, pendingArabic != null ? pendingArabic : ""));
                pendingArabic = null;
                continue;
            }
            if (isPersonArabicLine(line)) {
                pendingArabic = arabicTextProcessor.normalizeArabic(line);
            }
        }
        return pairs;
    }

    private List<String> extractInvestorNumbers(String[] lines) {
        int start = findInvestorNoHeadingIndex(lines);
        if (start < 0) {
            return List.of();
        }

        List<String> numbers = new ArrayList<>();
        for (int i = start + 1; i < Math.min(start + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (line.matches("\\d{4,7}")) {
                numbers.add(line);
                continue;
            }
            if (!numbers.isEmpty()) {
                break;
            }
        }
        return numbers;
    }

    private int findInvestorNoHeadingIndex(String[] lines) {
        int investorNameIdx = findLine(lines, "(?i)^investor name$|(?i)investor name\\b|اسم المستثمر");
        if (investorNameIdx >= 0) {
            int afterName = findLineFrom(lines, investorNameIdx + 1, "(?i)^investor no$");
            if (afterName >= 0) {
                return afterName;
            }
        }
        return findLine(lines, "(?i)^investor no$");
    }

    private int findInvestorNumbersBlockEnd(String[] lines, int investorNoIdx) {
        int i = investorNoIdx + 1;
        while (i < lines.length && lines[i].trim().matches("\\d{4,7}")) {
            i++;
        }
        return i;
    }

    private String findInvestorSrNoAfterEmiratesId(String[] lines, int from, int to, String emiratesId) {
        if (emiratesId == null || emiratesId.isBlank()) {
            return "";
        }
        for (int i = from; i < to; i++) {
            if (!emiratesId.equals(lines[i].trim())) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 5, to); j++) {
                String candidate = lines[j].trim();
                if (candidate.matches("\\d{4,7}")) {
                    return candidate;
                }
            }
        }
        return "";
    }

    private void mergeAdhocArabicEnglishPairs(
            String[] lines,
            Map<String, Map<String, String>> membersByKey,
            List<String> orderedMemberIds,
            Map<String, Map<String, String>> idMetadata,
            Map<String, String> beneficiaryNationalityById) {
        int start = findLine(lines, "(?i)license members|أطراف الرخصة");
        if (start < 0) {
            start = 0;
        }
        int end = findLineFrom(lines, start + 1, "(?i)trading register certificate|شهادة سجل تجارية");
        if (end < 0) {
            end = lines.length;
        }

        int adhocCount = 0;
        for (int i = start; i < end - 1; i++) {
            String line = lines[i].trim();
            String next = lines[i + 1].trim();
            if (!isPersonArabicLine(line) || !EN_NAME.matcher(next).matches()) {
                continue;
            }
            if (membersByKey.containsKey(nameKey(next))) {
                continue;
            }
            Map<String, String> member = membersByKey.computeIfAbsent(nameKey(next), key -> new LinkedHashMap<>());
            member.put("nameEn", next);
            member.put("nameAr", arabicTextProcessor.normalizeArabic(line));
            int idIndex = orderedMemberIds.size() - 1 - adhocCount;
            if (idIndex >= 0) {
                mergeMemberFromOrderedId(member, orderedMemberIds, idIndex, idMetadata, beneficiaryNationalityById);
            }
            adhocCount++;
        }
    }

    private boolean isPersonArabicLine(String line) {
        if (!arabicTextProcessor.containsArabic(line) || line.length() < 8) {
            return false;
        }
        if (isSeddHeadingOrFooter(line) || isSeddColumnHeader(line) || isSeddSectionHeading(line)) {
            return false;
        }
        return !line.contains("الجنسية")
                && !line.contains("المستثمر")
                && !line.contains("حكومة")
                && !line.contains("دائرة");
    }

    private boolean isPartnerRoleHeading(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        return lower.equals("partner") || line.equals("شريك");
    }

    private boolean isManagerHeading(String line) {
        return line.trim().equals("المدير");
    }

    private boolean isNationalityLabelLine(String line) {
        if (line.isEmpty() || isSeddHeadingOrFooter(line) || isPersonArabicLine(line)) {
            return false;
        }
        if (TradeLicenceParseSupport.NAT_EN.matcher(line).find()) {
            return true;
        }
        return arabicTextProcessor.containsArabic(line)
                && line.length() <= 16
                && !line.contains("الجنسية");
    }

    private String normalizeRole(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        if (lower.equals("manager") || line.equals("المدير")) {
            return "Manager";
        }
        if (lower.equals("partner") || line.equals("شريك")) {
            return "Partner";
        }
        return line.trim();
    }

    private String normalizeNationality(String line) {
        Matcher matcher = TradeLicenceParseSupport.NAT_EN.matcher(line);
        if (!matcher.find()) {
            return line.trim();
        }
        return matcher.group().trim();
    }

    private String nameKey(String nameEn) {
        return nameEn.trim().toUpperCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private List<String> extractActivities(String[] lines) {
        int start = findLine(lines, "(?i)أنشطة الرخصة|license activit");
        if (start < 0) {
            return List.of();
        }
        for (int i = start + 1; i < Math.min(start + 8, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isSeddHeadingOrFooter(line)) {
                continue;
            }
            if (line.toLowerCase(Locale.ROOT).contains("address") || line.contains("العنوان")) {
                break;
            }
            if (line.matches(".*[A-Za-z].*") && !arabicTextProcessor.containsArabic(line)) {
                return List.of(line);
            }
        }
        return List.of();
    }

    private List<String> extractArabicActivities(String[] lines) {
        int start = findLine(lines, "أنشطة الرخصة");
        if (start < 0) {
            return List.of();
        }
        for (int i = start; i < Math.min(start + 4, lines.length); i++) {
            String line = lines[i].trim();
            if (isSeddHeadingOrFooter(line)) {
                continue;
            }
            String arabic = arabicTextProcessor.extractArabicText(line);
            if (arabic.length() >= 4 && !arabic.contains("الرخصة") && !arabic.contains("أنشطة")) {
                return List.of(arabicTextProcessor.normalizeArabic(arabic));
            }
            if (arabicTextProcessor.containsArabic(line) && !line.contains("أنشطة")) {
                return List.of(arabicTextProcessor.normalizeArabic(line.trim()));
            }
        }
        return List.of();
    }

    private String extractAddress(String[] lines) {
        int start = findLine(lines, "(?i)^address$|العنوان");
        if (start < 0) {
            return "";
        }
        for (int i = start + 1; i < Math.min(start + 6, lines.length); i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || isSeddHeadingOrFooter(line)) {
                continue;
            }
            if (line.toLowerCase(Locale.ROOT).contains("mobile") || line.contains("هاتف")) {
                continue;
            }
            if (line.contains("الشارقة") || line.contains("Sharjah") || line.contains("مكتب")) {
                return line;
            }
        }
        return valueAfterLabel(lines, "address", "العنوان");
    }

    private String extractMobile(String text) {
        Matcher matcher = MOBILE.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return "";
    }

    private String extractPoBox(String text) {
        Matcher matcher = POBOX.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        Matcher sharjahBox = Pattern.compile("(?i)الشارقة\\s*(\\d{3,6})").matcher(text);
        if (sharjahBox.find()) {
            return sharjahBox.group(1);
        }
        return "";
    }

    private String extractRegisterDetails(String scope, String[] lines, String licenseNo, String registerNo) {
        if (scope.isBlank()) {
            return "";
        }
        String scopedLicenseNo = !licenseNo.isBlank() ? licenseNo : extractLicenseNo(scope, lines);
        String scopedRegisterNo = !registerNo.isBlank() ? registerNo : extractRegisterNo(scope, lines);
        return buildSimpleJson(linkedMap(
                "registerNo", scopedRegisterNo,
                "licenseNo", scopedLicenseNo,
                "businessNameEn", extractEnglishTradeName(lines),
                "businessNameAr", extractArabicTradeName(lines),
                "legalTypeEn", extractLegalType(lines),
                "legalTypeAr", extractArabicLegalTypeFromLines(lines),
                "issueDate", extractDateAfterLabel(scope, "issue date", "تاريخ الإصدار"),
                "expiryDate", extractDateAfterLabel(scope, "expiry date", "تاريخ الإنتهاء")
        ));
    }

    private String extractCapitalDetails(String[] lines) {
        if (lines.length == 0) {
            return "";
        }
        String[] numbers = extractCapitalBlockNumbers(lines);
        if (numbers.length >= 3) {
            return buildSimpleJson(linkedMap("nominated", numbers[2], "currencyEn", "AED"));
        }
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase(Locale.ROOT).contains("capital") || lines[i].contains("رأس المال")) {
                long max = 0;
                for (int j = i + 1; j < Math.min(i + 8, lines.length); j++) {
                    String line = lines[j].trim();
                    if (line.matches("\\d{5,12}")) {
                        max = Math.max(max, Long.parseLong(line));
                    }
                }
                if (max > 0) {
                    return buildSimpleJson(linkedMap("nominated", String.valueOf(max), "currencyEn", "AED"));
                }
            }
        }
        return "";
    }

    private String extractLicenseAddress(String[] registerLines, String[] mainLines) {
        String registerAddress = extractAddress(registerLines);
        if (!registerAddress.isBlank()) {
            return registerAddress;
        }
        return extractAddress(mainLines);
    }

    private String extractWarehouseAddress(String scope) {
        if (scope.isBlank()) {
            return "";
        }
        String[] lines = scope.split("\n");
        String permitNo = pickPermitNoAfterHeading(lines);
        if (permitNo.isBlank()) {
            permitNo = valueAfterLabel(lines, "permit no", "رقم التصريح")
                    .replaceAll("(?i)permit no\\.?", "")
                    .trim();
            if (!TradeLicenceParseSupport.firstDate(permitNo).isEmpty()) {
                permitNo = "";
            }
        }

        String address = "";
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].contains("العنوان") && !lines[i].equalsIgnoreCase("address")) {
                continue;
            }
            for (int j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                String line = lines[j].trim();
                if (line.isEmpty() || isSeddHeadingOrFooter(line)) {
                    continue;
                }
                if (line.contains("مستودع") || line.contains("الصجعة") || line.contains("Warehouse") || line.contains("الشارقة")) {
                    address = line;
                    break;
                }
            }
        }
        if (!permitNo.isEmpty() && !address.isEmpty()) {
            return "Permit " + permitNo + " - " + address;
        }
        return !address.isEmpty() ? address : permitNo;
    }

    private String extractPrintingUserName(String scope) {
        String[] lines = scope.split("\n");
        String userName = valueAfterLabel(lines, "user name", "رقم المستخدم");
        return userName.replaceAll("(?i)user name", "").trim();
    }

    private String extractPrintingReceipt(String scope) {
        String printDate = extractDateAfterLabel(scope, "printing date", "تاريخ الطباعة");
        return buildSimpleJson(linkedMap("receiptDate", printDate));
    }

    private boolean isRegisterDetailsConsistent(String registerNo, String registerDetailsJson) {
        if (registerNo == null || registerNo.isBlank() || registerDetailsJson == null || registerDetailsJson.isBlank()) {
            return true;
        }
        return registerDetailsJson.contains("\"registerNo\":\"" + registerNo + "\"");
    }
}
