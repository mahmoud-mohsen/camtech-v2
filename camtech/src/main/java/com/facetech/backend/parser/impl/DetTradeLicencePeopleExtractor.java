package com.facetech.backend.parser.impl;

import com.facetech.backend.parser.util.ArabicTextProcessor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Extracts license members and partners from Dubai DET trade licences
 * after Google Document AI OCR, which reads table columns top-to-bottom.
 *
 * Only fixed document headings and structural line patterns are used —
 * no person names or nationality values are hardcoded.
 */
final class DetTradeLicencePeopleExtractor {

    private static final Pattern SRNO_LINE = Pattern.compile("^(\\d{5,10})$");
    private static final Pattern SHARE_LINE = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*%\\s*$");
    /** Fixed role column labels on DET licences. */
    private static final Pattern ROLE_LINE = Pattern.compile("(?i)^(manager|director|partner|owner|shares\\s+owner|مدير|شريك|مالك)\\s*/");
    private static final Pattern SHARE_ROLE_LINE = Pattern.compile(
            "^(\\d+(?:\\.\\d+)?)\\s*%\\s*(.+)$");
    private static final Pattern HEADER_SKIP = Pattern.compile(
            "(?i).*(share\\s*/|role\\s*/|nationality\\s*/|name\\s*/|sr\\.?\\s*no|رقم\\s*الشخص|مسلسل\\s*الشخص|license\\s*details|تفاصيل\\s*الرخصة|d&b|الرقم\\s*العالمي|رقم\\s*الرخصة).*");
    private static final Pattern ENGLISH_NAME = Pattern.compile("^[A-Z][A-Z0-9\\s'\\-\\.]{8,}$");
    private static final Pattern NAT_EN = Pattern.compile(
            "(?i)\\b(united arab emirates|uae|pakistan|saudi arabia|egypt|jordan|india|oman|kuwait|bahrain|qatar|lebanon)\\b");
    private static final Pattern PARTNER_SRNO_NAME_SHARE = Pattern.compile(
            "^(\\d{5,10})\\s+(.+)\\s+(\\d+(?:\\.\\d+)?)\\s*%\\s*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern PARTNER_SRNO_NAT_NAME = Pattern.compile(
            "^(\\d{5,10})\\s+((?i)united arab emirates|uae|pakistan|saudi arabia|egypt|jordan|india|oman|kuwait|bahrain|qatar|lebanon)(.+)$");
    private static final Pattern PARTNER_SRNO_AR_SHARE = Pattern.compile(
            "^(\\d{5,10})\\s+(.+?)(\\d+(?:\\.\\d+)?)\\s*%\\s*$");
    private static final Pattern PARTNER_END = Pattern.compile(
            "(?i)(receipt\\s*no|print\\s*date|تاريخ\\s*الطباعة|يمكنك|now you can renew|get free access|zoho|verify the certificate|وثيقة إلكترونية)");
    /** Fixed section headings — not person data. */
    private static final Pattern PARTNERS_HEADING = Pattern.compile(
            "(?i)license\\s*partners|اصحاب\\s*الرخص[ةه]|أصحاب\\s*الرخص[ةه]|ملحق\\s*الشركاء");

    private final ArabicTextProcessor arabicTextProcessor;

    DetTradeLicencePeopleExtractor(ArabicTextProcessor arabicTextProcessor) {
        this.arabicTextProcessor = arabicTextProcessor;
    }

    List<Map<String, String>> extractMembers(String[] lines) {
        int start = findLine(lines, "(?i)license\\s*members|الاطراف|الأطراف|الطراف");
        if (start < 0) {
            return List.of();
        }

        int end = findLineFrom(lines, start + 1, "(?i)print\\s*date|receipt\\s*no|أنشطة\\s*الرخصة|status\\s*/\\s*activity");
        if (end < 0) {
            end = lines.length;
        }

        List<Map<String, String>> columnar = extractMembersColumnar(lines, start, end);
        if (!columnar.isEmpty()) {
            attachMemberRoleShareMetadata(lines, start, columnar);
            return columnar;
        }

        List<Map<String, String>> members = new ArrayList<>();
        Map<String, String> pending = null;

        for (int i = start + 1; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isHeaderLine(t) || isMemberColumnHeader(t)) {
                continue;
            }

            if (ROLE_LINE.matcher(t).find() || isBilingualRoleLine(t) || isShareRoleLine(t)) {
                if (pending != null && pending.containsKey("srNo")) {
                    members.add(pending);
                }
                pending = new LinkedHashMap<>();
                applyRoleShareLine(pending, t);
                continue;
            }

            if (isNationalitySlashLine(t) || isLooseNationalityLine(t)) {
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                applyNationality(pending, t);
                continue;
            }

            Matcher srNo = SRNO_LINE.matcher(t);
            if (srNo.matches()) {
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                pending.put("srNo", srNo.group(1));
                continue;
            }

            if (isArabicNameLine(t)) {
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                pending.put("nameAr", arabicTextProcessor.normalizeArabic(t));
                continue;
            }

            if (isEnglishNameLine(t)) {
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                pending.put("nameEn", t);
                if (pending.containsKey("srNo")) {
                    members.add(pending);
                    pending = null;
                }
            } else if (isEnglishNameContinuation(t) && pending != null && pending.containsKey("nameEn")) {
                pending.put("nameEn", pending.get("nameEn") + " " + t);
            }
        }

        if (pending != null && pending.containsKey("srNo")) {
            members.add(pending);
        }

        attachOrphanEnglishNames(lines, end, Math.min(end + 12, lines.length), members);
        if (!members.isEmpty()) {
            attachMemberRoleShareMetadata(lines, start, members);
        }
        return members;
    }

    /**
     * Google OCR reads member tables column-by-column: several names first, then srNos,
     * while share/role/nationality appear in an earlier column block.
     */
    private List<Map<String, String>> extractMembersColumnar(String[] lines, int start, int end) {
        List<String> srNos = new ArrayList<>();
        int srBlockStart = end;
        for (int i = end - 1; i > start; i--) {
            String t = lines[i].trim();
            if (SRNO_LINE.matcher(t).matches()) {
                srNos.add(0, t);
                srBlockStart = i;
            } else if (!srNos.isEmpty()) {
                break;
            }
        }
        if (srNos.size() < 2) {
            return List.of();
        }

        List<String> bodyLines = new ArrayList<>();
        for (int i = start + 1; i < srBlockStart; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isHeaderLine(t) || isMemberColumnHeader(t)) {
                continue;
            }
            bodyLines.add(t);
        }

        List<Map<String, String>> people = parseColumnarMemberNames(bodyLines);
        if (people.isEmpty()) {
            return List.of();
        }

        int pairCount = Math.min(people.size(), srNos.size());
        List<Map<String, String>> members = new ArrayList<>(pairCount);
        for (int i = 0; i < pairCount; i++) {
            Map<String, String> rec = people.get(i);
            rec.put("srNo", srNos.get(i));
            members.add(rec);
        }
        return members;
    }

    private List<Map<String, String>> parseColumnarMemberNames(List<String> bodyLines) {
        List<Map<String, String>> people = new ArrayList<>();
        Map<String, String> current = null;

        for (String raw : bodyLines) {
            String t = raw.trim();
            if (isArabicNameLine(t)) {
                if (current != null && current.containsKey("nameAr") && !current.containsKey("nameEn")) {
                    people.add(current);
                }
                current = new LinkedHashMap<>();
                current.put("nameAr", arabicTextProcessor.normalizeArabic(t));
                continue;
            }
            if (isEnglishNameLine(t)) {
                if (current == null) {
                    current = new LinkedHashMap<>();
                }
                current.put("nameEn", t);
                people.add(current);
                current = null;
                continue;
            }
            if (isEnglishNameContinuation(t) && !people.isEmpty()) {
                Map<String, String> last = people.get(people.size() - 1);
                if (last.containsKey("nameEn") && last.get("nameEn").split("\\s+").length < 3) {
                    last.put("nameEn", last.get("nameEn") + " " + t);
                }
            }
        }
        if (current != null && (current.containsKey("nameAr") || current.containsKey("nameEn"))) {
            people.add(current);
        }
        return people;
    }

    private void attachMemberRoleShareMetadata(String[] lines, int membersStart, List<Map<String, String>> members) {
        if (members.isEmpty()) {
            return;
        }
        int blockStart = findLineFrom(lines, Math.max(0, membersStart - 50), "(?i)share\\s*/\\s*الحصص|role\\s*/\\s*الصفة");
        if (blockStart < 0) {
            return;
        }

        List<Map<String, String>> metaQueue = new ArrayList<>();
        boolean inActivityColumn = false;
        for (int i = blockStart + 1; i < membersStart; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isHeaderLine(t) || isMemberColumnHeader(t)) {
                continue;
            }
            if (t.equalsIgnoreCase("Activity") || t.equals("Status") || t.equals("النشاط") || t.equals("الحالة")) {
                inActivityColumn = true;
                continue;
            }
            if (inActivityColumn) {
                if (t.equalsIgnoreCase("Active") || t.equalsIgnoreCase("Inactive")
                        || t.equals("فعال") || t.equals("غير فعال")) {
                    continue;
                }
                if (!looksLikeActivityColumnValue(t)) {
                    inActivityColumn = false;
                } else {
                    continue;
                }
            }
            if (t.toLowerCase().contains("print date") || t.contains("تاريخ الطباعة")
                    || t.matches("\\d{2}/\\d{2}/\\d{4}.*") || t.matches(".*\\d{1,2}:\\d{2}.*")) {
                continue;
            }

            Map<String, String> roleMeta = parseRoleShareMetadataLine(t);
            if (!roleMeta.isEmpty()) {
                metaQueue.add(roleMeta);
                continue;
            }
            if (isRoleArabicFragment(t)) {
                continue;
            }
            if (isNationalitySlashLine(t) || isLooseNationalityLine(t) || isArabicNationalityOnly(t)) {
                Map<String, String> nat = new LinkedHashMap<>();
                applyNationality(nat, t);
                Map<String, String> target = findNationalityMergeTarget(metaQueue);
                if (target == null) {
                    metaQueue.add(nat);
                } else {
                    target.putAll(nat);
                }
            }
        }

        for (int i = 0; i < members.size(); i++) {
            if (i < metaQueue.size()) {
                metaQueue.get(i).forEach(members.get(i)::putIfAbsent);
            }
        }
    }

    private Map<String, String> parseRoleShareMetadataLine(String line) {
        Map<String, String> meta = new LinkedHashMap<>();
        String t = line.trim();
        Matcher shareRole = SHARE_ROLE_LINE.matcher(t);
        if (shareRole.matches()) {
            meta.put("share", shareRole.group(1) + "%");
            t = shareRole.group(2).trim();
        }
        String role = extractRole(t);
        if (role != null) {
            meta.put("role", role);
        }
        return meta;
    }

    private void applyRoleShareLine(Map<String, String> pending, String line) {
        pending.putAll(parseRoleShareMetadataLine(line));
    }

    private boolean isShareRoleLine(String line) {
        return SHARE_ROLE_LINE.matcher(line.trim()).matches();
    }

    private boolean isMemberColumnHeader(String line) {
        String lo = line.toLowerCase();
        return lo.contains("name /") || lo.contains("الإسم /") || lo.contains("رقم الشخص");
    }

    private boolean isEnglishNameContinuation(String line) {
        String t = line.trim();
        return t.matches("[A-Z][A-Z'.\\-]{2,}") && t.length() <= 12;
    }

    private Map<String, String> findNationalityMergeTarget(List<Map<String, String>> metaQueue) {
        for (Map<String, String> meta : metaQueue) {
            if (meta.containsKey("nationality") && !meta.containsKey("nationalityAr")) {
                return meta;
            }
        }
        for (Map<String, String> meta : metaQueue) {
            if (!meta.containsKey("nationality") && !meta.containsKey("nationalityAr")) {
                return meta;
            }
        }
        return null;
    }

    private boolean isRoleArabicFragment(String line) {
        String ar = arabicTextProcessor.normalizeArabic(extractArabicOnly(line));
        return ar.equals("حصص") || ar.equals("مالك") || ar.equals("مدير") || ar.equals("شريك");
    }

    private boolean isLooseNationalityLine(String line) {
        String t = line.trim();
        if (!t.endsWith("/")) {
            return false;
        }
        String left = t.substring(0, t.length() - 1).trim();
        return isLikelyCountryPhrase(left) || left.matches("(?i)united arab emirates");
    }

    private boolean isArabicNationalityOnly(String line) {
        String ar = extractArabicOnly(line);
        if (ar.isBlank() || containsLatinName(line) || isRoleArabicFragment(line)) {
            return false;
        }
        return ar.split("\\s+").length <= 2 && ar.length() <= 20;
    }

    private boolean looksLikeActivityColumnValue(String line) {
        String lo = line.toLowerCase();
        return lo.contains("brokerage") || lo.contains("estate") || lo.contains("leasing")
                || lo.contains("management") || lo.contains("supervision") || lo.contains("selling");
    }

    List<Map<String, String>> extractPartners(String[] lines) {
        int start = findPartnerSectionStart(lines);
        if (start < 0) {
            return List.of();
        }

        int end = findPartnerSectionEnd(lines, start + 1);
        if (end < 0) {
            end = lines.length;
        }

        List<Map<String, String>> columnar = extractPartnersColumnar(lines, start, end);
        if (!columnar.isEmpty()) {
            return finalizePartners(columnar);
        }

        List<Map<String, String>> compact = extractPartnersCompact(lines, start, end);
        if (!compact.isEmpty()) {
            return finalizePartners(compact);
        }

        List<Map<String, String>> partners = parsePartnersSequential(lines, start, end);
        if (!partners.isEmpty()) {
            return finalizePartners(partners);
        }

        return finalizePartners(scanPartnerRowsInRange(lines, start, end));
    }

    private int findPartnerSectionStart(String[] lines) {
        int start = findLine(lines, "ملحق الشركاء");
        if (start < 0) {
            start = findLine(lines, "(?i)^partners$");
        }
        if (start < 0) {
            start = findLine(lines, "(?i)license\\s*partners|اصحاب\\s*الرخصة|أصحاب\\s*الرخصة");
        }
        if (start < 0) {
            start = findPartnersBlockByShareCluster(lines);
        }
        return start;
    }

    private int findPartnerSectionEnd(String[] lines, int from) {
        return findLineFrom(lines, from, PARTNER_END.pattern());
    }

    /**
     * Google OCR reads partner tables column-by-column: shares and srNos appear
     * before names, while footer text can bleed into the name column.
     */
    private List<Map<String, String>> extractPartnersColumnar(String[] lines, int start, int end) {
        List<String> shares = collectPartnerSharesLookback(lines, start);
        if (shares.isEmpty()) {
            shares = collectPartnerSharesInRange(lines, start, end);
        }
        int[] srBlock = findConsecutiveSrNoBlock(lines, start + 1, end);
        if (srBlock == null) {
            return List.of();
        }
        List<String> srNos = new ArrayList<>();
        for (int i = srBlock[0]; i <= srBlock[1]; i++) {
            srNos.add(lines[i].trim());
        }

        int bodyStart = srBlock[1] + 1;
        List<String> englishNames = new ArrayList<>();
        List<String> arabicNames = new ArrayList<>();
        List<Map<String, String>> nationalityByIndex = new ArrayList<>();
        List<Map<String, String>> nationalityOnlyQueue = new ArrayList<>();

        for (int i = bodyStart; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isPartnerNoise(t)) {
                continue;
            }
            if (isPartnerFooterNoise(t)) {
                break;
            }

            Map<String, String> slash = new LinkedHashMap<>();
            if (t.contains("/")) {
                slash = parsePartnerSlashLine(t);
                if (slash.isEmpty()) {
                    slash = parseSlashPersonLine(t);
                }
            }
            if (!slash.isEmpty()) {
                if (slash.containsKey("nameEn")) {
                    englishNames.add(slash.get("nameEn"));
                    Map<String, String> nat = new LinkedHashMap<>();
                    if (slash.containsKey("nationality")) {
                        nat.put("nationality", slash.get("nationality"));
                    }
                    if (slash.containsKey("nationalityAr")) {
                        nat.put("nationalityAr", slash.get("nationalityAr"));
                    }
                    nationalityByIndex.add(nat);
                } else if (slash.containsKey("nameAr")) {
                    arabicNames.add(slash.get("nameAr"));
                } else if (slash.containsKey("nationality") || slash.containsKey("nationalityAr")) {
                    nationalityOnlyQueue.add(slash);
                }
                continue;
            }

            if (isNationalitySlashLine(t) || isLooseNationalityLine(t)) {
                Map<String, String> nat = new LinkedHashMap<>();
                applyNationality(nat, t);
                nationalityOnlyQueue.add(nat);
                continue;
            }

            if (isEnglishNameLine(t)) {
                englishNames.add(t);
                continue;
            }

            if (isArabicPartnerNameLine(t)) {
                arabicNames.add(arabicTextProcessor.normalizeArabic(t));
            }
        }

        if (englishNames.isEmpty() && arabicNames.isEmpty()) {
            return List.of();
        }

        List<Map<String, String>> partners = new ArrayList<>();
        for (int i = 0; i < srNos.size(); i++) {
            Map<String, String> rec = new LinkedHashMap<>();
            rec.put("srNo", srNos.get(i));
            if (i < shares.size()) {
                rec.put("share", shares.get(i));
            }
            if (i < englishNames.size()) {
                rec.put("nameEn", englishNames.get(i));
            }
            if (i < arabicNames.size()) {
                rec.put("nameAr", arabicNames.get(i));
            }
            if (i < nationalityByIndex.size()) {
                nationalityByIndex.get(i).forEach(rec::putIfAbsent);
            }
            applyQueuedNationality(rec, nationalityOnlyQueue, i, nationalityByIndex.size());
            partners.add(rec);
        }
        return partners;
    }

    private void applyQueuedNationality(
            Map<String, String> rec,
            List<Map<String, String>> nationalityOnlyQueue,
            int partnerIndex,
            int embeddedNationalityCount) {
        int queueIndex = partnerIndex - embeddedNationalityCount;
        if (queueIndex >= 0 && queueIndex < nationalityOnlyQueue.size()) {
            nationalityOnlyQueue.get(queueIndex).forEach(rec::putIfAbsent);
        }
    }

    private List<String> collectPartnerSharesInRange(String[] lines, int start, int end) {
        List<String> shares = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            Matcher share = SHARE_LINE.matcher(lines[i].trim());
            if (share.matches()) {
                shares.add(share.group(1) + "%");
            }
        }
        return shares;
    }

    private int[] findConsecutiveSrNoBlock(String[] lines, int from, int to) {
        int bestStart = -1;
        int bestEnd = -1;
        int currentStart = -1;
        int currentEnd = -1;

        for (int i = from; i < to; i++) {
            String t = lines[i].trim();
            if (SRNO_LINE.matcher(t).matches()
                    && !isReceiptNumberContext(lines, i)
                    && !isLicenseNumberContext(lines, i)) {
                if (currentStart < 0) {
                    currentStart = i;
                }
                currentEnd = i;
            } else if (currentStart >= 0) {
                if (currentEnd - currentStart + 1 >= 2
                        && (currentEnd - currentStart) > (bestEnd - bestStart)) {
                    bestStart = currentStart;
                    bestEnd = currentEnd;
                }
                currentStart = -1;
                currentEnd = -1;
            }
        }

        if (currentStart >= 0 && currentEnd - currentStart + 1 >= 2
                && (bestStart < 0 || (currentEnd - currentStart) > (bestEnd - bestStart))) {
            bestStart = currentStart;
            bestEnd = currentEnd;
        }

        if (bestStart < 0) {
            return null;
        }
        return new int[]{bestStart, bestEnd};
    }

    private List<String> collectPartnerSharesLookback(String[] lines, int partnersStart) {
        List<String> shares = new ArrayList<>();
        int from = Math.max(0, partnersStart - 30);
        for (int i = from; i < partnersStart; i++) {
            Matcher share = SHARE_LINE.matcher(lines[i].trim());
            if (share.matches()) {
                shares.add(share.group(1) + "%");
            }
        }
        return shares;
    }

    /** Compact partner rows from legacy OCR e.g. "525952 United Arab EmiratesALMANA..." */
    private List<Map<String, String>> extractPartnersCompact(String[] lines, int start, int end) {
        List<Map<String, String>> partners = new ArrayList<>();
        for (int i = start + 1; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isPartnerNoise(t) || isPartnerFooterNoise(t)) {
                continue;
            }

            Matcher inlineNat = PARTNER_SRNO_NAT_NAME.matcher(t);
            if (inlineNat.matches()) {
                Map<String, String> rec = new LinkedHashMap<>();
                rec.put("srNo", inlineNat.group(1));
                rec.put("nationality", capitalizeWords(inlineNat.group(2).trim()));
                rec.put("nameEn", inlineNat.group(3).trim().replaceAll("\\s{2,}", " "));
                if (i + 1 < end && isArabicPartnerNameLine(lines[i + 1].trim())) {
                    rec.put("nameAr", arabicTextProcessor.normalizeArabic(lines[i + 1].trim()));
                    i++;
                }
                if (i + 1 < end) {
                    Matcher shareLine = SHARE_LINE.matcher(lines[i + 1].trim());
                    if (shareLine.matches()) {
                        rec.put("share", shareLine.group(1) + "%");
                        i++;
                    }
                }
                partners.add(rec);
                continue;
            }

            Matcher inlineArShare = PARTNER_SRNO_AR_SHARE.matcher(t);
            if (inlineArShare.matches()) {
                Map<String, String> rec = new LinkedHashMap<>();
                rec.put("srNo", inlineArShare.group(1));
                rec.put("nameAr", arabicTextProcessor.normalizeArabic(inlineArShare.group(2).trim()));
                rec.put("share", inlineArShare.group(3) + "%");
                partners.add(rec);
            }
        }
        return partners;
    }

    private List<Map<String, String>> parsePartnersSequential(String[] lines, int start, int end) {
        List<String> shareQueue = new ArrayList<>();
        List<Map<String, String>> nationalityQueue = new ArrayList<>();
        List<Map<String, String>> partnersAwaitingSrNo = new ArrayList<>();
        List<Map<String, String>> partners = new ArrayList<>();
        Map<String, String> pending = null;

        for (int i = start + 1; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isPartnerNoise(t) || isPartnerFooterNoise(t)) {
                continue;
            }

            Matcher full = PARTNER_SRNO_NAME_SHARE.matcher(t);
            if (full.matches()) {
                if (pending != null && hasPartnerData(pending)) {
                    partners.add(pending);
                }
                pending = new LinkedHashMap<>();
                pending.put("srNo", full.group(1));
                pending.put("nameEn", full.group(2).trim());
                pending.put("share", full.group(3) + "%");
                partners.add(pending);
                pending = null;
                continue;
            }

            Matcher share = SHARE_LINE.matcher(t);
            if (share.matches()) {
                String shareVal = share.group(1) + "%";
                if (pending != null && pending.containsKey("nameEn") && !pending.containsKey("share")) {
                    pending.put("share", shareVal);
                    if (!nationalityQueue.isEmpty() && !pending.containsKey("nationality")) {
                        pending.putAll(nationalityQueue.remove(0));
                    }
                    if (pending.containsKey("srNo")) {
                        partners.add(pending);
                        pending = null;
                    }
                } else {
                    shareQueue.add(shareVal);
                }
                continue;
            }

            Matcher srNo = SRNO_LINE.matcher(t);
            if (srNo.matches()) {
                if (isLicenseNumberContext(lines, i) || isReceiptNumberContext(lines, i)) {
                    continue;
                }
                String id = srNo.group(1);
                if (pending != null && pendingHasCompleteIdentity(pending) && !pending.containsKey("srNo")) {
                    if (pending.containsKey("share")) {
                        pending.put("srNo", id);
                        if (!nationalityQueue.isEmpty() && !pending.containsKey("nationality")) {
                            pending.putAll(nationalityQueue.remove(0));
                        }
                        partners.add(pending);
                        pending = null;
                        continue;
                    }
                    partnersAwaitingSrNo.add(pending);
                    pending = null;
                } else if (pending != null && hasPartnerData(pending)) {
                    partners.add(pending);
                    pending = null;
                }
                pending = new LinkedHashMap<>();
                pending.put("srNo", id);
                if (!shareQueue.isEmpty() && !pending.containsKey("share")) {
                    pending.put("share", shareQueue.remove(0));
                }
                if (!nationalityQueue.isEmpty() && !pending.containsKey("nationality")) {
                    pending.putAll(nationalityQueue.remove(0));
                }
                continue;
            }

            if (isNationalitySlashLine(t) || isLooseNationalityLine(t)) {
                Map<String, String> nat = new LinkedHashMap<>();
                applyNationality(nat, t);
                if (pending != null && pendingHasCompleteIdentity(pending) && pending.containsKey("nationality")) {
                    nationalityQueue.add(nat);
                } else {
                    if (pending == null) {
                        pending = new LinkedHashMap<>();
                    }
                    pending.putAll(nat);
                }
                continue;
            }

            if (t.contains("/") && containsLatinName(t)) {
                if (isPartnerHeadingSlashLine(t)) {
                    continue;
                }
                Map<String, String> parsed = parseSlashPersonLine(t);
                if (parsed.isEmpty()) {
                    parsed = parsePartnerSlashLine(t);
                }
                if (parsed.isEmpty()) {
                    continue;
                }
                if (pending != null && hasPartnerData(pending)) {
                    partners.add(pending);
                    pending = null;
                }
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                mergePersonFields(pending, parsed);
                continue;
            }

            if (isArabicPartnerNameLine(t)) {
                String ar = arabicTextProcessor.normalizeArabic(t);
                if (pending == null && !partners.isEmpty()) {
                    Map<String, String> last = partners.get(partners.size() - 1);
                    if (last.containsKey("nameEn")
                            && isIncompleteArabicName(last.get("nameAr"), last.get("nameEn"))) {
                        last.merge("nameAr", ar, (a, b) -> (a + " " + b).trim());
                        continue;
                    }
                }
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                pending.merge("nameAr", ar, (a, b) -> (a + " " + b).trim());
            } else if (isEnglishNameLine(t)) {
                if (pending == null) {
                    pending = new LinkedHashMap<>();
                }
                pending.put("nameEn", t);
                if (pending.containsKey("srNo") && pending.containsKey("share")) {
                    partners.add(pending);
                    pending = null;
                }
            }
        }

        if (pending != null && hasPartnerData(pending)) {
            if (pending.containsKey("srNo")) {
                partners.add(pending);
            } else if (pendingHasCompleteIdentity(pending)) {
                partnersAwaitingSrNo.add(pending);
            }
        }

        prependPartnersWithLookbackSrNos(lines, start, partnersAwaitingSrNo, shareQueue, partners);
        applyPartnerShareLookback(lines, start, partners);
        return partners;
    }

    private void applyPartnerShareLookback(String[] lines, int partnersStart, List<Map<String, String>> partners) {
        List<String> shares = collectPartnerSharesLookback(lines, partnersStart);
        for (int i = 0; i < partners.size() && i < shares.size(); i++) {
            partners.get(i).putIfAbsent("share", shares.get(i));
        }
    }

    private boolean pendingHasCompleteIdentity(Map<String, String> pending) {
        return pending.containsKey("nameEn") || pending.containsKey("nameAr");
    }

    private void prependPartnersWithLookbackSrNos(
            String[] lines,
            int partnersStart,
            List<Map<String, String>> awaitingSrNo,
            List<String> shareQueue,
            List<Map<String, String>> partners) {
        if (awaitingSrNo.isEmpty()) {
            return;
        }
        List<String> lookbackSrNos = collectPartnerSrNosLookback(lines, partnersStart);
        List<Map<String, String>> resolved = new ArrayList<>();
        for (int i = 0; i < awaitingSrNo.size(); i++) {
            Map<String, String> rec = awaitingSrNo.get(i);
            if (i < lookbackSrNos.size()) {
                rec.put("srNo", lookbackSrNos.get(i));
            }
            if (!shareQueue.isEmpty() && !rec.containsKey("share")) {
                rec.put("share", shareQueue.remove(0));
            }
            if (rec.containsKey("srNo")) {
                resolved.add(rec);
            }
        }
        partners.addAll(0, resolved);
    }

    private List<String> collectPartnerSrNosLookback(String[] lines, int partnersStart) {
        List<String> srNos = new ArrayList<>();
        int from = Math.max(0, partnersStart - 20);
        for (int i = from; i < partnersStart; i++) {
            String t = lines[i].trim();
            if (SRNO_LINE.matcher(t).matches()
                    && !isLicenseNumberContext(lines, i)
                    && !isReceiptNumberContext(lines, i)) {
                srNos.add(t);
            }
        }
        return srNos;
    }

    private List<Map<String, String>> finalizePartners(List<Map<String, String>> partners) {
        partners.removeIf(p -> !isValidPartnerRecord(p));
        partners.forEach(this::normalizePartnerRecord);
        return partners;
    }

    private boolean isValidPartnerRecord(Map<String, String> rec) {
        if (!rec.containsKey("srNo")) {
            return false;
        }
        String nameEn = rec.getOrDefault("nameEn", "");
        String nameAr = rec.getOrDefault("nameAr", "");
        if (nameEn.isBlank() && nameAr.length() < 3) {
            return false;
        }
        if (isPartnerFooterNoise(nameEn) || isPartnerFooterNoise(nameAr)) {
            return false;
        }
        if (nameEn.length() > 80 || nameAr.length() > 80) {
            return false;
        }
        return true;
    }

    private Map<String, String> parsePartnerSlashLine(String line) {
        Map<String, String> rec = new LinkedHashMap<>();
        if (isHeadingLabel(line) || isPartnerHeadingSlashLine(line)) {
            return rec;
        }

        Matcher natEn = NAT_EN.matcher(line);
        if (natEn.find()) {
            rec.put("nationality", capitalizeWords(natEn.group(1)));
        }

        String ar = extractArabicOnly(line);
        if (!ar.isBlank() && isNationalityPart(ar)) {
            rec.put("nationalityAr", arabicTextProcessor.normalizeArabic(ar));
        }

        Matcher nameMatcher = Pattern.compile("[A-Z][A-Z0-9\\s'\\-\\.&]{8,}").matcher(line);
        String bestName = null;
        while (nameMatcher.find()) {
            String cand = nameMatcher.group().trim();
            if (NAT_EN.matcher(cand).find() || cand.length() < 10) {
                continue;
            }
            if (bestName == null || cand.length() > bestName.length()) {
                bestName = cand;
            }
        }
        if (bestName != null) {
            rec.put("nameEn", bestName.replaceAll("\\s{2,}", " ").trim());
        }
        return rec;
    }

    private List<Map<String, String>> scanPartnerRowsInRange(String[] lines, int start, int end) {
        List<Map<String, String>> partners = new ArrayList<>();
        Map<String, String> pending = null;

        for (int i = start + 1; i < end; i++) {
            String t = lines[i].trim();
            if (t.isEmpty() || isPartnerNoise(t) || isPartnerFooterNoise(t)) {
                continue;
            }

            Matcher full = PARTNER_SRNO_NAME_SHARE.matcher(t);
            if (full.matches()) {
                Map<String, String> rec = new LinkedHashMap<>();
                rec.put("srNo", full.group(1));
                rec.put("nameEn", full.group(2).trim());
                rec.put("share", full.group(3) + "%");
                partners.add(rec);
                pending = null;
                continue;
            }

            Matcher srNo = SRNO_LINE.matcher(t);
            if (srNo.matches() && !isReceiptNumberContext(lines, i) && !isLicenseNumberContext(lines, i)) {
                if (pending != null && hasPartnerData(pending)) {
                    partners.add(pending);
                }
                pending = new LinkedHashMap<>();
                pending.put("srNo", srNo.group(1));
                continue;
            }

            Matcher share = SHARE_LINE.matcher(t);
            if (share.matches() && pending != null && !pending.containsKey("share")) {
                pending.put("share", share.group(1) + "%");
                if (pending.containsKey("nameEn")) {
                    partners.add(pending);
                    pending = null;
                }
            }
        }

        if (pending != null && hasPartnerData(pending)) {
            partners.add(pending);
        }
        return partners;
    }

    private boolean isArabicPartnerNameLine(String line) {
        return isArabicNameLine(line) && !isPartnerFooterNoise(line);
    }

    private boolean isPartnerFooterNoise(String line) {
        if (line == null || line.isBlank()) {
            return false;
        }
        String lo = line.toLowerCase();
        return lo.contains("trade license")
                || lo.contains("renew your")
                || lo.contains("text message")
                || lo.contains("payment voucher")
                || lo.contains("6969")
                || lo.contains("etisalat")
                || lo.contains("zoho")
                || lo.contains("receipt no")
                || lo.contains("get free access")
                || lo.contains("verify the certificate")
                || lo.contains("now you can")
                || line.contains("يمكنك")
                || line.contains("تاريخ الطباعة")
                || line.contains("للحصول على اذن الدفع")
                || line.contains("احصل على زوهو")
                || line.contains("رقم الإيصال")
                || line.contains("رقم الايصال");
    }

    private boolean isReceiptNumberContext(String[] lines, int index) {
        for (int j = Math.max(0, index - 3); j < index; j++) {
            String prev = lines[j].trim().toLowerCase();
            if (prev.contains("receipt no") || prev.contains("رقم الإيصال") || prev.contains("رقم الايصال")) {
                return true;
            }
        }
        return false;
    }

    /** Skip the numeric value immediately after a "License No." / "الرقم العالمي" label. */
    private boolean isLicenseNumberContext(String[] lines, int index) {
        for (int j = Math.max(0, index - 2); j < index; j++) {
            String prev = lines[j].trim().toLowerCase();
            if (prev.contains("license no") || prev.contains("الرقم العالمي")) {
                return j >= index - 2;
            }
        }
        return false;
    }

    private int findPartnersBlockByShareCluster(String[] lines) {
        for (int i = 0; i < lines.length - 2; i++) {
            int shareCount = 0;
            for (int j = i; j < Math.min(i + 8, lines.length); j++) {
                if (SHARE_LINE.matcher(lines[j].trim()).matches()) {
                    shareCount++;
                }
            }
            if (shareCount >= 2) {
                return i;
            }
        }
        return -1;
    }

    private void normalizePartnerRecord(Map<String, String> rec) {
        if (rec.containsKey("nameEn")) {
            String en = arabicTextProcessor.removeArabicText(rec.get("nameEn")).replaceAll("\\s{2,}", " ").trim();
            rec.put("nameEn", en);
        }
        if (rec.containsKey("nameAr")) {
            rec.put("nameAr", arabicTextProcessor.normalizeArabic(rec.get("nameAr")));
        }
    }

    private void attachOrphanEnglishNames(String[] lines, int from, int to, List<Map<String, String>> members) {
        for (int i = from; i < to; i++) {
            String t = lines[i].trim();
            if (!isEnglishNameLine(t)) {
                continue;
            }
            for (Map<String, String> member : members) {
                if (!member.containsKey("nameEn") || member.get("nameEn").isBlank()) {
                    member.put("nameEn", t);
                    break;
                }
            }
        }
    }

    private Map<String, String> parseSlashPersonLine(String line) {
        Map<String, String> rec = new LinkedHashMap<>();
        if (isHeadingLabel(line) || PARTNERS_HEADING.matcher(line).find()) {
            return rec;
        }
        String[] parts = line.split("\\s*/\\s*");
        StringBuilder nameEn = new StringBuilder();
        StringBuilder nameAr = new StringBuilder();
        int nationalityStart = findNationalityPartsStart(parts);

        for (int i = 0; i < parts.length; i++) {
            String p = parts[i].trim();
            if (p.isEmpty()) {
                continue;
            }

            if (i >= nationalityStart && isNationalityPart(p)) {
                if (isLatinOnly(p)) {
                    rec.putIfAbsent("nationality", capitalizeWords(p));
                } else if (isArabicOnly(p)) {
                    rec.putIfAbsent("nationalityAr", arabicTextProcessor.normalizeArabic(p));
                }
                continue;
            }

            String enPart = arabicTextProcessor.removeArabicText(p).replaceAll("\\s{2,}", " ").trim();
            String arPart = extractArabicOnly(p);

            if (!enPart.isEmpty()) {
                if (isNationalityPart(enPart)) {
                    rec.putIfAbsent("nationality", capitalizeWords(enPart));
                } else if (containsLatinName(enPart)) {
                    nameEn.append(enPart).append(' ');
                }
            }
            if (!arPart.isEmpty()) {
                if (i >= nationalityStart && isNationalityPart(arPart)) {
                    rec.putIfAbsent("nationalityAr", arabicTextProcessor.normalizeArabic(arPart));
                } else {
                    nameAr.append(arPart).append(' ');
                }
            }
        }

        String en = nameEn.toString().trim();
        String ar = nameAr.toString().trim();
        if (!en.isEmpty()) {
            rec.put("nameEn", en);
        }
        if (!ar.isEmpty()) {
            rec.put("nameAr", arabicTextProcessor.normalizeArabic(ar));
        }
        return rec;
    }

    private int findNationalityPartsStart(String[] parts) {
        int start = parts.length;
        for (int i = parts.length - 1; i >= 0; i--) {
            if (isNationalityPart(parts[i].trim())) {
                start = i;
            } else {
                break;
            }
        }
        return start;
    }

    /** Bilingual nationality row: one Latin side + one Arabic side, no person name content. */
    private boolean isNationalitySlashLine(String line) {
        if (!line.contains("/") || isHeadingLabel(line)) {
            return false;
        }
        if (containsPersonNameContent(line)) {
            return false;
        }
        String[] parts = line.split("\\s*/\\s*");
        if (parts.length != 2) {
            return false;
        }
        String left = parts[0].trim();
        String right = parts[1].trim();
        return (isLatinOnly(left) && isArabicOnly(right)) || (isArabicOnly(left) && isLatinOnly(right));
    }

    /** Short Latin or Arabic fragment — nationality label, not a personal name. */
    private boolean isNationalityPart(String part) {
        String p = part.trim();
        if (p.isEmpty() || isHeadingLabel(p)) {
            return false;
        }
        if (looksLikePersonEnglishName(p)) {
            return false;
        }
        if (isLatinOnly(p)) {
            int words = p.split("\\s+").length;
            return words <= 3 && isLikelyCountryPhrase(p);
        }
        if (isArabicOnly(p)) {
            return p.split("\\s+").length <= 2 && p.length() <= 25;
        }
        return false;
    }

    private boolean containsPersonNameContent(String line) {
        if (looksLikePersonEnglishName(line)) {
            return true;
        }
        String ar = extractArabicOnly(line);
        return ar.split("\\s+").length >= 3;
    }

    private boolean looksLikePersonEnglishName(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        String en = arabicTextProcessor.removeArabicText(text).replaceAll("\\s{2,}", " ").trim();
        if (en.isEmpty() || !containsLatinName(en)) {
            return false;
        }
        String[] words = en.split("\\s+");
        if (words.length == 1) {
            return en.length() >= 10 && en.equals(en.toUpperCase());
        }
        if (en.equals(en.toUpperCase()) && en.length() >= 10) {
            return true;
        }
        int longTokens = 0;
        for (String w : words) {
            if (w.matches("[A-Za-z'.-]{3,}")) {
                longTokens++;
            }
        }
        return longTokens >= 2 && !isLikelyCountryPhrase(en);
    }

    /** Title-case short phrase without ALL CAPS — typical country label on DET forms. */
    private boolean isLikelyCountryPhrase(String en) {
        if (en.equals(en.toUpperCase()) || isHeadingLabel(en)) {
            return false;
        }
        String[] words = en.split("\\s+");
        if (words.length == 0 || words.length > 4) {
            return false;
        }
        for (String w : words) {
            if (!w.matches("[A-Za-z'.-]+")) {
                return false;
            }
        }
        return true;
    }

    private String extractArabicOnly(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        Matcher m = Pattern.compile("[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+").matcher(text);
        while (m.find()) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(m.group());
        }
        return sb.toString().trim();
    }

    private void mergePersonFields(Map<String, String> target, Map<String, String> parsed) {
        parsed.forEach(target::putIfAbsent);
    }

    private void applyNationality(Map<String, String> rec, String line) {
        for (String part : line.split("\\s*/\\s*")) {
            String p = part.trim();
            if (p.isEmpty()) {
                continue;
            }
            if (isLatinOnly(p) && !looksLikePersonEnglishName(p)) {
                rec.put("nationality", capitalizeWords(p));
            } else if (isArabicOnly(p)) {
                rec.put("nationalityAr", arabicTextProcessor.normalizeArabic(p));
            }
        }
    }

    private boolean isBilingualRoleLine(String line) {
        return line.contains("/") && (ROLE_LINE.matcher(line).find() || isShareRoleLine(line));
    }

    private String extractRole(String line) {
        if (Pattern.compile("(?i)shares\\s+owner").matcher(line).find() || line.contains("مالك")) {
            return "Owner";
        }
        Matcher m = Pattern.compile("(?i)\\b(manager|director|partner|owner)\\b").matcher(line);
        if (m.find()) {
            return capitalizeWords(m.group(1));
        }
        if (line.contains("مدير")) {
            return "Manager";
        }
        if (line.contains("شريك")) {
            return "Partner";
        }
        return null;
    }

    private boolean isHeaderLine(String line) {
        return HEADER_SKIP.matcher(line).matches();
    }

    private boolean isPartnerHeadingSlashLine(String line) {
        String lo = line.toLowerCase();
        if (lo.matches("(?i)^name\\s*/.*")) {
            return true;
        }
        return PARTNERS_HEADING.matcher(line).find();
    }

    /** Fixed document labels that must never be treated as nationality or person values. */
    private boolean isHeadingLabel(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        String lo = text.toLowerCase();
        if (lo.contains("license") && lo.contains("partner")) {
            return true;
        }
        String ar = arabicTextProcessor.normalizeArabic(text);
        return ar.contains("اصحاب الرخص") || ar.contains("أصحاب الرخص") || ar.contains("ملحق الشرك");
    }

    private boolean isPartnerNoise(String line) {
        if (HEADER_SKIP.matcher(line).matches()) {
            return true;
        }
        String lo = line.toLowerCase();
        return lo.contains("economy and tourism")
                || lo.contains("government of dubai")
                || lo.contains("the emirates")
                || lo.equals("name")
                || lo.equals("partners")
                || lo.equals("no.")
                || lo.contains("license details")
                || lo.contains("license no");
    }

    private boolean isArabicNameLine(String line) {
        return arabicTextProcessor.containsArabic(line)
                && !containsLatinName(line)
                && line.trim().length() >= 3
                && !isHeaderLine(line);
    }

    private boolean isEnglishNameLine(String line) {
        if (line.contains("/") || arabicTextProcessor.containsArabic(line)) {
            return false;
        }
        return ENGLISH_NAME.matcher(line.trim()).matches();
    }

    private boolean isLatinOnly(String text) {
        return containsLatinName(text) && !arabicTextProcessor.containsArabic(text);
    }

    private boolean isArabicOnly(String text) {
        return arabicTextProcessor.containsArabic(text) && !containsLatinName(text);
    }

    private boolean containsLatinName(String line) {
        return line.matches(".*[A-Za-z]{3,}.*");
    }

    private boolean hasPartnerData(Map<String, String> rec) {
        return rec.containsKey("srNo") && (rec.containsKey("nameEn") || rec.containsKey("nameAr"));
    }

    /** Arabic name continuation: significantly fewer tokens than the English name on the same record. */
    private boolean isIncompleteArabicName(String nameAr, String nameEn) {
        if (nameAr == null || nameAr.isBlank()) {
            return true;
        }
        int arWords = nameAr.trim().split("\\s+").length;
        if (nameEn == null || nameEn.isBlank()) {
            return arWords <= 1;
        }
        int enWords = nameEn.trim().split("\\s+").length;
        return arWords < Math.max(1, enWords - 1);
    }

    private int findLine(String[] lines, String pattern) {
        Pattern p = Pattern.compile(pattern);
        for (int i = 0; i < lines.length; i++) {
            if (p.matcher(lines[i]).find()) {
                return i;
            }
        }
        return -1;
    }

    private int findLineFrom(String[] lines, int from, String pattern) {
        Pattern p = Pattern.compile(pattern);
        for (int i = from; i < lines.length; i++) {
            if (p.matcher(lines[i]).find()) {
                return i;
            }
        }
        return -1;
    }

    private String capitalizeWords(String value) {
        if (value == null || value.isBlank()) {
            return value;
        }
        String[] words = value.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String w : words) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            if (!w.isEmpty()) {
                sb.append(Character.toUpperCase(w.charAt(0)));
                if (w.length() > 1) {
                    sb.append(w.substring(1).toLowerCase());
                }
            }
        }
        return sb.toString();
    }
}
