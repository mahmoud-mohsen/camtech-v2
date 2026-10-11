package com.facetech.backend.ocr.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OcrResult {
    private String fullText;
    private BigDecimal confidence;
    private List<OcrBlock> blocks;
    /** Text lines with their position on the page; empty when the provider gives no layout. */
    @Builder.Default
    private List<OcrLine> lines = new ArrayList<>();
    private String provider;
    private long processingTimeMs;

    /** An OCR result with text only (no layout), e.g. for parsers called with a string. */
    public static OcrResult ofText(String text) {
        return OcrResult.builder().fullText(text).blocks(new ArrayList<>()).build();
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OcrBlock {
        private String text;
        private BigDecimal confidence;
        private BoundingBox boundingBox;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BoundingBox {
        private int x;
        private int y;
        private int width;
        private int height;
    }

    /**
     * One line of text. The box is normalized to the page (0..1 from the top-left corner), so positions
     * compare across image sizes.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OcrLine {
        private String text;
        private double confidence;
        private int page;
        private double x;
        private double y;
        private double width;
        private double height;

        public double right() {
            return x + width;
        }

        public double bottom() {
            return y + height;
        }

        public double centerY() {
            return y + height / 2;
        }
    }
}
