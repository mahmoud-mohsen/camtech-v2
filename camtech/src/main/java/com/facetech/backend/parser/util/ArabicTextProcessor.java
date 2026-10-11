package com.facetech.backend.parser.util;

import org.springframework.stereotype.Component;

import java.util.regex.Pattern;

@Component
public class ArabicTextProcessor {

    private static final Pattern ARABIC_PATTERN = Pattern.compile("[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+");

    public boolean containsArabic(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        return ARABIC_PATTERN.matcher(text).find();
    }

    public String normalizeArabic(String text) {
        if (text == null) {
            return null;
        }
        
        return text
                .replaceAll("[\u064B-\u0652\u0670]", "")
                .replaceAll("\u0671", "\u0627")
                .replaceAll("[\u0622\u0623\u0625]", "\u0627")
                .replaceAll("[\u0624]", "\u0648")
                .replaceAll("[\u0626]", "\u064A")
                .replaceAll("[\u06C0]", "\u0647")
                .trim();
    }

    public String extractArabicText(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        
        StringBuilder arabic = new StringBuilder();
        java.util.regex.Matcher matcher = ARABIC_PATTERN.matcher(text);
        
        while (matcher.find()) {
            if (arabic.length() > 0) {
                arabic.append(" ");
            }
            arabic.append(matcher.group());
        }
        
        return arabic.toString().trim();
    }

    public String removeArabicText(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        return ARABIC_PATTERN.matcher(text).replaceAll("").trim();
    }
}
