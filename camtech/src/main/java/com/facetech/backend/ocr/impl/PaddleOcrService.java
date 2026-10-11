package com.facetech.backend.ocr.impl;

import com.facetech.backend.ocr.OcrProvider;
import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.ocr.dto.OcrResult;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.ArrayList;

@Service
@ConditionalOnProperty(name = "ocr.provider", havingValue = "paddleocr")
@Slf4j
public class PaddleOcrService implements OcrService {

    @PostConstruct
    void logConfiguration() {
        log.info("OCR provider configured: {} (placeholder implementation, available={})",
                getProvider().getProviderName(), isAvailable());
    }

    @Override
    public OcrResult processImage(byte[] imageData) {
        return processImage(imageData, "ar,en");
    }

    @Override
    public OcrResult processImage(byte[] imageData, String languageHint) {
        log.warn("PaddleOCR implementation is a placeholder. Integrate with actual PaddleOCR service. (imageSizeBytes={})",
                imageData != null ? imageData.length : 0);
        
        return OcrResult.builder()
                .fullText("PaddleOCR - To be implemented")
                .confidence(BigDecimal.ZERO)
                .blocks(new ArrayList<>())
                .provider(getProvider().getProviderName())
                .processingTimeMs(0L)
                .build();
    }

    @Override
    public OcrProvider getProvider() {
        return OcrProvider.PADDLE_OCR;
    }

    @Override
    public boolean isAvailable() {
        return false;
    }
}
