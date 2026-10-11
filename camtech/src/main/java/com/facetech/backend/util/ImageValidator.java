package com.facetech.backend.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;

@Component
@Slf4j
public class ImageValidator {

    private static final List<String> ALLOWED_CONTENT_TYPES = Arrays.asList(
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/gif",
            "image/bmp",
            "image/webp",
            "application/pdf"
    );

    private static final long MAX_FILE_SIZE = 10 * 1024 * 1024;
    private static final int MIN_WIDTH = 100;
    private static final int MIN_HEIGHT = 100;
    private static final int MAX_WIDTH = 10000;
    private static final int MAX_HEIGHT = 10000;

    public ValidationResult validate(MultipartFile file) {
        ValidationResult result = new ValidationResult();

        if (file == null || file.isEmpty()) {
            result.addError("File is empty or null");
            return result;
        }

        if (file.getSize() > MAX_FILE_SIZE) {
            result.addError(String.format("File size exceeds maximum allowed size of %d MB", 
                    MAX_FILE_SIZE / 1024 / 1024));
            return result;
        }

        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType.toLowerCase())) {
            log.debug("Image validation: rejected content type {}", contentType);
            result.addError("Invalid file type. Allowed types: " + String.join(", ", ALLOWED_CONTENT_TYPES));
            return result;
        }

        // PDFs are valid without image dimension checks
        if ("application/pdf".equalsIgnoreCase(contentType)) {
            result.setWidth(0);
            result.setHeight(0);
            return result;
        }

        try {
            // Dimensions from the image header only: decoding a 10000x10000 upload just to measure it would take
            // ~400 MB of heap.
            int[] size = headerDimensions(file.getBytes());

            if (size == null) {
                log.debug("Image validation: unreadable image (contentType={}, sizeBytes={})", contentType, file.getSize());
                result.addError("Unable to read image. File may be corrupted or not a valid image");
                return result;
            }

            int width = size[0];
            int height = size[1];

            result.setWidth(width);
            result.setHeight(height);
            log.debug("Image validation: contentType={}, sizeBytes={}, dimensions={}x{}",
                    contentType, file.getSize(), width, height);

            if (width < MIN_WIDTH || height < MIN_HEIGHT) {
                result.addError(String.format("Image dimensions too small. Minimum: %dx%d, Actual: %dx%d",
                        MIN_WIDTH, MIN_HEIGHT, width, height));
            }

            if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                result.addError(String.format("Image dimensions too large. Maximum: %dx%d, Actual: %dx%d",
                        MAX_WIDTH, MAX_HEIGHT, width, height));
            }

        } catch (Exception e) {
            log.warn("Error validating image, marking invalid: {}", e.toString(), e);
            result.addError("Error processing image: " + e.getMessage());
        }

        return result;
    }

    /** {width, height} read from the header, or null when no ImageIO reader understands the bytes. */
    static int[] headerDimensions(byte[] bytes) throws IOException {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (in == null) {
                return null;
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                return new int[]{reader.getWidth(0), reader.getHeight(0)};
            } finally {
                reader.dispose();
            }
        }
    }

    public static class ValidationResult {
        private boolean valid = true;
        private List<String> errors = new ArrayList<>();
        private int width;
        private int height;

        public void addError(String error) {
            this.valid = false;
            this.errors.add(error);
        }

        public boolean isValid() {
            return valid;
        }

        public List<String> getErrors() {
            return errors;
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
    }
}
