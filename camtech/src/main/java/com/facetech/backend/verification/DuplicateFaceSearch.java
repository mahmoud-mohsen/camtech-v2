package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.platform.CapabilitiesService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.FaceGallery;
import com.facetech.backend.platform.RequestContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 1:N search of a new selfie against every other person's registered face (DEDUP_SEARCH), so one face cannot
 * be registered under two identities. Used by the flows that register faces.
 */
@Service
@Slf4j
public class DuplicateFaceSearch {

    private final FaceGallery gallery;
    private final CapabilitiesService capabilities;
    private final ConfigService config;
    private final SessionSupport support;

    public DuplicateFaceSearch(FaceGallery gallery, CapabilitiesService capabilities,
                               ConfigService config, SessionSupport support) {
        this.gallery = gallery;
        this.capabilities = capabilities;
        this.config = config;
        this.support = support;
    }

    /** {@code otherPartyId}: the person the face already belongs to (null = no duplicate). */
    public record Result(Long otherPartyId, Double bestSimilarity, String threshold, int candidates) {
        public boolean duplicate() {
            return otherPartyId != null;
        }
    }

    /**
     * Null when the search does not apply: the DEDUP_SEARCH feature is not available to the app, dedup.enabled is
     * off, or the flow has no DEDUP_SEARCH step. {@code ownParties}: people the face may legitimately belong to.
     */
    public Result search(String flowCode, ConfigService.Scope scope, List<Double> embedding, Set<Long> ownParties,
                         String sessionRef) {
        if (!capabilities.duplicateSearchActive(RequestContext.get().getClientApp().getId(), scope)
                || !support.flowHasStep(flowCode, Codes.DEDUP_SEARCH)) {
            log.debug("{} {}: duplicate identity search not enabled, skipped", flowCode, sessionRef);
            return null;
        }
        double threshold = config.getDouble(ConfigKey.DEDUP_SIMILARITY, scope);
        Long best = null;
        double bestSim = -2;
        int candidates = 0;
        double[] probe = FaceGallery.toArray(embedding);
        for (FaceGallery.Entry t : gallery.enrolledSelfies(RequestContext.get().getTenantId())) {
            if (t.partyId() == null || ownParties.contains(t.partyId()) || t.dimension() != probe.length
                    || t.vector().length != probe.length) {
                continue;
            }
            candidates++;
            double sim = FaceGallery.cosine(probe, t.vector());
            if (sim > bestSim) {
                bestSim = sim;
                best = t.partyId();
            }
        }
        boolean dup = best != null && bestSim >= threshold;
        log.debug("{} {} duplicate search: {} candidates, bestSimilarity={} (threshold {}), bestParty={} -> duplicate={}",
                flowCode, sessionRef, candidates, candidates > 0 ? String.format(Locale.ROOT, "%.3f", bestSim) : null,
                LivenessEngine.fmt(threshold), best, dup);
        return new Result(dup ? best : null, candidates > 0 ? bestSim : null, LivenessEngine.fmt(threshold), candidates);
    }
}
