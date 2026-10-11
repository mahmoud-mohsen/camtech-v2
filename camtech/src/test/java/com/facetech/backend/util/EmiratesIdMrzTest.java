package com.facetech.backend.util;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

class EmiratesIdMrzTest {

    private static String withCheck(String field) {
        return field + PassportMrzValidator.checkDigit(field);
    }

    private static String pad(String s) {
        return s + "<".repeat(30 - s.length());
    }

    /** A made-up card: number 123456789, ID 784-1990-1234567-6, born 1990-02-01, expires 2027-04-27. */
    private static String[] card() {
        String line1 = "ILARE" + withCheck("123456789") + "784199012345676";
        String line2Start = withCheck("900201") + "M" + withCheck("270427") + "EGY" + "<".repeat(11);
        String composite = line1.substring(5, 30) + line2Start.substring(0, 7) + line2Start.substring(8, 15)
                + line2Start.substring(18, 29);
        String line2 = line2Start + PassportMrzValidator.checkDigit(composite);
        String line3 = pad("HASSAN<<AHMED<ALI");
        return new String[]{line1, line2, line3};
    }

    private static String ocr(String... mrz) {
        return "UNITED ARAB EMIRATES\nOccupation: Engineer\n" + String.join("\n", mrz) + "\n";
    }

    @Test
    void readsAndVerifiesTheBackOfTheCard() {
        String[] c = card();
        EmiratesIdMrz.Result r = EmiratesIdMrz.parse(ocr(c)).orElseThrow();

        assertTrue(r.verified());
        assertEquals("123456789", r.cardNumber());
        assertEquals("784-1990-1234567-6", r.emiratesIdNumber());
        assertEquals(LocalDate.of(1990, 2, 1), r.dateOfBirth());
        assertEquals(LocalDate.of(2027, 4, 27), r.expiryDate());
        assertEquals("M", r.sex());
        assertEquals("EGY", r.nationality());
        assertEquals("AHMED ALI HASSAN", r.fullName());
    }

    @Test
    void readsSpacesInTheNameLineAsFillers() {
        String[] c = card();
        EmiratesIdMrz.Result r = EmiratesIdMrz.parse(ocr(c[0], c[1], "MOHAMED AHMED<<MAHMOUD MOHSEN<")).orElseThrow();

        assertEquals("MAHMOUD MOHSEN MOHAMED AHMED", r.fullName());
    }

    @Test
    void correctsLettersOcrReadInDigitPositionsAndIgnoresSpaces() {
        String[] c = card();
        String line2 = c[1].replace("900201", "9OO2O1");
        String spaced = c[0].substring(0, 15) + " " + c[0].substring(15);
        EmiratesIdMrz.Result r = EmiratesIdMrz.parse(ocr(spaced, line2, c[2])).orElseThrow();

        assertTrue(r.verified());
        assertEquals(LocalDate.of(1990, 2, 1), r.dateOfBirth());
    }

    @Test
    void dropsValuesWhoseCheckDigitDoesNotMatch() {
        String[] c = card();
        // Expiry misread as 2029: its check digit no longer matches.
        String line2 = c[1].substring(0, 8) + "290427" + c[1].substring(14);
        EmiratesIdMrz.Result r = EmiratesIdMrz.parse(ocr(c[0], line2, c[2])).orElseThrow();

        assertFalse(r.expiryValid());
        assertNull(r.expiryDate());
        assertFalse(r.verified());
        assertEquals(LocalDate.of(1990, 2, 1), r.dateOfBirth());
    }

    @Test
    void isNotVerifiedWithoutTheCardNumberLine() {
        String[] c = card();
        EmiratesIdMrz.Result r = EmiratesIdMrz.parse(ocr(c[1], c[2])).orElseThrow();

        assertFalse(r.verified());
        assertNull(r.emiratesIdNumber());
        assertEquals(LocalDate.of(2027, 4, 27), r.expiryDate());
    }

    @Test
    void findsNothingWithoutAnMrz() {
        assertTrue(EmiratesIdMrz.parse("UNITED ARAB EMIRATES\nEmployer: Noqodi\n").isEmpty());
        assertTrue(EmiratesIdMrz.parse(null).isEmpty());
    }
}
