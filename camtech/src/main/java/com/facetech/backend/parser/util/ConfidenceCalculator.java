package com.facetech.backend.parser.util;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.regex.Pattern;

@Component
public class ConfidenceCalculator {

    private static final Pattern EMIRATES_ID_PATTERN = Pattern.compile("^784-\\d{4}-\\d{7}-\\d{1}$");
    private static final Pattern PASSPORT_PATTERN = Pattern.compile("^[A-Z]{1,2}\\d{6,9}$");
    private static final Pattern DATE_PATTERN = Pattern.compile("^\\d{2}/\\d{2}/\\d{4}$");

    public BigDecimal calculateFieldConfidence(String fieldName, String value, String ocrText) {
        if (value == null || value.isEmpty()) {
            return BigDecimal.ZERO;
        }

        double confidence = 0.5;

        switch (fieldName.toLowerCase()) {
            case "idnumber":
            case "id_number":
                if (EMIRATES_ID_PATTERN.matcher(value).matches()) {
                    confidence = 0.95;
                } else if (value.matches("^\\d{15}$")) {
                    confidence = 0.80;
                }
                break;

            case "passportnumber":
            case "passport_number":
                if (PASSPORT_PATTERN.matcher(value).matches()) {
                    confidence = 0.90;
                }
                break;

            case "expirydate":
            case "dateofbirth":
            case "issuedate":
                if (DATE_PATTERN.matcher(value).matches()) {
                    confidence = 0.85;
                }
                break;

            case "name":
            case "nameenglish":
            case "namearabic":
                if (value.length() > 3 && value.matches("^[\\p{L}\\s]+$")) {
                    confidence = 0.75;
                }
                break;

            case "nationality":
                if (value.length() > 2 && value.matches("^[A-Za-z\\s]+$")) {
                    confidence = 0.80;
                }
                break;

            default:
                confidence = 0.60;
        }

        if (ocrText != null && ocrText.contains(value)) {
            confidence += 0.05;
        }

        return BigDecimal.valueOf(Math.min(confidence, 1.0));
    }

    public BigDecimal calculateOverallConfidence(BigDecimal... confidences) {
        if (confidences.length == 0) {
            return BigDecimal.ZERO;
        }

        BigDecimal sum = BigDecimal.ZERO;
        for (BigDecimal conf : confidences) {
            if (conf != null) {
                sum = sum.add(conf);
            }
        }

        return sum.divide(BigDecimal.valueOf(confidences.length), 4, BigDecimal.ROUND_HALF_UP);
    }
}
