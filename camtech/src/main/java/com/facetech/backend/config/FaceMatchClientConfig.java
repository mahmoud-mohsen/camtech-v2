package com.facetech.backend.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.net.http.HttpClient;
import java.time.Duration;

@Configuration
@Slf4j
public class FaceMatchClientConfig {

    /**
     * JDK HttpClient: keeps connections to the face service alive and reuses them. HTTP/1.1 only, the face service
     * (uvicorn) does not speak h2c.
     */
    @Bean
    public RestTemplate faceMatchRestTemplate(
            RestTemplateBuilder builder,
            @Value("${facetech.face-match-read-timeout-seconds:30}") int readTimeoutSeconds) {
        log.info("Face match RestTemplate: connect timeout 5s, read timeout {}s", readTimeoutSeconds);
        HttpClient client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofSeconds(readTimeoutSeconds));
        return builder.requestFactory(() -> factory).build();
    }
}
