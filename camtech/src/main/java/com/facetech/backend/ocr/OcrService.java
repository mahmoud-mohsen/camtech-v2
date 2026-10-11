package com.facetech.backend.ocr;

import com.facetech.backend.ocr.dto.OcrResult;

public interface OcrService {
    
    OcrResult processImage(byte[] imageData);
    
    OcrResult processImage(byte[] imageData, String languageHint);
    
    OcrProvider getProvider();
    
    boolean isAvailable();
}
