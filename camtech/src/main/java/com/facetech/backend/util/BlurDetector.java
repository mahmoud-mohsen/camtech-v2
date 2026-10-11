package com.facetech.backend.util;

import lombok.extern.slf4j.Slf4j;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfDouble;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;
import org.springframework.stereotype.Component;

@Component
@Slf4j
public class BlurDetector {

    private static final double BLUR_THRESHOLD = 100.0;

    static {
        try {
            nu.pattern.OpenCV.loadLocally();
        } catch (Exception e) {
            log.error("Failed to load OpenCV library: {}", e.toString(), e);
        }
    }

    public BlurDetectionResult detectBlur(byte[] imageData) {
        BlurDetectionResult result = new BlurDetectionResult();
        
        // Native memory: every Mat is released in finally, also when OpenCV throws.
        MatOfByte encoded = new MatOfByte(imageData);
        Mat image = null;
        Mat laplacian = new Mat();
        MatOfDouble mean = new MatOfDouble();
        MatOfDouble stddev = new MatOfDouble();
        try {
            image = Imgcodecs.imdecode(encoded, Imgcodecs.IMREAD_GRAYSCALE);

            if (image.empty()) {
                log.warn("Blur detection: failed to decode image ({} bytes)", imageData.length);
                result.setError("Failed to decode image");
                return result;
            }

            Imgproc.Laplacian(image, laplacian, CvType.CV_64F);
            Core.meanStdDev(laplacian, mean, stddev);

            double variance = Math.pow(stddev.get(0, 0)[0], 2);

            result.setBlurScore(variance);
            result.setBlurred(variance < BLUR_THRESHOLD);
            result.setConfidence(calculateConfidence(variance));
            log.debug("Blur detection: variance={}, blurred={}, threshold={}", variance, variance < BLUR_THRESHOLD,
                    BLUR_THRESHOLD);

        } catch (Exception e) {
            log.warn("Error detecting blur, returning error result: {}", e.toString());
            result.setError("Error processing image for blur detection");
        } finally {
            encoded.release();
            if (image != null) {
                image.release();
            }
            laplacian.release();
            mean.release();
            stddev.release();
        }

        return result;
    }

    private double calculateConfidence(double variance) {
        if (variance >= BLUR_THRESHOLD * 2) {
            return 1.0;
        } else if (variance >= BLUR_THRESHOLD) {
            return 0.5 + ((variance - BLUR_THRESHOLD) / BLUR_THRESHOLD) * 0.5;
        } else {
            return (variance / BLUR_THRESHOLD) * 0.5;
        }
    }

    public static class BlurDetectionResult {
        private boolean blurred;
        private double blurScore;
        private double confidence;
        private String error;

        public boolean isBlurred() {
            return blurred;
        }

        public void setBlurred(boolean blurred) {
            this.blurred = blurred;
        }

        public double getBlurScore() {
            return blurScore;
        }

        public void setBlurScore(double blurScore) {
            this.blurScore = blurScore;
        }

        public double getConfidence() {
            return confidence;
        }

        public void setConfidence(double confidence) {
            this.confidence = confidence;
        }

        public String getError() {
            return error;
        }

        public void setError(String error) {
            this.error = error;
        }

        public boolean hasError() {
            return error != null && !error.isEmpty();
        }
    }
}
