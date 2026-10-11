package com.facetech.backend.service;

/**
 * Turns an ID-vs-selfie cosine similarity into a three-way decision and a
 * user-facing 0-100 score.
 *
 * Bands (cosine similarity, insightface buffalo_l):
 *   >= matchSimilarity           MATCH
 *   >= reviewSimilarity          REVIEW  (borderline: ask for a retry / manual check)
 *   otherwise                    NO_MATCH
 *
 * The score is piecewise-linear so it lines up with the decision:
 * NO_MATCH maps to 0-49, REVIEW to 50-74, MATCH to 75-99. A raw cosine of
 * 0.45 is a solid ID-vs-selfie match but would read as "45%" to a user.
 *
 * The thresholds come from config_param (face.doc_match_similarity,
 * face.review_similarity, face.excellent_similarity), so an instance is built
 * per decision with the values that apply to that verification.
 */
public class FaceMatchScoring {

    public enum Decision { MATCH, REVIEW, NO_MATCH }

    private final double matchSimilarity;
    private final double reviewSimilarity;
    private final double excellentSimilarity;

    public FaceMatchScoring(double matchSimilarity, double reviewSimilarity, double excellentSimilarity) {
        if (!(reviewSimilarity < matchSimilarity && matchSimilarity < excellentSimilarity)) {
            throw new IllegalArgumentException(
                    "Expected review-similarity < match-similarity < excellent-similarity");
        }
        this.matchSimilarity = matchSimilarity;
        this.reviewSimilarity = reviewSimilarity;
        this.excellentSimilarity = excellentSimilarity;
    }

    public Decision decide(double similarity) {
        if (similarity >= matchSimilarity) {
            return Decision.MATCH;
        }
        if (similarity >= reviewSimilarity) {
            return Decision.REVIEW;
        }
        return Decision.NO_MATCH;
    }

    public int score(double similarity) {
        double s;
        if (similarity >= matchSimilarity) {
            s = 75 + 24 * fraction(similarity, matchSimilarity, excellentSimilarity);
        } else if (similarity >= reviewSimilarity) {
            s = 50 + 24 * fraction(similarity, reviewSimilarity, matchSimilarity);
        } else {
            s = 49 * fraction(similarity, 0.0, reviewSimilarity);
        }
        return (int) Math.round(s);
    }

    public double matchSimilarity() {
        return matchSimilarity;
    }

    public double reviewSimilarity() {
        return reviewSimilarity;
    }

    /** "0.40 / 0.28", stored with each match check. */
    public String thresholds() {
        return String.format(java.util.Locale.ROOT, "%.2f / %.2f", matchSimilarity, reviewSimilarity);
    }

    private static double fraction(double v, double lo, double hi) {
        return Math.max(0.0, Math.min(1.0, (v - lo) / (hi - lo)));
    }
}
