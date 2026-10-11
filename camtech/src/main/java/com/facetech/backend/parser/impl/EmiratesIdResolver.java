package com.facetech.backend.parser.impl;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.parser.extraction.Candidates;
import com.facetech.backend.parser.extraction.ExtractionSource;
import com.facetech.backend.parser.extraction.FieldCandidate;
import com.facetech.backend.parser.extraction.FieldResolution;
import com.facetech.backend.parser.extraction.ValidationStatus;
import com.facetech.backend.util.EmiratesIdMrz;
import com.facetech.backend.util.EmiratesIdValidator;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Chooses one value per Emirates ID field from everything that was read, checks it, and scores it.
 *
 * <ul>
 *   <li>ID number: 15 digits, 784 prefix, Luhn check digit. The front and the MRZ must agree.</li>
 *   <li>Birth date: a real past date; its year must be the year in the ID number (784-YYYY-...).</li>
 *   <li>Issue / expiry: real dates, issue not in the future, expiry after issue and at most 10 years later.</li>
 *   <li>MRZ dates and card number: trusted only when their check digit matched.</li>
 *   <li>English name: the front and the MRZ name must be close (OCR may misread a letter or two).</li>
 * </ul>
 * Fields that nothing can confirm (employer, occupation...) are UNVERIFIED, not VALID.
 */
final class EmiratesIdResolver {

    static final DateTimeFormatter DISPLAY = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    /** Expiry is at most 10 years after issue; a month of slack for cards issued before the start date. */
    private static final int MAX_VALIDITY_YEARS = 10;
    private static final double NAME_AGREEMENT = 0.75;

    enum Side { FRONT, BACK, COMBINED }

    /** Issue codes on the document as a whole. */
    static final String ISSUE_EXPIRED = "EXPIRED";
    static final String ISSUE_SIDES_MISMATCH = "SIDES_MISMATCH";
    static final String ISSUE_MRZ_NOT_VERIFIED = "MRZ_NOT_VERIFIED";

    private static final List<String> SCORED_IF_PRESENT = List.of("dateOfBirth", "expiryDate", "issueDate", "gender");

    private final Candidates candidates;
    private final Optional<EmiratesIdMrz.Result> mrz;
    private final Side side;
    private final LocalDate today;
    private final Map<String, FieldResolution> resolved = new LinkedHashMap<>();
    private final Set<String> issues = new LinkedHashSet<>();

    private EmiratesIdResolver(Candidates candidates, Optional<EmiratesIdMrz.Result> mrz, Side side, LocalDate today) {
        this.candidates = candidates;
        this.mrz = mrz;
        this.side = side;
        this.today = today;
    }

    static List<String> requiredFields(Side side) {
        return switch (side) {
            // Older cards print the dates on the back, so the front alone only has to give the ID and name.
            case FRONT -> List.of("emiratesIdNumber", "fullNameEn");
            case BACK -> List.of("emiratesIdNumber", "dateOfBirth", "expiryDate");
            case COMBINED -> List.of("emiratesIdNumber", "fullNameEn", "dateOfBirth", "expiryDate");
        };
    }

    static DocumentFieldsDto resolve(Candidates candidates, Optional<EmiratesIdMrz.Result> mrz, Side side,
                                     LocalDate today, String rawText) {
        return new EmiratesIdResolver(candidates, mrz, side, today).run(rawText);
    }

    private DocumentFieldsDto run(String rawText) {
        String idYear = resolveIdNumber();
        LocalDate dob = resolveBirthDate(idYear);
        LocalDate issue = resolveIssueDate(dob);
        resolveExpiry(dob, issue);
        resolveGender();
        resolveEnglishName();
        resolveFreeText("fullNameAr", true);
        resolveFreeText("nationality", false);
        resolveFreeText("nationalityAr", false);
        resolveNationalityCode();
        resolveCardNumber();
        for (String f : List.of("occupation", "occupationAr", "employer", "employerAr", "issuingPlace", "issuingPlaceAr")) {
            resolveFreeText(f, false);
        }
        mrz.ifPresent(m -> {
            if (!m.verified()) {
                issues.add(ISSUE_MRZ_NOT_VERIFIED);
            }
        });

        DocumentFieldsDto result = DocumentFieldsDto.builder().build();
        result.setRawText(rawText);
        List<String> required = requiredFields(side);
        result.setRequiredFields(new ArrayList<>(required));
        for (String f : required) {
            resolved.putIfAbsent(f, FieldResolution.missing("Not found on the card"));
        }
        resolved.forEach((field, r) -> {
            if (r.value() != null) {
                result.addField(field, r.value(), BigDecimal.valueOf(r.confidence()).setScale(4, RoundingMode.HALF_UP));
            }
            result.addCheck(field, new DocumentFieldsDto.FieldCheck(r.source() != null ? r.source().name() : null,
                    r.status().name(), r.message()));
        });
        mrz.ifPresent(m -> result.addField("mrzVerified", m.verified()));
        issues.forEach(result::addIssue);
        result.setOverallConfidence(overall(required));
        return result;
    }

    /** Mean confidence of the required fields plus the dates and sex when they were read (missing counts as 0). */
    private BigDecimal overall(List<String> required) {
        Set<String> scored = new LinkedHashSet<>(required);
        for (String f : SCORED_IF_PRESENT) {
            FieldResolution r = resolved.get(f);
            if (r != null && r.status() != ValidationStatus.MISSING) {
                scored.add(f);
            }
        }
        double sum = 0;
        for (String f : scored) {
            sum += resolved.get(f).confidence();
        }
        return BigDecimal.valueOf(scored.isEmpty() ? 0 : sum / scored.size()).setScale(4, RoundingMode.HALF_UP);
    }

    // ================================================================ ID number

    /** @return the birth year from a valid ID number, or null */
    private String resolveIdNumber() {
        List<FieldCandidate> list = candidates.get("emiratesIdNumber");
        if (list.isEmpty()) {
            return null;
        }
        List<FieldCandidate> valid = list.stream().filter(c -> EmiratesIdValidator.isValidNumber(c.value())).toList();
        if (valid.isEmpty()) {
            FieldCandidate best = list.get(0);
            put("emiratesIdNumber", best, ValidationStatus.INVALID, false, false,
                    "Not a valid Emirates ID number (15 digits starting with 784 and a matching check digit)");
            return null;
        }
        FieldCandidate best = valid.get(0);
        String digits = EmiratesIdValidator.normalizeNumber(best.value());
        boolean agreed = valid.stream().anyMatch(c -> c.source() != best.source()
                && EmiratesIdValidator.normalizeNumber(c.value()).equals(digits));
        Optional<FieldCandidate> other = valid.stream()
                .filter(c -> !EmiratesIdValidator.normalizeNumber(c.value()).equals(digits)).findFirst();
        if (other.isPresent() && isMrz(best) != isMrz(other.get())) {
            issues.add(ISSUE_SIDES_MISMATCH);
            put("emiratesIdNumber", best, ValidationStatus.MISMATCH, true, false,
                    "The front reads " + format(other.get().value()) + " but the back (MRZ) reads " + format(best.value()));
        } else {
            put("emiratesIdNumber", best, ValidationStatus.VALID, true, agreed,
                    agreed ? "Check digit matches; front and back agree" : "Check digit matches");
        }
        return digits.substring(3, 7);
    }

    private static boolean isMrz(FieldCandidate c) {
        return c.source() == ExtractionSource.MRZ || c.source() == ExtractionSource.MRZ_VERIFIED;
    }

    private static String format(String number) {
        return EmiratesIdValidator.normalizeNumber(number).replaceFirst("(\\d{3})(\\d{4})(\\d{7})(\\d)", "$1-$2-$3-$4");
    }

    // ================================================================ dates

    private LocalDate resolveBirthDate(String idYear) {
        return resolveDate("dateOfBirth", d -> {
            if (d.isAfter(today)) {
                return new Check(ValidationStatus.INVALID, "Birth date is in the future");
            }
            if (d.isBefore(today.minusYears(120))) {
                return new Check(ValidationStatus.INVALID, "Birth date is more than 120 years ago");
            }
            if (idYear != null) {
                return String.valueOf(d.getYear()).equals(idYear)
                        ? new Check(ValidationStatus.VALID, "Year matches the ID number", true)
                        : new Check(ValidationStatus.MISMATCH, "Birth year " + d.getYear()
                        + " does not match the year in the ID number (" + idYear + ")");
            }
            return new Check(ValidationStatus.VALID, null);
        });
    }

    private LocalDate resolveIssueDate(LocalDate dob) {
        return resolveDate("issueDate", d -> {
            if (d.isAfter(today.plusDays(1))) {
                return new Check(ValidationStatus.INVALID, "Issue date is in the future");
            }
            if (dob != null && !d.isAfter(dob)) {
                return new Check(ValidationStatus.INVALID, "Issue date is not after the birth date");
            }
            return new Check(ValidationStatus.VALID, null);
        });
    }

    private void resolveExpiry(LocalDate dob, LocalDate issue) {
        LocalDate expiry = resolveDate("expiryDate", d -> {
            if (dob != null && !d.isAfter(dob)) {
                return new Check(ValidationStatus.INVALID, "Expiry date is not after the birth date");
            }
            if (issue != null) {
                if (!d.isAfter(issue)) {
                    return new Check(ValidationStatus.INVALID, "Expiry date is not after the issue date");
                }
                if (d.isAfter(issue.plusYears(MAX_VALIDITY_YEARS).plusMonths(1))) {
                    return new Check(ValidationStatus.MISMATCH, "Expiry is more than " + MAX_VALIDITY_YEARS
                            + " years after the issue date");
                }
                return new Check(ValidationStatus.VALID, "Consistent with the issue date");
            }
            if (d.isAfter(today.plusYears(MAX_VALIDITY_YEARS).plusMonths(1))) {
                return new Check(ValidationStatus.INVALID, "Expiry is more than " + MAX_VALIDITY_YEARS + " years away");
            }
            return new Check(ValidationStatus.VALID, null);
        });
        FieldResolution r = resolved.get("expiryDate");
        if (expiry != null && expiry.isBefore(today) && r != null && r.status() == ValidationStatus.VALID) {
            issues.add(ISSUE_EXPIRED);
        }
    }

    private record Check(ValidationStatus status, String message, boolean crossChecked) {
        Check(ValidationStatus status, String message) {
            this(status, message, false);
        }
    }

    private interface DateRule {
        Check check(LocalDate date);
    }

    /**
     * Picks the most trusted candidate that passes the rule (else the best one that at least parses) and
     * records it. A date read the same way by two sources, or confirmed by another field, counts as agreed.
     *
     * @return the chosen date when it is not INVALID, else null
     */
    private LocalDate resolveDate(String field, DateRule rule) {
        List<FieldCandidate> list = candidates.get(field);
        if (list.isEmpty()) {
            return null;
        }
        FieldCandidate chosen = null;
        Check chosenCheck = null;
        LocalDate chosenDate = null;
        int chosenRank = Integer.MAX_VALUE;
        for (FieldCandidate c : list) {
            Optional<LocalDate> d = EmiratesIdValidator.parseDate(c.value());
            Check check = d.map(rule::check).orElse(new Check(ValidationStatus.INVALID, "Not a valid date"));
            int rank = rank(check.status());
            if (rank < chosenRank) {
                chosen = c;
                chosenCheck = check;
                chosenDate = d.orElse(null);
                chosenRank = rank;
            }
        }
        LocalDate date = chosenDate;
        FieldCandidate pick = chosen;
        boolean agreed = date != null && list.stream().anyMatch(c -> c.source() != pick.source()
                && EmiratesIdValidator.parseDate(c.value()).map(date::equals).orElse(false));
        String message = chosenCheck.message();
        if (agreed && chosenCheck.status() == ValidationStatus.VALID) {
            message = message == null ? "Front and back agree" : message + "; front and back agree";
        }
        boolean strong = chosen.source() == ExtractionSource.MRZ_VERIFIED;
        String display = date != null ? date.format(DISPLAY) : chosen.value();
        resolved.put(field, new FieldResolution(display, chosen.source(), chosenCheck.status(),
                FieldResolution.confidence(chosen.source(), chosenCheck.status(), strong, agreed || chosenCheck.crossChecked()),
                message));
        return chosenCheck.status() == ValidationStatus.INVALID ? null : date;
    }

    /** Lower is better: a valid value beats a doubtful one, which beats a broken one. */
    private static int rank(ValidationStatus s) {
        return switch (s) {
            case VALID -> 0;
            case UNVERIFIED -> 1;
            case MISMATCH -> 2;
            case INVALID -> 3;
            case MISSING -> 4;
        };
    }

    // ================================================================ sex

    private void resolveGender() {
        List<FieldCandidate> list = candidates.get("gender");
        if (!list.isEmpty()) {
            FieldCandidate best = null;
            for (FieldCandidate c : list) {
                if (normalizeGender(c.value()) != null) {
                    best = c;
                    break;
                }
            }
            if (best == null) {
                put("gender", list.get(0), ValidationStatus.INVALID, false, false, "Not Male or Female");
            } else {
                String g = normalizeGender(best.value());
                FieldCandidate pick = best;
                boolean agreed = list.stream().anyMatch(c -> c.source() != pick.source() && g.equals(normalizeGender(c.value())));
                Optional<FieldCandidate> conflict = list.stream()
                        .filter(c -> normalizeGender(c.value()) != null && !g.equals(normalizeGender(c.value()))).findFirst();
                if (conflict.isPresent()) {
                    put("gender", new FieldCandidate(g, best.source()), ValidationStatus.MISMATCH, false, false,
                            "The card reads both " + g + " and " + normalizeGender(conflict.get().value()));
                } else {
                    put("gender", new FieldCandidate(g, best.source()), ValidationStatus.VALID, false, agreed,
                            agreed ? "Front and back agree" : null);
                }
            }
        }
        List<FieldCandidate> ar = candidates.get("genderAr");
        if (!ar.isEmpty()) {
            FieldCandidate best = ar.get(0);
            FieldResolution en = resolved.get("gender");
            String expected = en != null && en.value() != null ? ("Male".equals(en.value()) ? "ذكر" : "أنثى") : null;
            if (expected == null) {
                put("genderAr", best, ValidationStatus.UNVERIFIED, false, false, null);
            } else if (expected.equals(normalizeArabicGender(best.value()))) {
                put("genderAr", new FieldCandidate(expected, best.source()), ValidationStatus.VALID, false, true,
                        "Matches the English value");
            } else {
                put("genderAr", best, ValidationStatus.MISMATCH, false, false, "Does not match the English value");
            }
        }
    }

    private static String normalizeGender(String v) {
        String s = v.strip().toLowerCase(Locale.ROOT);
        return switch (s) {
            case "male", "m" -> "Male";
            case "female", "f" -> "Female";
            default -> null;
        };
    }

    private static String normalizeArabicGender(String v) {
        String s = v.strip();
        if (s.equals("ذكر")) {
            return "ذكر";
        }
        return s.equals("أنثى") || s.equals("انثى") ? "أنثى" : s;
    }

    // ================================================================ names and free text

    private void resolveEnglishName() {
        List<FieldCandidate> list = candidates.get("fullNameEn").stream().filter(c -> plausibleName(c.value())).toList();
        if (list.isEmpty()) {
            List<FieldCandidate> any = candidates.get("fullNameEn");
            if (!any.isEmpty()) {
                put("fullNameEn", any.get(0), ValidationStatus.INVALID, false, false, "Does not look like a name");
            }
            return;
        }
        Optional<FieldCandidate> fromMrz = list.stream().filter(EmiratesIdResolver::isMrz).findFirst();
        Optional<FieldCandidate> fromFront = list.stream().filter(c -> !isMrz(c)).findFirst();
        if (fromMrz.isPresent() && fromFront.isPresent()) {
            String m = fromMrz.get().value();
            String f = fromFront.get().value();
            double similarity = similarity(m, f);
            if (similarity >= NAME_AGREEMENT) {
                // The MRZ font reads more reliably, but the MRZ cuts long names: keep the front when it has more words.
                FieldCandidate pick = words(f) > words(m) ? fromFront.get() : fromMrz.get();
                put("fullNameEn", pick, ValidationStatus.VALID, false, true, "Front and MRZ names agree");
            } else {
                put("fullNameEn", fromFront.get(), ValidationStatus.MISMATCH, false, false,
                        "The front name differs from the MRZ name (" + m + ")");
            }
            return;
        }
        put("fullNameEn", list.get(0), ValidationStatus.UNVERIFIED, false, false, null);
    }

    private void resolveFreeText(String field, boolean arabicName) {
        List<FieldCandidate> list = candidates.get(field);
        if (list.isEmpty()) {
            return;
        }
        FieldCandidate best = list.get(0);
        if (arabicName && best.value().strip().split("\\s+").length < 2) {
            put(field, best, ValidationStatus.INVALID, false, false, "Expected at least two names");
            return;
        }
        boolean agreed = list.stream().anyMatch(c -> c.source() != best.source() && c.value().equalsIgnoreCase(best.value()));
        put(field, best, ValidationStatus.UNVERIFIED, false, agreed, null);
    }

    private void resolveNationalityCode() {
        List<FieldCandidate> list = candidates.get("nationalityCode");
        if (list.isEmpty()) {
            return;
        }
        FieldCandidate best = list.get(0);
        boolean ok = best.value().matches("[A-Z]{3}");
        put("nationalityCode", best, ok ? ValidationStatus.VALID : ValidationStatus.INVALID, false, false,
                ok ? null : "Not a 3-letter country code");
    }

    private void resolveCardNumber() {
        List<FieldCandidate> list = candidates.get("cardNumber");
        if (list.isEmpty()) {
            return;
        }
        FieldCandidate best = list.get(0);
        boolean verified = best.source() == ExtractionSource.MRZ_VERIFIED;
        put("cardNumber", best, verified ? ValidationStatus.VALID : ValidationStatus.UNVERIFIED, verified, false,
                verified ? "MRZ check digit matches" : null);
    }

    private static boolean plausibleName(String v) {
        String s = v.strip();
        return s.length() >= 4 && s.length() <= 100 && s.matches("[\\p{L}' .-]+") && words(s) >= 2;
    }

    private static int words(String s) {
        return s.strip().split("\\s+").length;
    }

    /** 1 - edit distance / length, on letters only, ignoring case. */
    static double similarity(String a, String b) {
        String x = a.toUpperCase(Locale.ROOT).replaceAll("[^\\p{L}]", "");
        String y = b.toUpperCase(Locale.ROOT).replaceAll("[^\\p{L}]", "");
        int max = Math.max(x.length(), y.length());
        if (max == 0) {
            return 0;
        }
        int[] prev = new int[y.length() + 1];
        int[] cur = new int[y.length() + 1];
        for (int j = 0; j <= y.length(); j++) {
            prev[j] = j;
        }
        for (int i = 1; i <= x.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= y.length(); j++) {
                int cost = x.charAt(i - 1) == y.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev;
            prev = cur;
            cur = t;
        }
        return 1.0 - (double) prev[y.length()] / max;
    }

    private void put(String field, FieldCandidate c, ValidationStatus status, boolean strong, boolean agreed, String message) {
        resolved.put(field, new FieldResolution(c.value(), c.source(), status,
                FieldResolution.confidence(c.source(), status, strong, agreed), message));
    }
}
