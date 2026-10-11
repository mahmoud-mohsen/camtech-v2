package com.facetech.backend.service;

import com.facetech.backend.exception.FaceMatchException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.SocketTimeoutException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * The single point of contact with face_embedding (the insightface
 * server-side embedding generator). Every embedding used for a match
 * decision comes from here - the backend never trusts a client-supplied
 * embedding.
 */
@Service
@Slf4j
public class FaceEmbeddingClient {

    public static final String ROLE_SELFIE = "selfie";
    public static final String ROLE_DOCUMENT = "document";

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    /** Calls in flight from this instance; more wait up to {@link #queueTimeoutMs}, then fail fast with 503. */
    private final Semaphore inFlight;
    private final long queueTimeoutMs;

    public FaceEmbeddingClient(
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            @Value("${facetech.face-match-service-url}") String baseUrl,
            @Value("${facetech.face-match-max-concurrent-calls:32}") int maxConcurrentCalls,
            @Value("${facetech.face-match-queue-timeout-ms:10000}") long queueTimeoutMs) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
        this.inFlight = new Semaphore(maxConcurrentCalls, true);
        this.queueTimeoutMs = queueTimeoutMs;
        log.info("Face embedding service URL: {} (max {} concurrent calls, queue timeout {} ms)", baseUrl,
                maxConcurrentCalls, queueTimeoutMs);
    }

    /** Embedding of the largest face plus the quality report for it. */
    public record EmbedResult(
            List<Double> embedding,
            String modelVersion,
            double detScore,
            int faceCount,
            double faceAreaRatio,
            boolean grayscale,
            List<String> issues) {
    }

    /** Best similarity of a reference image against one or more probes. */
    public record CompareResult(
            double bestSimilarity,
            int bestIndex,
            boolean grayscaleHarmonized,
            String modelVersion) {
    }

    public EmbedResult embed(byte[] imageBytes, String filename) {
        return embed(imageBytes, filename, ROLE_SELFIE);
    }

    public EmbedResult embed(byte[] imageBytes, String filename, String role) {
        requireImage(imageBytes);
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("image", resource(imageBytes, filename));
        body.add("role", role);

        JsonNode node = post("/embed", body);
        List<Double> embedding = new ArrayList<>();
        for (JsonNode v : node.get("embedding")) {
            embedding.add(v.asDouble());
        }
        List<String> issues = new ArrayList<>();
        if (node.has("issues")) {
            node.get("issues").forEach(i -> issues.add(i.asText()));
        }
        return new EmbedResult(
                embedding,
                node.get("model_version").asText(),
                node.path("det_score").asDouble(0.0),
                node.path("face_count").asInt(1),
                node.path("face_area_ratio").asDouble(0.0),
                node.path("is_grayscale").asBoolean(false),
                issues);
    }

    public CompareResult compare(byte[] referenceBytes, String referenceName, List<byte[]> probes) {
        requireImage(referenceBytes);
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("reference", resource(referenceBytes, referenceName));
        for (int i = 0; i < probes.size(); i++) {
            body.add("probes", resource(probes.get(i), "probe_" + i + ".jpg"));
        }

        JsonNode node = post("/compare", body);
        return new CompareResult(
                node.get("best_similarity").asDouble(),
                node.path("best_index").asInt(0),
                node.path("grayscale_harmonized").asBoolean(false),
                node.get("model_version").asText());
    }

    /**
     * One image measured for liveness; {@code error} set (and the rest null) when no face was found.
     * {@code headPitch} (degrees, positive = looking up) and {@code mouthRatio} only when landmarks were asked for.
     */
    public record FrameMeasure(int index, String error, int faceCount, Double yaw, Double ear, Double similarity,
                               Double antispoof, Double headPitch, Double mouthRatio, Double faceAreaRatio) {
    }

    /**
     * Liveness measurements. {@code passiveAvailable} false when the anti-spoof model is not installed
     * (scores are then null). {@code frames} are in the order sent.
     */
    public record LivenessMeasure(boolean passiveAvailable, String passiveModel, Double referenceAntispoof,
                                  List<FrameMeasure> frames) {
    }

    /**
     * Passive anti-spoof scores, head pose and similarity to {@code reference} for each frame; with
     * {@code landmarks} also eye openness, head pitch and mouth ratio. Returns null when the face service is
     * too old to have /liveness.
     */
    public LivenessMeasure liveness(byte[] reference, List<byte[]> frames, boolean landmarks) {
        requireImage(reference);
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("reference", resource(reference, "reference.jpg"));
        for (int i = 0; i < frames.size(); i++) {
            body.add("frames", resource(frames.get(i), "frame_" + i + ".jpg"));
        }
        // "eyes" is what face-embedding versions before "landmarks" understand (eye openness only).
        body.add("landmarks", String.valueOf(landmarks));
        body.add("eyes", String.valueOf(landmarks));
        JsonNode node;
        try {
            node = post("/liveness", body);
        } catch (FaceMatchException e) {
            if (e.getCause() instanceof HttpStatusCodeException http && http.getStatusCode().value() == 404) {
                log.warn("The face service has no /liveness endpoint: passive and active liveness cannot be measured");
                return null;
            }
            throw e;
        }
        List<FrameMeasure> measures = new ArrayList<>();
        for (JsonNode f : node.path("frames")) {
            JsonNode err = f.get("error");
            measures.add(new FrameMeasure(f.path("index").asInt(), err != null ? err.path("code").asText("NO_FACE") : null,
                    f.path("face_count").asInt(0), num(f, "yaw"), num(f, "ear"), num(f, "similarity"),
                    num(f.path("antispoof"), "score"), num(f, "head_pitch"), num(f, "mouth_ratio"),
                    num(f, "face_area_ratio")));
        }
        JsonNode status = node.path("antispoof");
        return new LivenessMeasure(status.path("available").asBoolean(false),
                status.path("model_version").isTextual() ? status.get("model_version").asText() : null,
                num(node.path("reference").path("antispoof"), "score"), measures);
    }

    private static Double num(JsonNode node, String field) {
        JsonNode v = node == null ? null : node.get(field);
        return v == null || v.isNull() || !v.isNumber() ? null : v.asDouble();
    }

    private JsonNode post(String path, MultiValueMap<String, Object> body) {
        boolean acquired;
        try {
            acquired = inFlight.tryAcquire(queueTimeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            acquired = false;
        }
        if (!acquired) {
            log.warn("Face service POST {} not sent: no free call slot within {} ms", path, queueTimeoutMs);
            throw new FaceMatchException(HttpStatus.SERVICE_UNAVAILABLE, "FACE_SERVICE_UNAVAILABLE",
                    "Face match service is busy, try again shortly");
        }
        try {
            return send(path, body);
        } finally {
            inFlight.release();
        }
    }

    private JsonNode send(String path, MultiValueMap<String, Object> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(body, headers);

        // One retry on connection problems (service restarting, transient
        // network error). HTTP error responses and read timeouts are not
        // retried: a timed-out call is still running on a busy face service.
        long payloadBytes = payloadBytes(body);
        for (int attempt = 1; ; attempt++) {
            long start = System.currentTimeMillis();
            try {
                String json = restTemplate.postForObject(baseUrl + path, request, String.class);
                JsonNode node = objectMapper.readTree(json);
                log.debug("Face service POST {} ok: {} bytes sent, attempt {}, {} ms",
                        path, payloadBytes, attempt, System.currentTimeMillis() - start);
                return node;
            } catch (HttpStatusCodeException e) {
                log.warn("Face service POST {} returned HTTP {} after {} ms ({} bytes sent)",
                        path, e.getStatusCode().value(), System.currentTimeMillis() - start, payloadBytes);
                throw toFaceMatchException(e);
            } catch (ResourceAccessException e) {
                if (attempt >= 2 || isReadTimeout(e)) {
                    log.error("Face service POST {} unreachable after {} attempts ({} ms): {}",
                            path, attempt, System.currentTimeMillis() - start, e.toString());
                    throw new FaceMatchException(HttpStatus.SERVICE_UNAVAILABLE, "FACE_SERVICE_UNAVAILABLE",
                            "Face match service is unavailable", e);
                }
                log.warn("Face match service call {} failed ({}), retrying once", path, e.getMessage());
            } catch (Exception e) {
                log.error("Face service POST {} response could not be processed after {} ms: {}",
                        path, System.currentTimeMillis() - start, e.toString());
                throw new FaceMatchException(HttpStatus.BAD_GATEWAY, "FACE_SERVICE_ERROR",
                        "Failed to process face match service response", e);
            }
        }
    }

    private static boolean isReadTimeout(ResourceAccessException e) {
        Throwable c = e.getCause();
        if (c instanceof HttpConnectTimeoutException) {
            return false;
        }
        return c instanceof HttpTimeoutException
                || (c instanceof SocketTimeoutException && !String.valueOf(c.getMessage()).toLowerCase().contains("connect"));
    }

    private static long payloadBytes(MultiValueMap<String, Object> body) {
        long total = 0;
        for (List<Object> values : body.values()) {
            for (Object v : values) {
                if (v instanceof ByteArrayResource r) {
                    total += r.contentLength();
                }
            }
        }
        return total;
    }

    private FaceMatchException toFaceMatchException(HttpStatusCodeException e) {
        String detail = null;
        String code = null;
        try {
            JsonNode err = objectMapper.readTree(e.getResponseBodyAsString());
            detail = err.path("detail").isTextual() ? err.get("detail").asText() : null;
            code = err.path("code").isTextual() ? err.get("code").asText() : null;
        } catch (Exception ignore) {
            // non-JSON error body
        }
        int status = e.getStatusCode().value();
        if (status == 503 || status == 429) {
            return new FaceMatchException(HttpStatus.SERVICE_UNAVAILABLE, "FACE_SERVICE_UNAVAILABLE",
                    "Face match service is busy, try again shortly", e);
        }
        if (status == 422 || status == 400) {
            return new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY,
                    code != null ? code : "NO_FACE",
                    detail != null ? detail : "No face detected in image");
        }
        return new FaceMatchException(HttpStatus.BAD_GATEWAY, "FACE_SERVICE_ERROR",
                "Face match service rejected the image: " + (detail != null ? detail : e.getStatusCode()), e);
    }

    private static void requireImage(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "EMPTY_IMAGE", "Empty image upload");
        }
    }

    private static ByteArrayResource resource(byte[] bytes, String filename) {
        return new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return filename != null ? filename : "image.jpg";
            }
        };
    }
}
