package com.facetech.backend.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PassportMrzValidatorTest {

    // ICAO 9303 specimen passport (Erika Mustermann style sample).
    private static final String SPECIMEN = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

    @Test
    void checkDigitMatchesIcaoExamples() {
        assertEquals(6, PassportMrzValidator.checkDigit("L898902C3"));
        assertEquals(2, PassportMrzValidator.checkDigit("740812"));
        assertEquals(9, PassportMrzValidator.checkDigit("120415"));
    }

    @Test
    void acceptsValidLine2() {
        assertTrue(PassportMrzValidator.isValidLine2(SPECIMEN));
    }

    @Test
    void rejectsMisreads() {
        // one character of the document number misread
        assertFalse(PassportMrzValidator.isValidLine2("L898902C46UTO7408122F1204159ZE184226B<<<<<10"));
        // expiry digit misread
        assertFalse(PassportMrzValidator.isValidLine2("L898902C36UTO7408122F1204169ZE184226B<<<<<10"));
        assertFalse(PassportMrzValidator.isValidLine2("too short"));
        assertFalse(PassportMrzValidator.isValidLine2(null));
    }
}
