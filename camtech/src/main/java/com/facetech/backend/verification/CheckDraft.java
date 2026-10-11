package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;

import java.util.Map;

/** One check result, collected while a step runs and saved with the step afterwards. */
public record CheckDraft(String code, Double score, String thresholdUsed, Codes.CheckOutcome outcome,
                         Map<String, ?> details) {

    public static CheckDraft pass(String code, Double score, String threshold) {
        return new CheckDraft(code, score, threshold, Codes.CheckOutcome.PASS, null);
    }

    public static CheckDraft of(String code, Double score, String threshold, boolean passed) {
        return new CheckDraft(code, score, threshold, passed ? Codes.CheckOutcome.PASS : Codes.CheckOutcome.FAIL, null);
    }
}
