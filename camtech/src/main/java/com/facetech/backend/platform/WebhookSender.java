package com.facetech.backend.platform;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.WebhookDelivery;
import com.facetech.backend.domain.WebhookSubscription;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;

/**
 * POSTs one event to one webhook. The body is signed with HMAC-SHA256 using
 * the subscription secret: header {@code X-Camtech-Signature: t=<unix>,v1=<hex>}
 * over {@code "<unix>.<body>"}. Failed deliveries are retried with
 * increasing delays (30s, 2m, 10m, 30m, 2h) until max attempts.
 */
@Component
@Slf4j
public class WebhookSender {

    private static final long[] BACKOFF_SECONDS = {30, 120, 600, 1800, 7200};

    private final HttpClient http;
    private final CamtechProperties.Jobs settings;

    public WebhookSender(CamtechProperties properties) {
        this.settings = properties.getJobs();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        log.info("Webhooks: connect timeout 5s, request timeout {}s, max attempts {}",
                settings.getWebhookTimeoutSeconds(), settings.getWebhookMaxAttempts());
    }

    /** Sends and updates the delivery row (attempt, status, next retry). */
    public void send(WebhookSubscription sub, WebhookDelivery delivery, String body) {
        long ts = Instant.now().getEpochSecond();
        delivery.setAttempt(delivery.getAttempt() + 1);
        long start = System.currentTimeMillis();
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(sub.getUrl()))
                    .timeout(Duration.ofSeconds(settings.getWebhookTimeoutSeconds()))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "camtech-webhooks/1")
                    .header("X-Camtech-Event", delivery.getEventType())
                    .header("X-Camtech-Delivery", String.valueOf(delivery.getId()))
                    .header("X-Camtech-Signature", "t=" + ts + ",v1=" + sign(sub.getSecret(), ts + "." + body))
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            delivery.setHttpStatus(response.statusCode());
            log.debug("Webhook POST to {} (subscription {}, delivery {}, event {}): {} bytes, HTTP {}, {} ms",
                    endpoint(sub.getUrl()), sub.getId(), delivery.getId(), delivery.getEventType(),
                    body.getBytes(StandardCharsets.UTF_8).length, response.statusCode(),
                    System.currentTimeMillis() - start);
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                log.info("Webhook delivery {} ({}) delivered to subscription {} on attempt {}",
                        delivery.getId(), delivery.getEventType(), sub.getId(), delivery.getAttempt());
                delivery.setStatus(Codes.DeliveryStatus.DELIVERED);
                delivery.setDeliveredAt(Instant.now());
                delivery.setErrorMessage(null);
                delivery.setNextRetryAt(null);
                return;
            }
            failed(delivery, "HTTP " + response.statusCode());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            failed(delivery, "Interrupted");
        } catch (Exception e) {
            log.warn("Webhook POST to {} (delivery {}) failed after {} ms: {}",
                    endpoint(sub.getUrl()), delivery.getId(), System.currentTimeMillis() - start, e.toString());
            failed(delivery, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** Scheme, host and path of a webhook URL: never the query string, which may carry credentials. */
    private static String endpoint(String url) {
        try {
            URI u = URI.create(url);
            return u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "")
                    + (u.getPath() != null ? u.getPath() : "");
        } catch (Exception e) {
            return "<invalid url>";
        }
    }

    private void failed(WebhookDelivery d, String error) {
        d.setErrorMessage(error != null && error.length() > 1000 ? error.substring(0, 1000) : error);
        if (d.getAttempt() >= settings.getWebhookMaxAttempts()) {
            d.setStatus(Codes.DeliveryStatus.FAILED);
            d.setNextRetryAt(null);
            log.warn("Webhook delivery {} ({}) attempt {} failed: {}; giving up after max attempts",
                    d.getId(), d.getEventType(), d.getAttempt(), error);
        } else {
            long delay = BACKOFF_SECONDS[Math.min(d.getAttempt() - 1, BACKOFF_SECONDS.length - 1)];
            d.setStatus(Codes.DeliveryStatus.RETRYING);
            d.setNextRetryAt(Instant.now().plusSeconds(delay));
            log.info("Webhook delivery {} ({}) attempt {} failed: {}; retrying in {}s",
                    d.getId(), d.getEventType(), d.getAttempt(), error, delay);
        }
    }

    public static String sign(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Could not sign webhook", e);
        }
    }
}
