package com.facetech.backend.ocr;

public enum OcrProvider {
    GOOGLE_DOCUMENT_AI("google-documentai"),
    PADDLE_OCR("paddleocr"),
    TESSERACT("tesseract");

    private final String providerName;

    OcrProvider(String providerName) {
        this.providerName = providerName;
    }

    public String getProviderName() {
        return providerName;
    }
}
