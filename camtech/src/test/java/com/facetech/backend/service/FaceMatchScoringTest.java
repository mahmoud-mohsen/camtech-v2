package com.facetech.backend.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FaceMatchScoringTest {

    private final FaceMatchScoring scoring = new FaceMatchScoring(0.40, 0.28, 0.70);

    @Test
    void decisionBands() {
        assertEquals(FaceMatchScoring.Decision.MATCH, scoring.decide(0.40));
        assertEquals(FaceMatchScoring.Decision.MATCH, scoring.decide(0.65));
        assertEquals(FaceMatchScoring.Decision.REVIEW, scoring.decide(0.28));
        assertEquals(FaceMatchScoring.Decision.REVIEW, scoring.decide(0.399));
        assertEquals(FaceMatchScoring.Decision.NO_MATCH, scoring.decide(0.279));
        assertEquals(FaceMatchScoring.Decision.NO_MATCH, scoring.decide(-0.1));
    }

    @Test
    void scoreLinesUpWithDecision() {
        assertEquals(75, scoring.score(0.40));
        assertEquals(99, scoring.score(0.70));
        assertEquals(99, scoring.score(0.95));
        assertEquals(50, scoring.score(0.28));
        assertEquals(0, scoring.score(-0.2));
        assertTrue(scoring.score(0.399) < 75);
        assertTrue(scoring.score(0.279) < 50);
        // Typical genuine ID-vs-selfie similarity reads as a confident match.
        assertTrue(scoring.score(0.65) >= 90);
    }

    @Test
    void rejectsInconsistentBands() {
        assertThrows(IllegalArgumentException.class, () -> new FaceMatchScoring(0.30, 0.40, 0.70));
    }
}
