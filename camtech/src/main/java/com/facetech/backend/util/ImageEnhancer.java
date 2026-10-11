package com.facetech.backend.util;

import lombok.extern.slf4j.Slf4j;
import org.opencv.core.*;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;
import org.springframework.stereotype.Component;


@Component
@Slf4j
public class ImageEnhancer {

    static {
        try {
            nu.pattern.OpenCV.loadLocally();
        } catch (Exception e) {
            log.error("Failed to load OpenCV library: {}", e.toString(), e);
        }
    }

    public byte[] enhanceDocument(byte[] imageData) {
        long start = System.currentTimeMillis();
        // Native memory: every Mat is released in finally, also when OpenCV throws.
        MatOfByte encoded = new MatOfByte(imageData);
        Mat image = null;
        Mat gray = new Mat();
        Mat denoised = new Mat();
        Mat sharpened = null;
        Mat normalized = new Mat();
        Mat binary = new Mat();
        MatOfByte matOfByte = new MatOfByte();
        try {
            image = Imgcodecs.imdecode(encoded, Imgcodecs.IMREAD_COLOR);

            if (image.empty()) {
                log.warn("Image enhancement: failed to decode image ({} bytes), returning original", imageData.length);
                return imageData;
            }

            Imgproc.cvtColor(image, gray, Imgproc.COLOR_BGR2GRAY);
            Imgproc.GaussianBlur(gray, denoised, new Size(5, 5), 0);
            sharpened = sharpenImage(denoised);
            Core.normalize(sharpened, normalized, 0, 255, Core.NORM_MINMAX);
            Imgproc.adaptiveThreshold(normalized, binary, 255,
                    Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
                    Imgproc.THRESH_BINARY, 11, 2);

            Imgcodecs.imencode(".jpg", binary, matOfByte);
            byte[] result = matOfByte.toArray();

            log.debug("Image enhanced in {}ms ({} -> {} bytes)", System.currentTimeMillis() - start,
                    imageData.length, result.length);
            return result;

        } catch (Exception e) {
            log.warn("Error enhancing image, returning original: {}", e.toString());
            return imageData;
        } finally {
            encoded.release();
            if (image != null) {
                image.release();
            }
            gray.release();
            denoised.release();
            if (sharpened != null) {
                sharpened.release();
            }
            normalized.release();
            binary.release();
            matOfByte.release();
        }
    }

    private Mat sharpenImage(Mat image) {
        Mat sharpened = new Mat();
        Mat kernel = new Mat(3, 3, CvType.CV_32F);
        
        kernel.put(0, 0, 0, -1, 0);
        kernel.put(1, 0, -1, 5, -1);
        kernel.put(2, 0, 0, -1, 0);

        try {
            Imgproc.filter2D(image, sharpened, -1, kernel);
        } finally {
            kernel.release();
        }
        return sharpened;
    }

}
