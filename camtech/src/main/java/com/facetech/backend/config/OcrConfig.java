package com.facetech.backend.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "ocr")
@Data
public class OcrConfig {
    private String provider;
    private GoogleConfig google;
    private PaddleConfig paddle;

    @Data
    public static class GoogleConfig {
        private String projectId;
        private String location;
        private String processorId;
        private String credentialsPath;
    }

    @Data
    public static class PaddleConfig {
        private String apiUrl;
        private String apiKey;
        private boolean enabled;
    }
}
