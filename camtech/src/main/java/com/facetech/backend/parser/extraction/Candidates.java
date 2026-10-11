package com.facetech.backend.parser.extraction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Every value read for each field, before one is chosen. */
public final class Candidates {

    private final Map<String, List<FieldCandidate>> byField = new LinkedHashMap<>();

    /** Adds a candidate; blank values are ignored. */
    public void add(String field, String value, ExtractionSource source) {
        if (value == null || value.isBlank()) {
            return;
        }
        List<FieldCandidate> list = byField.computeIfAbsent(field, k -> new ArrayList<>());
        String v = value.strip();
        boolean known = list.stream().anyMatch(c -> c.value().equals(v) && c.source() == source);
        if (!known) {
            list.add(new FieldCandidate(v, source));
        }
    }

    /** Candidates of a field, most trusted source first. */
    public List<FieldCandidate> get(String field) {
        List<FieldCandidate> list = new ArrayList<>(byField.getOrDefault(field, List.of()));
        list.sort(Comparator.comparingDouble((FieldCandidate c) -> c.source().weight()).reversed());
        return list;
    }

    public boolean has(String field) {
        return byField.containsKey(field);
    }

    public Iterable<String> fields() {
        return List.copyOf(byField.keySet());
    }
}
