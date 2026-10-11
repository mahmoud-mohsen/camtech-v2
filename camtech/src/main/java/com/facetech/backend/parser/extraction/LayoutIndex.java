package com.facetech.backend.parser.extraction;

import com.facetech.backend.ocr.dto.OcrResult.OcrLine;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds a value by where it sits relative to its label on the card, using the OCR line boxes.
 * Text order alone breaks when the card has two columns (issue and expiry date side by side) or
 * when OCR reads the Arabic and English halves in a different order; positions do not.
 */
public final class LayoutIndex {

    /** How far below the label (in label heights) a value may sit. */
    private static final double MAX_ROWS_BELOW = 3.5;
    /** How far apart (fraction of the page width) a value below may start from its label. */
    private static final double MAX_COLUMN_SHIFT = 0.12;

    private final List<OcrLine> lines;

    private LayoutIndex(List<OcrLine> lines) {
        this.lines = lines;
    }

    public static LayoutIndex of(List<OcrLine> lines) {
        List<OcrLine> usable = new ArrayList<>();
        if (lines != null) {
            for (OcrLine l : lines) {
                if (l != null && l.getText() != null && !l.getText().isBlank() && l.getHeight() > 0) {
                    usable.add(l);
                }
            }
        }
        return new LayoutIndex(usable);
    }

    public boolean isEmpty() {
        return lines.isEmpty();
    }

    /**
     * The value matching {@code value} that belongs to the first line matching {@code label}: on the
     * same line after the label, else directly below it (same column), else beside it on the same row.
     *
     * @return the matched value (group 1 when the value pattern has a group, else the whole match)
     */
    public Optional<String> valueNear(Pattern label, Pattern value) {
        for (OcrLine l : lines) {
            Matcher lm = label.matcher(l.getText());
            if (!lm.find()) {
                continue;
            }
            Optional<String> inline = match(value, l.getText().substring(lm.end()));
            if (inline.isPresent()) {
                return inline;
            }
            Optional<String> below = lines.stream()
                    .filter(o -> o != l && o.getPage() == l.getPage())
                    .filter(o -> o.getY() >= l.centerY() && o.getY() - l.bottom() <= MAX_ROWS_BELOW * l.getHeight())
                    .filter(o -> overlaps(l, o) || Math.abs(o.getX() - l.getX()) <= MAX_COLUMN_SHIFT
                            || Math.abs(o.right() - l.right()) <= MAX_COLUMN_SHIFT)
                    .sorted(Comparator.comparingDouble(OcrLine::getY))
                    .map(o -> match(value, o.getText()))
                    .flatMap(Optional::stream)
                    .findFirst();
            if (below.isPresent()) {
                return below;
            }
            Optional<String> beside = lines.stream()
                    .filter(o -> o != l && o.getPage() == l.getPage())
                    .filter(o -> Math.abs(o.centerY() - l.centerY()) <= l.getHeight() * 0.6)
                    .sorted(Comparator.comparingDouble(o -> gap(l, o)))
                    .map(o -> match(value, o.getText()))
                    .flatMap(Optional::stream)
                    .findFirst();
            if (beside.isPresent()) {
                return beside;
            }
        }
        return Optional.empty();
    }

    private static Optional<String> match(Pattern value, String text) {
        Matcher m = value.matcher(text);
        if (!m.find()) {
            return Optional.empty();
        }
        String v = m.groupCount() >= 1 && m.group(1) != null ? m.group(1) : m.group();
        return v.isBlank() ? Optional.empty() : Optional.of(v.strip());
    }

    private static boolean overlaps(OcrLine a, OcrLine b) {
        return a.getX() < b.right() && b.getX() < a.right();
    }

    /** Horizontal distance between two boxes (0 when they overlap). */
    private static double gap(OcrLine a, OcrLine b) {
        if (overlaps(a, b)) {
            return 0;
        }
        return b.getX() >= a.right() ? b.getX() - a.right() : a.getX() - b.right();
    }
}
