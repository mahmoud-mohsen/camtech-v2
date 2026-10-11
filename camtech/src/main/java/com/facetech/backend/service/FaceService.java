package com.facetech.backend.service;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.dto.FaceDtos;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EmbeddingCodec;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.FaceGallery;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.storage.MediaKeys;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.util.EmbeddingUtils;
import com.facetech.backend.verification.PartyService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Legacy face endpoints (/onboarding/face/register, /face/identify,
 * /face/verify, /face/compare) on the new model: registrations are ENROLLED
 * face templates of a party. Embeddings are always generated server-side.
 */
@Service
@Slf4j
public class FaceService {

    /** Poses used for 1:N identification (front-facing captures only, as before). */
    private static final Set<String> IDENTIFY_POSES = Set.of("front", "normal");

    private final PartyRepository partyRepository;
    private final IdentityDocumentRepository documentRepository;
    private final FaceTemplateRepository templateRepository;
    private final PartyService parties;
    private final FaceEmbeddingClient faceEmbeddingClient;
    private final MediaStorageService media;
    private final ConfigService config;
    private final EntitlementService entitlements;
    private final AuditService audit;
    private final FaceGallery gallery;
    private final TransactionTemplate tx;
    private final String defaultModelVersion;

    public FaceService(PartyRepository partyRepository, IdentityDocumentRepository documentRepository,
                       FaceTemplateRepository templateRepository, PartyService parties,
                       FaceEmbeddingClient faceEmbeddingClient, MediaStorageService media, ConfigService config,
                       EntitlementService entitlements, AuditService audit, FaceGallery gallery,
                       PlatformTransactionManager txManager,
                       @Value("${facetech.model-version-default}") String defaultModelVersion) {
        this.partyRepository = partyRepository;
        this.documentRepository = documentRepository;
        this.templateRepository = templateRepository;
        this.parties = parties;
        this.faceEmbeddingClient = faceEmbeddingClient;
        this.media = media;
        this.config = config;
        this.entitlements = entitlements;
        this.audit = audit;
        this.gallery = gallery;
        this.tx = new TransactionTemplate(txManager);
        this.defaultModelVersion = defaultModelVersion;
    }

    public record Registered(Party party, FaceTemplate template, MediaFile media) {
    }

    /**
     * Registers a face from an uploaded image for the person given by user_id or name. The face service is called
     * before the transaction, so no database connection is held while it works.
     */
    public Registered registerFace(FaceDtos.FaceRegisterRequest request, byte[] imageBytes, String filename) {
        entitlements.require(Codes.FeatureType.FLOW, Codes.FLOW_ONBOARDING);
        FaceEmbeddingClient.EmbedResult embedResult = faceEmbeddingClient.embed(imageBytes, filename);
        return tx.execute(status -> register(request, imageBytes, embedResult));
    }

    private Registered register(FaceDtos.FaceRegisterRequest request, byte[] imageBytes,
                                FaceEmbeddingClient.EmbedResult embedResult) {
        Party party = resolveForRegistration(request);
        log.info("Registering face for party {} (imageSizeBytes={})", party.getPublicId(), imageBytes.length);
        if (isDegenerateEmbedding(embedResult.embedding())) {
            log.warn("Face registration for party {}: degenerate embedding returned (model={})",
                    party.getPublicId(), embedResult.modelVersion());
            throw new IllegalStateException("Face match service returned an invalid embedding");
        }
        String pose = request.getPose() != null && !request.getPose().isBlank() ? request.getPose() : "front";
        MediaFile m = media.store(imageBytes, Codes.MediaCategory.VERIFIED_MEDIA, true,
                MediaKeys.onboardingFile(party.getPublicId(), "face", pose));
        FaceTemplate t = new FaceTemplate();
        t.setTenantId(party.getTenantId());
        t.setPartyId(party.getId());
        t.setSourceMediaId(m.getId());
        t.setRole(Codes.TemplateRole.SELFIE);
        t.setPose(pose);
        t.setModelVersion(embedResult.modelVersion());
        t.setDimension(embedResult.embedding().size());
        t.setVector(EmbeddingCodec.encode(embedResult.embedding()));
        t.setQualityScore(embedResult.detScore() > 0
                ? BigDecimal.valueOf(embedResult.detScore()).setScale(6, RoundingMode.HALF_UP) : null);
        t.setStatus(Codes.TemplateStatus.ENROLLED);
        templateRepository.save(t);
        audit.record("FACE_REGISTERED", "party", party.getPublicId(), Map.of("pose", pose));
        log.info("Face registered for party {}: templateId={}, pose={}, model={}, dimension={}, detScore={}",
                party.getPublicId(), t.getId(), pose, embedResult.modelVersion(), t.getDimension(),
                embedResult.detScore());
        return new Registered(party, t, m);
    }

    private Party resolveForRegistration(FaceDtos.FaceRegisterRequest request) {
        String name = request.getName() != null ? request.getName().trim() : null;
        if (request.getUserId() != null) {
            log.debug("Resolving face registration party by userId={}", request.getUserId());
            Party party = partyRepository.findById(request.getUserId())
                    .orElseThrow(() -> new IllegalArgumentException("User not found"));
            if (name != null && !name.isEmpty() && !name.equals(party.getExternalRef())) {
                parties.findByExternalRef(name)
                        .filter(existing -> !existing.getId().equals(party.getId()))
                        .ifPresent(existing -> {
                            throw new IllegalArgumentException("User name already exists");
                        });
                party.setExternalRef(name);
            }
            return party;
        }
        if (name != null && !name.isEmpty()) {
            log.debug("Resolving face registration party by name (find or create)");
            return parties.findOrCreatePerson(name);
        }
        throw new IllegalArgumentException("Missing user_id or name");
    }

    public FaceDtos.FaceIdentifyResponse identifyFace(byte[] imageBytes, String filename) {
        entitlements.require(Codes.FeatureType.FLOW, Codes.FLOW_FACE_IDENTIFICATION);
        long t0 = System.currentTimeMillis();
        List<Double> probe = faceEmbeddingClient.embed(imageBytes, filename).embedding();
        if (isDegenerateEmbedding(probe)) {
            log.warn("Face identify: degenerate probe embedding returned");
            throw new IllegalStateException("Face match service returned an invalid embedding for identify");
        }
        Collection<FaceGallery.Entry> all = gallery.enrolledSelfies(RequestContext.get().getTenantId());
        if (all.isEmpty()) {
            throw new IllegalStateException("No registrations available");
        }
        double[] probeArr = FaceGallery.toArray(probe);
        FaceGallery.Entry best = null;
        double bestDistance = Double.POSITIVE_INFINITY;
        int compared = 0;
        for (FaceGallery.Entry t : all) {
            if (!defaultModelVersion.equals(t.modelVersion()) || t.partyId() == null
                    || (t.pose() != null && !IDENTIFY_POSES.contains(t.pose().toLowerCase()))
                    || t.dimension() != probe.size() || t.vector().length != probe.size()) {
                continue;
            }
            if (FaceGallery.isDegenerate(t.vector())) {
                continue;
            }
            compared++;
            double d = FaceGallery.euclidean(probeArr, t.vector());
            if (d < bestDistance) {
                bestDistance = d;
                best = t;
            }
        }
        log.debug("Face identify: compared probe against {} of {} enrolled templates (model={})",
                compared, all.size(), defaultModelVersion);
        if (best == null) {
            throw new IllegalStateException("No compatible registrations available");
        }
        double threshold = config.getDouble(ConfigKey.LEGACY_DISTANCE_THRESHOLD, ConfigService.Scope.BASE);
        boolean match = bestDistance <= threshold;
        log.info("Face identify finished in {}ms: match={}, bestDistance={}, threshold={}, matchedPartyId={}",
                System.currentTimeMillis() - t0, match, EmbeddingUtils.round(bestDistance, 6), threshold,
                match ? best.partyId() : null);
        FaceDtos.FaceIdentifyResponse resp = new FaceDtos.FaceIdentifyResponse();
        resp.setMatch(match);
        resp.setDistance(EmbeddingUtils.round(bestDistance, 6));
        resp.setConfidence(EmbeddingUtils.distanceToConfidence(bestDistance, threshold));
        resp.setMatchedModelVersion(best.modelVersion());
        if (match) {
            Party p = partyRepository.findById(best.partyId()).orElseThrow();
            resp.setUserId(p.getId());
            resp.setUserName(p.getExternalRef());
        }
        return resp;
    }

    public FaceDtos.FaceVerifyResponse verifyByEmiratesIdOrUsername(
            FaceDtos.FaceVerifyByIdentifierRequest request, byte[] imageBytes, String filename) {
        Party party = null;
        String eid = PartyService.normalizeNumber("EMIRATES_ID", request.getEmiratesIdNumber());
        if (eid != null) {
            party = parties.findDocument("EMIRATES_ID", "ARE", eid)
                    .map(IdentityDocument::getPartyId).filter(Objects::nonNull)
                    .flatMap(partyRepository::findById).orElse(null);
        }
        if (party == null && request.getUsername() != null && !request.getUsername().isEmpty()) {
            log.debug("Face verify: party not resolved by Emirates ID, falling back to username lookup");
            party = parties.findByExternalRef(request.getUsername()).orElse(null);
        }
        if (party == null) {
            throw new IllegalArgumentException("User not found (no matching Emirates ID or username)");
        }
        log.info("Face verify started for party {}", party.getPublicId());
        List<Double> probe = faceEmbeddingClient.embed(imageBytes, filename).embedding();
        if (isDegenerateEmbedding(probe)) {
            log.warn("Face verify for party {}: degenerate probe embedding returned", party.getPublicId());
            throw new IllegalStateException("Face match service returned an invalid embedding for verify");
        }
        List<FaceTemplate> templates = templateRepository.findByPartyIdAndStatusAndRole(
                party.getId(), Codes.TemplateStatus.ENROLLED, Codes.TemplateRole.SELFIE);
        if (templates.isEmpty()) {
            throw new IllegalStateException("No registration for user");
        }
        FaceTemplate best = null;
        double bestDistance = Double.POSITIVE_INFINITY;
        for (FaceTemplate t : templates) {
            // Templates from a retired model are not comparable and force re-registration.
            if (!defaultModelVersion.equals(t.getModelVersion()) || t.getDimension() != probe.size()) {
                continue;
            }
            double d = EmbeddingUtils.euclideanDistance(probe, EmbeddingCodec.decode(t.getVector()));
            if (d < bestDistance) {
                bestDistance = d;
                best = t;
            }
        }
        if (best == null) {
            log.warn("Face verify for party {}: none of {} templates match model {} / dimension {}",
                    party.getPublicId(), templates.size(), defaultModelVersion, probe.size());
            throw new IllegalStateException("No compatible registration embeddings for user");
        }
        double threshold = config.getDouble(ConfigKey.LEGACY_DISTANCE_THRESHOLD, ConfigService.Scope.BASE);
        log.info("Face verify for party {}: match={}, bestDistance={}, threshold={}, templatesConsidered={}",
                party.getPublicId(), bestDistance <= threshold, EmbeddingUtils.round(bestDistance, 6), threshold,
                templates.size());
        FaceDtos.FaceVerifyResponse resp = new FaceDtos.FaceVerifyResponse();
        resp.setMatch(bestDistance <= threshold);
        resp.setDistance(EmbeddingUtils.round(bestDistance, 6));
        resp.setConfidence(EmbeddingUtils.distanceToConfidence(bestDistance, threshold));
        resp.setMatchedModelVersion(best.getModelVersion());
        resp.setUserId(party.getId());
        resp.setUserName(party.getExternalRef());
        return resp;
    }

    /**
     * Stateless pairwise comparison between two uploaded images (e.g. a live
     * selfie and an Emirates ID photo). Uses the same decision bands as the
     * selfie ID verification flow. Nothing is stored.
     */
    public FaceDtos.FaceCompareResponse compareFaces(byte[] imageABytes, String filenameA, byte[] imageBBytes, String filenameB) {
        entitlements.require(Codes.FeatureType.FEATURE, Codes.FEATURE_FACE_COMPARE);
        FaceEmbeddingClient.CompareResult result = faceEmbeddingClient.compare(imageBBytes, filenameB, List.of(imageABytes));
        ConfigService.Scope scope = ConfigService.Scope.BASE;
        FaceMatchScoring scoring = new FaceMatchScoring(
                config.getDouble(ConfigKey.FACE_DOC_MATCH_SIMILARITY, scope),
                config.getDouble(ConfigKey.FACE_REVIEW_SIMILARITY, scope),
                config.getDouble(ConfigKey.FACE_EXCELLENT_SIMILARITY, scope));
        double similarity = result.bestSimilarity();
        FaceMatchScoring.Decision decision = scoring.decide(similarity);
        int score = scoring.score(similarity);
        log.info("Face compare: decision={}, similarity={}, score={}, thresholds={}, model={}",
                decision, EmbeddingUtils.round(similarity, 6), score, scoring.thresholds(), result.modelVersion());
        FaceDtos.FaceCompareResponse resp = new FaceDtos.FaceCompareResponse();
        resp.setMatch(decision == FaceMatchScoring.Decision.MATCH);
        resp.setDecision(decision.name());
        resp.setSimilarity(EmbeddingUtils.round(similarity, 6));
        resp.setScore(score);
        // Euclidean distance between the unit embeddings, kept for older clients.
        resp.setDistance(EmbeddingUtils.round(Math.sqrt(Math.max(0.0, 2.0 - 2.0 * similarity)), 6));
        resp.setConfidence(score / 100.0);
        resp.setModelVersion(result.modelVersion());
        return resp;
    }

    static boolean isDegenerateEmbedding(List<Double> embedding) {
        if (embedding == null || embedding.isEmpty()) {
            return true;
        }
        double first = embedding.get(0);
        double sumSq = 0.0;
        boolean allSame = true;
        for (Double vObj : embedding) {
            if (vObj == null || !Double.isFinite(vObj)) {
                return true;
            }
            if (Math.abs(vObj - first) > 1e-9) {
                allSame = false;
            }
            sumSq += vObj * vObj;
        }
        return allSame || sumSq < 1e-8;
    }

    static FaceMatchException notFound(String what) {
        return new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", what + " not found");
    }
}
