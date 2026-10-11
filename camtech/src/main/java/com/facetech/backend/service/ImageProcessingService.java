package com.facetech.backend.service;

import com.facetech.backend.util.ImageEnhancer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

@Service
@RequiredArgsConstructor
@Slf4j
public class ImageProcessingService {

    private final ImageEnhancer imageEnhancer;

    public byte[] processImage(MultipartFile file) throws IOException {
        byte[] imageData = file.getBytes();
        
        byte[] enhanced = imageEnhancer.enhanceDocument(imageData);
        
        if (enhanced != null && enhanced.length > 0) {
            log.debug("Image enhanced successfully ({} -> {} bytes)", imageData.length, enhanced.length);
            return enhanced;
        }
        
        log.warn("Image enhancement failed, using original image ({} bytes)", imageData.length);
        return imageData;
    }

    public byte[] processImage(byte[] imageData) {
        byte[] enhanced = imageEnhancer.enhanceDocument(imageData);
        
        if (enhanced != null && enhanced.length > 0) {
            return enhanced;
        }
        
        log.warn("Image enhancement failed, using original image ({} bytes)", imageData.length);
        return imageData;
    }
}
