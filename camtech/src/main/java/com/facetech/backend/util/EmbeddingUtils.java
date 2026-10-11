package com.facetech.backend.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

public class EmbeddingUtils {

    private static final ObjectMapper mapper = new ObjectMapper();

    public static String toJson(List<Double> embedding) {
        try {
            return mapper.writeValueAsString(embedding);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize embedding", e);
        }
    }

    public static List<Double> fromJson(String json) {
        if (json == null) {
            throw new RuntimeException("Failed to deserialize embedding: null");
        }

        // First, try standard JSON list, e.g. "[0.1, 0.2, ...]".
        try {
            return mapper.readValue(json, new TypeReference<List<Double>>() {});
        } catch (Exception ignore) {
            // fall through to legacy formats
        }

        // Fallback: handle simple Postgres array-like text, e.g. "{0.1,0.2,0.3}".
        String trimmed = json.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            trimmed = trimmed.substring(1, trimmed.length() - 1);
        }
        if (trimmed.isEmpty()) {
            throw new RuntimeException("Failed to deserialize embedding: empty content");
        }

        String[] parts = trimmed.split(",");
        List<Double> result = new ArrayList<>(parts.length);
        try {
            for (String p : parts) {
                String s = p.trim();
                if (s.isEmpty()) continue;
                result.add(Double.parseDouble(s));
            }
        } catch (NumberFormatException e) {
            throw new RuntimeException("Failed to deserialize embedding from legacy format", e);
        }
        return result;
    }

    public static double euclideanDistance(List<Double> a, List<Double> b) {
        if (a == null || b == null || a.size() != b.size()) {
            throw new IllegalArgumentException("Embeddings must be non-null and of same length");
        }
        double sum = 0.0;
        for (int i = 0; i < a.size(); i++) {
            double diff = a.get(i) - b.get(i);
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    public static double distanceToConfidence(double distance, double threshold) {
        if (threshold <= 0) {
            return 0.0;
        }
        double normalized = 1.0 - Math.min(distance / threshold, 1.0);
        return round(normalized, 6);
    }

    public static double round(double value, int places) {
        if (places < 0) throw new IllegalArgumentException("places must be >= 0");
        double factor = Math.pow(10, places);
        return Math.round(value * factor) / factor;
    }
}
