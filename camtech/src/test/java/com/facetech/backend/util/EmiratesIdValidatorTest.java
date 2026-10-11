package com.facetech.backend.util;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EmiratesIdValidatorTest {

    @Test
    void acceptsValidNumbersWithAnyFormatting() {
        assertTrue(EmiratesIdValidator.isValidNumber("784-1980-0000001-2"));
        assertTrue(EmiratesIdValidator.isValidNumber("784 1975 0000002 7"));
        assertTrue(EmiratesIdValidator.isValidNumber("784200100000031"));
    }

    @Test
    void rejectsMisreadsAndWrongShape() {
        // check digit off by one (typical OCR misread)
        assertFalse(EmiratesIdValidator.isValidNumber("784-1980-0000001-3"));
        assertFalse(EmiratesIdValidator.isValidNumber("784-1990-1234567-1"));
        // wrong country prefix / length
        assertFalse(EmiratesIdValidator.isValidNumber("785-1980-0000001-2"));
        assertFalse(EmiratesIdValidator.isValidNumber("784-1980-000001-2"));
        assertFalse(EmiratesIdValidator.isValidNumber(null));
    }

    @Test
    void parsesCommonCardDateFormats() {
        LocalDate expected = LocalDate.of(2027, 3, 14);
        assertEquals(expected, EmiratesIdValidator.parseDate("14/03/2027").orElseThrow());
        assertEquals(expected, EmiratesIdValidator.parseDate("2027-03-14").orElseThrow());
        assertEquals(expected, EmiratesIdValidator.parseDate("14-03-2027").orElseThrow());
        assertTrue(EmiratesIdValidator.parseDate("not a date").isEmpty());
        assertTrue(EmiratesIdValidator.parseDate(null).isEmpty());
    }
}
