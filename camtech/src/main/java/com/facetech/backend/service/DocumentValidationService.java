package com.facetech.backend.service;

import com.facetech.backend.util.BlurDetector;
import com.facetech.backend.util.ImageValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

@Service
@RequiredArgsConstructor
@Slf4j
public class DocumentValidationService {

    private final ImageValidator imageValidator;
    private final BlurDetector blurDetector;

    public ValidationResult validateDocument(MultipartFile file) {
        ValidationResult result = new ValidationResult();

        ImageValidator.ValidationResult imageValidation = imageValidator.validate(file);
        if (!imageValidation.isValid()) {
            log.info("Document image rejected by validation: {} error(s)", imageValidation.getErrors().size());
            result.setValid(false);
            result.setErrors(imageValidation.getErrors());
            return result;
        }

        result.setWidth(imageValidation.getWidth());
        result.setHeight(imageValidation.getHeight());

        try {
            byte[] imageData = file.getBytes();
            BlurDetector.BlurDetectionResult blurResult = blurDetector.detectBlur(imageData);
            
            if (blurResult.hasError()) {
                log.warn("Blur detection failed: {}", blurResult.getError());
            } else if (blurResult.isBlurred()) {
                log.info("Document image may be blurred: blurScore={}", blurResult.getBlurScore());
                result.addWarning(String.format("Image may be blurred (score: %.2f)", blurResult.getBlurScore()));
                result.setBlurScore(blurResult.getBlurScore());
            } else {
                log.debug("Document image passed blur check: blurScore={}", blurResult.getBlurScore());
                result.setBlurScore(blurResult.getBlurScore());
            }
        } catch (IOException e) {
            log.warn("Error reading image for blur detection, skipping blur check: {}", e.toString());
            result.addWarning("Could not perform blur detection");
        }

        return result;
    }

    public static class ValidationResult {
        private boolean valid = true;
        private java.util.List<String> errors = new java.util.ArrayList<>();
        private java.util.List<String> warnings = new java.util.ArrayList<>();
        private int width;
        private int height;
        private double blurScore;

        public void addError(String error) {
            this.valid = false;
            this.errors.add(error);
        }

        public void addWarning(String warning) {
            this.warnings.add(warning);
        }

        public boolean isValid() {
            return valid;
        }

        public void setValid(boolean valid) {
            this.valid = valid;
        }

        public java.util.List<String> getErrors() {
            return errors;
        }

        public void setErrors(java.util.List<String> errors) {
            this.valid = false;
            this.errors = errors;
        }

        public java.util.List<String> getWarnings() {
            return warnings;
        }

        public int getWidth() {
            return width;
        }

        public void setWidth(int width) {
            this.width = width;
        }

        public int getHeight() {
            return height;
        }

        public void setHeight(int height) {
            this.height = height;
        }

        public double getBlurScore() {
            return blurScore;
        }

        public void setBlurScore(double blurScore) {
            this.blurScore = blurScore;
        }
    }
}
