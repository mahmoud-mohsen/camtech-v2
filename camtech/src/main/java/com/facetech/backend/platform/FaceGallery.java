package com.facetech.backend.platform;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.repository.FaceTemplateRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The ENROLLED selfie templates of a tenant, decoded once and kept in memory for 1:N searches (identify, duplicate
 * search). Each call reads only the (id, row_version) list from the database, so templates registered, revoked or
 * changed on another replica are seen right away; only new or changed vectors are loaded.
 */
@Service
@Slf4j
public class FaceGallery {

    /** Oracle allows at most 1000 values in an IN list. */
    private static final int LOAD_CHUNK = 1000;

    /** One registered face, vector as float32. */
    public record Entry(long id, long rowVersion, Long partyId, String pose, String modelVersion, int dimension,
                        float[] vector) {
    }

    private final FaceTemplateRepository templates;
    private final Map<Long, Map<Long, Entry>> byTenant = new ConcurrentHashMap<>();

    public FaceGallery(FaceTemplateRepository templates) {
        this.templates = templates;
    }

    /** The tenant's ENROLLED SELFIE templates, up to date with the database. */
    public Collection<Entry> enrolledSelfies(Long tenantId) {
        List<Object[]> refs = templates.findRefsByTenantIdAndStatusAndRole(tenantId, Codes.TemplateStatus.ENROLLED,
                Codes.TemplateRole.SELFIE);
        Map<Long, Entry> cached = byTenant.getOrDefault(tenantId, Map.of());
        Map<Long, Entry> fresh = new HashMap<>(refs.size() * 2);
        List<Long> missing = new ArrayList<>();
        for (Object[] r : refs) {
            long id = ((Number) r[0]).longValue();
            long version = ((Number) r[1]).longValue();
            Entry e = cached.get(id);
            if (e != null && e.rowVersion() == version) {
                fresh.put(id, e);
            } else {
                missing.add(id);
            }
        }
        for (int i = 0; i < missing.size(); i += LOAD_CHUNK) {
            for (FaceTemplate t : templates.findByIdIn(missing.subList(i, Math.min(i + LOAD_CHUNK, missing.size())))) {
                if (t.getStatus() == Codes.TemplateStatus.ENROLLED && t.getRole() == Codes.TemplateRole.SELFIE) {
                    fresh.put(t.getId(), new Entry(t.getId(), t.getRowVersion(), t.getPartyId(), t.getPose(),
                            t.getModelVersion(), t.getDimension(), decode(t.getVector())));
                }
            }
        }
        byTenant.put(tenantId, fresh);
        log.debug("Face gallery tenant {}: {} templates ({} loaded from the database)", tenantId, fresh.size(),
                missing.size());
        return fresh.values();
    }

    public static float[] decode(byte[] bytes) {
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] out = new float[bytes.length / Float.BYTES];
        for (int i = 0; i < out.length; i++) {
            out[i] = buf.getFloat();
        }
        return out;
    }

    public static double[] toArray(List<Double> embedding) {
        double[] out = new double[embedding.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = embedding.get(i);
        }
        return out;
    }

    /** Same result as EmbeddingCodec.cosine on the decoded lists. */
    public static double cosine(double[] a, float[] b) {
        double dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += (double) b[i] * b[i];
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    /** Same result as EmbeddingUtils.euclideanDistance on the decoded lists. */
    public static double euclidean(double[] a, float[] b) {
        double sum = 0;
        for (int i = 0; i < a.length; i++) {
            double d = a[i] - b[i];
            sum += d * d;
        }
        return Math.sqrt(sum);
    }

    /** Same rule as FaceService.isDegenerateEmbedding. */
    public static boolean isDegenerate(float[] v) {
        if (v.length == 0) {
            return true;
        }
        double sumSq = 0;
        boolean allSame = true;
        for (float x : v) {
            if (!Float.isFinite(x)) {
                return true;
            }
            if (Math.abs((double) x - v[0]) > 1e-9) {
                allSame = false;
            }
            sumSq += (double) x * x;
        }
        return allSame || sumSq < 1e-8;
    }
}
