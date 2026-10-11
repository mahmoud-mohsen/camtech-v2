package com.facetech.backend.platform;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;

/** Face embeddings as little-endian float32 bytes (the face_template.vector BLOB). */
public final class EmbeddingCodec {

    private EmbeddingCodec() {
    }

    public static byte[] encode(List<Double> embedding) {
        ByteBuffer buf = ByteBuffer.allocate(embedding.size() * Float.BYTES).order(ByteOrder.LITTLE_ENDIAN);
        for (Double v : embedding) {
            buf.putFloat(v.floatValue());
        }
        return buf.array();
    }

    public static List<Double> decode(byte[] bytes) {
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        List<Double> out = new ArrayList<>(bytes.length / Float.BYTES);
        while (buf.remaining() >= Float.BYTES) {
            out.add((double) buf.getFloat());
        }
        return out;
    }

    public static double cosine(List<Double> a, List<Double> b) {
        if (a.size() != b.size()) {
            throw new IllegalArgumentException("Embeddings have different sizes: " + a.size() + " vs " + b.size());
        }
        double dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.size(); i++) {
            dot += a.get(i) * b.get(i);
            na += a.get(i) * a.get(i);
            nb += b.get(i) * b.get(i);
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
}
