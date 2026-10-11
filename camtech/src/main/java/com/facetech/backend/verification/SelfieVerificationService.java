package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentMedia;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.VerificationDecision;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EmbeddingCodec;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.ResultTokenService;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.platform.storage.MediaKeys;
import com.facetech.backend.repository.DocumentMediaRepository;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.VerificationDecisionRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.repository.VerificationStepRepository;
import com.facetech.backend.service.FaceEmbeddingClient;
import com.facetech.backend.service.FaceMatchScoring;
import com.facetech.backend.util.EmiratesIdValidator;
import com.facetech.backend.util.PassportMrzValidator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Selfie ID verification (formerly "Face Tech"), enforced server-side:
 * <ol>
 *   <li>create a session (single-use id, short TTL, session token)</li>
 *   <li>liveness selfies (normal, plus closer from older clients; newer ones do MOVE_CLOSER as a
 *       challenge): quality, same person, and the face really got closer. The client's "liveness passed"
 *       is not trusted</li>
 *   <li>the Emirates ID front or passport photo page: number / MRZ / expiry
 *       checks, then its portrait is matched only against the selfies stored
 *       for this session (FACE_DOC_MATCH), never against an arbitrary selfie</li>
 * </ol>
 * Every attempt, image, check and the decision are stored. Slow calls (face
 * embedding, storage) run outside database transactions.
 */
@Service
@Slf4j
public class SelfieVerificationService {

    public static final String FLOW = Codes.FLOW_SELFIE_ID;

    private final VerificationSessionRepository sessionRepository;
    private final VerificationStepRepository stepRepository;
    private final VerificationDecisionRepository decisionRepository;
    private final FaceTemplateRepository templateRepository;
    private final MediaFileRepository mediaRepository;
    private final DocumentMediaRepository documentMediaRepository;
    private final SessionSupport support;
    private final LivenessEngine liveness;
    private final LivenessChallengeService challenges;
    private final FaceEmbeddingClient faceClient;
    private final ConfigService config;
    private final EntitlementService entitlements;
    private final MediaStorageService media;
    private final SessionMedia sessionMedia;
    private final PartyService parties;
    private final DeviceService devices;
    private final AuditService audit;
    private final ResultTokenService resultTokens;
    private final DuplicateFaceSearch duplicates;
    private final TransactionTemplate tx;

    public SelfieVerificationService(VerificationSessionRepository sessionRepository,
                                     VerificationStepRepository stepRepository,
                                     VerificationDecisionRepository decisionRepository,
                                     FaceTemplateRepository templateRepository,
                                     MediaFileRepository mediaRepository,
                                     DocumentMediaRepository documentMediaRepository,
                                     SessionSupport support, LivenessEngine liveness,
                                     LivenessChallengeService challenges,
                                     FaceEmbeddingClient faceClient, ConfigService config,
                                     EntitlementService entitlements, MediaStorageService media, SessionMedia sessionMedia,
                                     PartyService parties, DeviceService devices, AuditService audit,
                                     ResultTokenService resultTokens, DuplicateFaceSearch duplicates,
                                     PlatformTransactionManager txManager) {
        this.sessionRepository = sessionRepository;
        this.stepRepository = stepRepository;
        this.decisionRepository = decisionRepository;
        this.templateRepository = templateRepository;
        this.mediaRepository = mediaRepository;
        this.documentMediaRepository = documentMediaRepository;
        this.support = support;
        this.liveness = liveness;
        this.challenges = challenges;
        this.faceClient = faceClient;
        this.config = config;
        this.entitlements = entitlements;
        this.media = media;
        this.sessionMedia = sessionMedia;
        this.parties = parties;
        this.devices = devices;
        this.audit = audit;
        this.resultTokens = resultTokens;
        this.duplicates = duplicates;
        this.tx = new TransactionTemplate(txManager);
    }

    // ================================================================ inputs and results

    /**
     * {@code enrollFace}: register the face when the verification is approved. null = when the app may register
     * faces (FACE_ENROLLMENT), as before 1.6.0; true = required (403 when not allowed); false = never.
     */
    public record CreateRequest(String subjectRef, String documentType, DeviceService.DeviceInfo device, Boolean enrollFace) {
        public CreateRequest(String subjectRef, String documentType, DeviceService.DeviceInfo device) {
            this(subjectRef, documentType, device, null);
        }
    }

    public record Created(VerificationSession session, String sessionToken) {
    }

    /** {@code samePersonSimilarity} and {@code closerAreaGain} are null when no closer selfie was sent. */
    public record LivenessResult(VerificationSession session, int attemptNo, int attemptsRemaining,
                                 Double samePersonSimilarity, Double closerAreaGain) {
    }

    /**
     * @param documentType EMIRATES_ID or PASSPORT
     * @param expiry       expiry date as read on the device (any format EmiratesIdValidator.parseDate accepts)
     * @param backImage    back of the Emirates ID (the device read its MRZ), or null
     */
    public record DocumentInput(String documentType, byte[] image, String documentNumber, String expiry,
                                String mrzLine2, String fullName, String dateOfBirth, String issuingCountry,
                                byte[] backImage) {
    }

    /**
     * @param band the face match band for this attempt: MATCH, REVIEW or NO_MATCH (REVIEW also when a
     *             match was flagged, e.g. the face belongs to another enrolled person)
     */
    public record DocumentResult(VerificationSession session, FaceMatchScoring.Decision band, double similarity,
                                 int score, int attemptsRemaining, boolean grayscaleHarmonized, String modelVersion,
                                 String reasonCode, String message) {
    }

    public record StepView(String step, String status, int attemptsUsed, int attemptsMax) {
    }

    public record SessionView(VerificationSession session, String nextStep, List<StepView> steps) {
    }

    public record ResultView(VerificationSession session, VerificationDecision decision, String resultToken,
                             Instant resultTokenExpiresAt) {
    }

    // ================================================================ create

    public Created create(CreateRequest req) {
        entitlements.require(Codes.FeatureType.FLOW, FLOW);
        String docType = normalizeDocType(req.documentType());
        if (docType != null) {
            entitlements.require(Codes.FeatureType.DOCUMENT, docType);
        }
        boolean enrollFace = resolveEnrollFace(req.enrollFace());
        entitlements.consume(Codes.FeatureType.FLOW, FLOW);
        if (enrollFace) {
            // Registering the face is its own product: it counts against the FACE_ENROLLMENT quota too.
            entitlements.consume(Codes.FeatureType.FLOW, Codes.FLOW_FACE_ENROLLMENT);
        }
        return tx.execute(st -> {
            RequestContext ctx = RequestContext.get();
            VerificationSession s = new VerificationSession();
            s.setTenantId(ctx.getTenantId());
            s.setPublicId(UUID.randomUUID().toString());
            s.setFlowCode(FLOW);
            s.setClientAppId(ctx.getClientApp().getId());
            s.setChannel(ctx.getClientApp().getChannel());
            s.setSubjectRef(cut(req.subjectRef(), 200));
            String token = Secrets.token(32);
            s.setTokenHash(Secrets.sha256Hex(token));
            s.setStatus(Codes.SessionStatus.CREATED);
            s.setStage(Codes.Stage.CREATED);
            s.setDocumentType(docType);
            s.setEnrollFace(enrollFace);
            s.setIpAddress(ctx.getIpAddress());
            s.setUserAgent(ctx.getUserAgent());
            int ttl = config.getInt(ConfigKey.SESSION_TTL_MINUTES, ConfigService.Scope.of(FLOW), 15);
            s.setExpiresAt(Instant.now().plusSeconds(ttl * 60L));
            s.setDeviceId(devices.upsert(ctx.getClientApp(), req.device()));
            parties.findByExternalRef(req.subjectRef()).map(Party::getId).ifPresent(s::setPartyId);
            sessionRepository.save(s);
            audit.record("SESSION_CREATED", "verification_session", s.getPublicId(),
                    mapOf("flow", FLOW, "subjectRef", s.getSubjectRef(), "enrollFace", enrollFace));
            log.info("Selfie verification {} created: flow={} tenant={} clientApp={} documentType={} enrollFace={} ttl={}min knownPerson={} device={}",
                    s.getPublicId(), FLOW, s.getTenantId(), s.getClientAppId(), docType, enrollFace, ttl, s.getPartyId() != null,
                    s.getDeviceId());
            log.debug("Selfie verification {} subjectRef={}", s.getPublicId(), s.getSubjectRef());
            return new Created(s, token);
        });
    }

    /** See {@link CreateRequest#enrollFace()}. */
    private boolean resolveEnrollFace(Boolean requested) {
        if (requested == null) {
            Long appId = RequestContext.get().getClientApp().getId();
            boolean available = entitlements.isAvailable(appId, Codes.FeatureType.FLOW, Codes.FLOW_FACE_ENROLLMENT);
            log.debug("Selfie verification: enrollFace not sent, face registration available={}", available);
            return available;
        }
        if (requested) {
            entitlements.require(Codes.FeatureType.FLOW, Codes.FLOW_FACE_ENROLLMENT);
        }
        return requested;
    }

    // ================================================================ liveness

    private record LivenessPrep(Long sessionId, String publicId, Instant created, Long stepId, int attempt, int counted, int max,
                                LivenessChallengeService.Resolution resolution,
                                ConfigService.Scope scope) {
    }

    public LivenessResult submitLiveness(String publicId, byte[] normal, byte[] closer, Double deviceAntiSpoofScore) {
        return submitLiveness(publicId, normal, closer, deviceAntiSpoofScore, null, List.of());
    }

    /** A new active-liveness challenge for the next liveness attempt of this verification. */
    public LivenessChallengeService.Issued issueChallenge(String publicId) {
        return issueChallenge(publicId, null);
    }

    /** As above, drawn from the actions the client supports (null = the original three). */
    public LivenessChallengeService.Issued issueChallenge(String publicId, List<String> supportedActions) {
        expireIfDue(publicId);
        LivenessChallengeService.Issued issued = tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            requireOpenForLiveness(s);
            return challenges.issue(s.getId(), null, ConfigService.Scope.of(FLOW), supportedActions);
        });
        log.info("Selfie verification {} challenge {} issued: actions={} expiresAt={}",
                publicId, issued.challengeId(), issued.actions(), issued.expiresAt());
        return issued;
    }

    /** Liveness with an optional active challenge: its id and the frames recorded while the user did it. */
    public LivenessResult submitLiveness(String publicId, byte[] normal, byte[] closer, Double deviceAntiSpoofScore,
                                         String challengeId, List<byte[]> challengeFrames) {
        expireIfDue(publicId);
        LivenessPrep p = tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            requireOpenForLiveness(s);
            ConfigService.Scope scope = ConfigService.Scope.of(FLOW);
            int max = support.maxAttempts(FLOW, Codes.LIVENESS, ConfigKey.LIVENESS_MAX_ATTEMPTS, scope);
            int used = support.attemptsUsed(s, Codes.LIVENESS);
            if (used >= max) {
                log.debug("Selfie verification {} liveness refused: {} of {} attempts used", publicId, used, max);
                throw tooManyAttempts("Too many liveness attempts. Start a new session.");
            }
            // Before the attempt starts: a missing, used or expired challenge does not cost the user an attempt.
            LivenessChallengeService.Resolution resolution = challenges.resolve(challengeId, s.getId(), null, scope);
            VerificationStep step = support.startStep(s, Codes.LIVENESS, support.nextAttemptNo(s, Codes.LIVENESS));
            s.setStatus(Codes.SessionStatus.IN_PROGRESS);
            s.setLivenessMode(resolution.mode());
            return new LivenessPrep(s.getId(), s.getPublicId(), s.getCreatedAt(), step.getId(), step.getAttemptNo(), used + 1, max,
                    resolution, scope);
        });
        log.info("Selfie verification {} liveness attempt {} started ({} of {} counted, mode={} challenge={} actions={})",
                publicId, p.attempt(), p.counted(), p.max(), p.resolution().mode(), challengeId, p.resolution().actions());
        log.debug("Selfie verification {} liveness attempt {}: normal={} bytes, closer={} bytes, {} challenge frames",
                publicId, p.attempt(), normal == null ? 0 : normal.length, closer == null ? 0 : closer.length,
                challengeFrames == null ? 0 : challengeFrames.size());

        List<CheckDraft> checks = new ArrayList<>();
        LivenessEngine.Outcome out;
        try {
            out = liveness.evaluate(normal, closer, deviceAntiSpoofScore, p.resolution(), challengeFrames, p.scope(), checks);
        } catch (FaceMatchException e) {
            // An outage on our side (face service, storage) does not use up one of the user's attempts.
            boolean system = SessionSupport.isSystemFailure(e);
            int remaining = Math.max(0, p.max() - p.counted() + (system ? 1 : 0));
            SessionMedia.Uploads failed = config.getBoolean(ConfigKey.LIVENESS_KEEP_FAILED_MEDIA, p.scope())
                    ? sessionMedia.upload(FLOW, p.created(), p.publicId(), p.attempt(), normal, closer, challengeFrames,
                    Codes.MediaCategory.FAILED_ATTEMPT_MEDIA)
                    : SessionMedia.Uploads.none(p.publicId());
            tx.executeWithoutResult(st -> {
                VerificationSession s = sessionRepository.findById(p.sessionId()).orElseThrow();
                VerificationStep step = support.step(p.stepId());
                support.finishStep(step, Codes.StepStatus.FAILED, e.getCode(), e.getMessage());
                support.saveChecks(step, checks);
                sessionMedia.save(step, failed, Codes.MediaCategory.FAILED_ATTEMPT_MEDIA);
                if (!system) {
                    s.setStage(Codes.Stage.LIVENESS_FAILED);
                }
                if (remaining == 0) {
                    support.fail(s, "TOO_MANY_ATTEMPTS");
                }
                audit.record("LIVENESS_FAILED", "verification_session", s.getPublicId(),
                        mapOf("attempt", p.attempt(), "reasonCode", e.getCode()));
            });
            log.info("Selfie verification {} liveness attempt {} failed: {} (systemFailure={}, attemptsRemaining={})",
                    publicId, p.attempt(), e.getCode(), system, remaining);
            throw e.with("step", "LIVENESS").with("attemptsRemaining", remaining)
                    .with("nextStep", remaining > 0 ? "LIVENESS" : "DONE");
        }

        SessionMedia.Uploads uploads = sessionMedia.upload(FLOW, p.created(), p.publicId(), p.attempt(), normal, closer,
                challengeFrames, Codes.MediaCategory.VERIFIED_MEDIA);
        return tx.execute(st -> {
            VerificationSession s = sessionRepository.findById(p.sessionId()).orElseThrow();
            VerificationStep step = support.step(p.stepId());
            MediaFile[] stored = sessionMedia.save(step, uploads, Codes.MediaCategory.VERIFIED_MEDIA);
            support.finishStep(step, Codes.StepStatus.PASSED, null, null);
            support.saveChecks(step, checks);
            saveTemplate(s, stored[0], Codes.TemplateRole.SELFIE, "normal", out.normal());
            if (out.closer() != null) {
                saveTemplate(s, stored[1], Codes.TemplateRole.SELFIE, "closer", out.closer());
            }
            s.setSelfieGrayscale(out.grayscale());
            s.setStage(Codes.Stage.LIVENESS_PASSED);
            audit.record("LIVENESS_PASSED", "verification_session", s.getPublicId(), mapOf("attempt", p.attempt()));
            log.info("Selfie verification {} liveness attempt {} passed: samePerson={} areaGain={} grayscale={} model={}",
                    s.getPublicId(), p.attempt(), fmt3(out.samePersonSimilarity()), fmt3(out.closerAreaGain()),
                    out.grayscale(), out.normal().modelVersion());
            return new LivenessResult(s, p.attempt(), Math.max(0, p.max() - p.counted()),
                    out.samePersonSimilarity(), out.closerAreaGain());
        });
    }

    // ================================================================ document + face match

    private record DocumentPrep(Long sessionId, String publicId, Instant created, Long partyId, String subjectRef,
                                Long captureStepId, int attempt, int counted, int max, ConfigService.Scope scope,
                                boolean selfieGrayscale, List<Double> normalEmbedding, List<Double> closerEmbedding,
                                Long normalMediaId, Long closerMediaId) {
    }

    public DocumentResult submitDocument(String publicId, DocumentInput in) {
        String docType = normalizeDocType(in.documentType());
        if (docType == null || !(docType.equals("EMIRATES_ID") || docType.equals("PASSPORT"))) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "BAD_DOCUMENT_TYPE", "document_type must be EMIRATES_ID or PASSPORT");
        }
        if (in.image() == null || in.image().length == 0) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "DOCUMENT_REQUIRED", "Upload the document image (field 'document').");
        }
        expireIfDue(publicId);
        DocumentPrep p = tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            requireOpenForDocument(s, docName(docType));
            entitlements.require(Codes.FeatureType.DOCUMENT, docType);
            ConfigService.Scope scope = ConfigService.Scope.of(FLOW);
            int max = support.maxAttempts(FLOW, Codes.DOC_CAPTURE, ConfigKey.DOCUMENT_MAX_ATTEMPTS, scope);
            int used = support.attemptsUsed(s, Codes.DOC_CAPTURE);
            if (used >= max) {
                log.debug("Selfie verification {} document refused: {} of {} attempts used", publicId, used, max);
                throw tooManyAttempts("Too many document attempts. Please start again.");
            }
            VerificationStep capture = support.startStep(s, Codes.DOC_CAPTURE, support.nextAttemptNo(s, Codes.DOC_CAPTURE));
            s.setDocumentType(docType);
            FaceTemplate normal = null;
            FaceTemplate closer = null;
            for (FaceTemplate t : templateRepository.findBySessionId(s.getId())) {
                if (t.getRole() == Codes.TemplateRole.SELFIE && "normal".equals(t.getPose())) {
                    normal = t;
                } else if (t.getRole() == Codes.TemplateRole.SELFIE && "closer".equals(t.getPose())) {
                    closer = t;
                }
            }
            // The closer selfie is optional (newer clients send only the normal one).
            if (normal == null) {
                log.warn("Selfie verification {}: stored liveness templates missing (normal={}, closer={})",
                        publicId, normal != null, closer != null);
                throw new FaceMatchException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_ERROR",
                        "Stored liveness selfies are missing. Please start again.");
            }
            return new DocumentPrep(s.getId(), s.getPublicId(), s.getCreatedAt(), s.getPartyId(), s.getSubjectRef(),
                    capture.getId(), capture.getAttemptNo(), used + 1, max, scope, s.isSelfieGrayscale(),
                    EmbeddingCodec.decode(normal.getVector()), closer != null ? EmbeddingCodec.decode(closer.getVector()) : null,
                    normal.getSourceMediaId(), closer != null ? closer.getSourceMediaId() : null);
        });
        log.info("Selfie verification {} document attempt {} started ({}, {} of {} counted)",
                publicId, p.attempt(), docType, p.counted(), p.max());
        log.debug("Selfie verification {} document attempt {}: image={} bytes, numberSent={} expirySent={} mrzSent={}",
                publicId, p.attempt(), in.image().length, in.documentNumber() != null && !in.documentNumber().isBlank(),
                in.expiry() != null && !in.expiry().isBlank(), in.mrzLine2() != null && !in.mrzLine2().isBlank());

        // 1. document checks (number checksum / MRZ check digits / expiry)
        List<CheckDraft> validationChecks = new ArrayList<>();
        try {
            validateDocumentFields(docType, in.documentNumber(), in.expiry(), in.mrzLine2(), validationChecks);
        } catch (FaceMatchException e) {
            log.debug("Selfie verification {} document attempt {} validation checks: {}", publicId, p.attempt(),
                    checkSummary(validationChecks));
            throw documentFailure(p, docType, in, Codes.DOC_VALIDATION, e, validationChecks);
        }
        log.debug("Selfie verification {} document attempt {} validation checks: {}", publicId, p.attempt(),
                checkSummary(validationChecks));

        // 2. face match against this session's selfies
        FaceEmbeddingClient.EmbedResult id;
        double similarity;
        boolean harmonized;
        String modelVersion;
        String bestOf;
        try {
            long t0 = System.nanoTime();
            id = faceClient.embed(in.image(), "document.jpg", FaceEmbeddingClient.ROLE_DOCUMENT);
            log.debug("Selfie verification {} document embed took {} ms: faceCount={} detScore={} grayscale={} issues={} model={}",
                    publicId, (System.nanoTime() - t0) / 1_000_000, id.faceCount(), id.detScore(), id.grayscale(),
                    id.issues(), id.modelVersion());
            if (id.grayscale() || p.selfieGrayscale()) {
                // Black & white on either side: re-embed everything in grayscale so the colour gap
                // doesn't lower the similarity.
                log.debug("Selfie verification {} grayscale on {} side: comparing via face service",
                        publicId, id.grayscale() ? "document" : "selfie");
                t0 = System.nanoTime();
                FaceEmbeddingClient.CompareResult cmp = faceClient.compare(in.image(), "document.jpg",
                        p.closerMediaId() != null ? List.of(readMedia(p.normalMediaId()), readMedia(p.closerMediaId()))
                                : List.of(readMedia(p.normalMediaId())));
                log.debug("Selfie verification {} face service compare took {} ms", publicId, (System.nanoTime() - t0) / 1_000_000);
                similarity = cmp.bestSimilarity();
                harmonized = cmp.grayscaleHarmonized();
                modelVersion = cmp.modelVersion();
                bestOf = cmp.bestIndex() == 0 ? "NORMAL" : "CLOSER";
            } else {
                // Fast path: reuse the selfie embeddings computed during liveness.
                if (id.embedding().size() != p.normalEmbedding().size()) {
                    log.warn("Selfie verification {}: document embedding dimension {} differs from selfie dimension {}",
                            publicId, id.embedding().size(), p.normalEmbedding().size());
                    throw new FaceMatchException(HttpStatus.INTERNAL_SERVER_ERROR, "EMBEDDING_MISMATCH",
                            "Embeddings from different models cannot be compared. Please start again.");
                }
                double simNormal = EmbeddingCodec.cosine(id.embedding(), p.normalEmbedding());
                double simCloser = p.closerEmbedding() != null ? EmbeddingCodec.cosine(id.embedding(), p.closerEmbedding()) : -2;
                similarity = Math.max(simNormal, simCloser);
                harmonized = false;
                modelVersion = id.modelVersion();
                bestOf = simNormal >= simCloser ? "NORMAL" : "CLOSER";
                log.debug("Selfie verification {} fast-path match: simNormal={} simCloser={}", publicId,
                        String.format(Locale.ROOT, "%.3f", simNormal), String.format(Locale.ROOT, "%.3f", simCloser));
            }
        } catch (FaceMatchException e) {
            throw documentFailure(p, docType, in, Codes.DOC_CAPTURE, e, validationChecks);
        }

        FaceMatchScoring scoring = scoring(p.scope());
        FaceMatchScoring.Decision band = scoring.decide(similarity);
        int score = scoring.score(similarity);
        log.debug("Selfie verification {} face vs document: similarity={} bestOf={} thresholds={} -> band={} score={}",
                publicId, String.format(Locale.ROOT, "%.3f", similarity), bestOf, scoring.thresholds(), band, score);
        Map<String, Object> matchDetails = mapOf("score", score, "bestOf", bestOf,
                "grayscaleHarmonized", harmonized, "model", modelVersion);
        CheckDraft matchCheck = new CheckDraft("SELFIE_VS_DOC_PHOTO", similarity, scoring.thresholds(),
                band == FaceMatchScoring.Decision.MATCH ? Codes.CheckOutcome.PASS
                        : band == FaceMatchScoring.Decision.REVIEW ? Codes.CheckOutcome.REVIEW : Codes.CheckOutcome.FAIL,
                matchDetails);

        // 3. duplicate identity search (1:N) on a match
        String normalized = PartyService.normalizeNumber(docType, in.documentNumber());
        String country = issuingCountry(docType, in.issuingCountry());
        DuplicateFaceSearch.Result dedup = band == FaceMatchScoring.Decision.MATCH ? dedup(p, docType, country, normalized) : null;

        final double sim = similarity;
        final boolean harm = harmonized;
        final String model = modelVersion;
        final List<Double> docEmbedding = id.embedding();
        DocumentResult result = tx.execute(st -> {
            VerificationSession s = sessionRepository.findById(p.sessionId()).orElseThrow();
            VerificationStep capture = support.step(p.captureStepId());
            String role = docType.equals("PASSPORT") ? "PHOTO_PAGE" : "FRONT";
            MediaFile docMedia = media.store(in.image(), Codes.MediaCategory.VERIFIED_MEDIA, false,
                    MediaKeys.sessionFile(FLOW, p.created(), p.publicId(), "document", p.attempt(), role));
            support.attachMedia(capture, docMedia, role);
            MediaFile backMedia = null;
            if (in.backImage() != null) {
                backMedia = media.store(in.backImage(), Codes.MediaCategory.VERIFIED_MEDIA, false,
                        MediaKeys.sessionFile(FLOW, p.created(), p.publicId(), "document", p.attempt(), "BACK"));
                support.attachMedia(capture, backMedia, "BACK");
            }
            support.finishStep(capture, Codes.StepStatus.PASSED, null, null);

            VerificationStep validation = support.startStep(s, Codes.DOC_VALIDATION, p.attempt());
            support.saveChecks(validation, validationChecks);
            support.finishStep(validation, Codes.StepStatus.PASSED, null, null);

            boolean ownerMismatch = linkDocument(s, docType, country, normalized, in, docMedia, role, validation.getId());
            if (backMedia != null && s.getDocumentId() != null) {
                DocumentMedia back = new DocumentMedia();
                back.setTenantId(s.getTenantId());
                back.setDocumentId(s.getDocumentId());
                back.setMediaId(backMedia.getId());
                back.setRole("BACK");
                documentMediaRepository.save(back);
            }

            VerificationStep match = support.startStep(s, Codes.FACE_DOC_MATCH, p.attempt());
            List<CheckDraft> matchChecks = new ArrayList<>(List.of(matchCheck));
            saveTemplate(s, docMedia, Codes.TemplateRole.DOCUMENT, null,
                    new FaceEmbeddingClient.EmbedResult(docEmbedding, model, 0, 1, 0, false, List.of()));
            int remaining = Math.max(0, p.max() - p.counted());
            String reasonCode = null;
            String message;
            FaceMatchScoring.Decision outBand = band;

            if (band == FaceMatchScoring.Decision.MATCH) {
                String reviewReason = null;
                if (ownerMismatch) {
                    log.info("Selfie verification {}: document is on file for another person, sending to review", s.getPublicId());
                    matchChecks.add(new CheckDraft("DOCUMENT_OWNER", null, null, Codes.CheckOutcome.REVIEW,
                            mapOf("reason", "The document is on file for another person")));
                    reasonCode = "DOCUMENT_OWNER_MISMATCH";
                    reviewReason = "Document is on file for another person";
                }
                if (dedup != null) {
                    VerificationStep d = support.startStep(s, Codes.DEDUP_SEARCH, 1);
                    boolean dup = dedup.otherPartyId() != null;
                    support.saveChecks(d, List.of(new CheckDraft("DEDUP_1N", dedup.bestSimilarity(), dedup.threshold(),
                            dup ? Codes.CheckOutcome.REVIEW : Codes.CheckOutcome.PASS,
                            mapOf("bestOtherPartyId", dedup.otherPartyId(), "candidates", dedup.candidates()))));
                    support.finishStep(d, dup ? Codes.StepStatus.REVIEW : Codes.StepStatus.PASSED,
                            dup ? "DUPLICATE_IDENTITY" : null, null);
                    if (dup) {
                        log.info("Selfie verification {}: face matches another enrolled person (similarity {}), sending to review",
                                s.getPublicId(), String.format(Locale.ROOT, "%.3f", dedup.bestSimilarity()));
                        reasonCode = "DUPLICATE_IDENTITY";
                        reviewReason = "Face matches another enrolled person (similarity "
                                + String.format(Locale.ROOT, "%.2f", dedup.bestSimilarity()) + ")";
                    }
                }
                support.saveChecks(match, matchChecks);
                boolean flagged = reviewReason != null;
                support.finishStep(match, flagged ? Codes.StepStatus.REVIEW : Codes.StepStatus.PASSED, reasonCode, null);
                s.setStage(flagged ? Codes.Stage.VERIFIED_REVIEW : Codes.Stage.VERIFIED_MATCH);
                VerificationDecision decision = support.decide(s,
                        flagged ? Codes.Decision.REVIEW : Codes.Decision.APPROVED,
                        flagged ? reviewReason : "Liveness passed and the face matches the " + docName(docType),
                        sim, reviewReason);
                if (decision.getDecision() == Codes.Decision.APPROVED && s.getDocumentId() != null) {
                    parties.findDocumentById(s.getDocumentId()).ifPresent(doc -> doc.setStatus(Codes.DocumentStatus.VERIFIED));
                }
                outBand = flagged ? FaceMatchScoring.Decision.REVIEW : FaceMatchScoring.Decision.MATCH;
                remaining = 0;
                message = flagged ? "We need to check your verification manually. You will be notified of the result."
                        : messageFor(FaceMatchScoring.Decision.MATCH, docName(docType));
            } else {
                support.saveChecks(match, matchChecks);
                boolean review = band == FaceMatchScoring.Decision.REVIEW;
                reasonCode = review ? "LOW_CONFIDENCE" : "FACE_MISMATCH";
                support.finishStep(match, review ? Codes.StepStatus.REVIEW : Codes.StepStatus.FAILED, reasonCode, null);
                s.setStage(review ? Codes.Stage.VERIFIED_REVIEW : Codes.Stage.VERIFIED_NO_MATCH);
                if (remaining == 0) {
                    support.decide(s, review ? Codes.Decision.REVIEW : Codes.Decision.REJECTED,
                            review ? "Face vs document similarity stayed in the review band after " + p.attempt() + " attempts"
                                    : "The face on the " + docName(docType) + " does not match the selfie",
                            sim, review ? "Borderline face match (similarity " + String.format(Locale.ROOT, "%.2f", sim) + ")" : null);
                } else {
                    log.debug("Selfie verification {}: {} on attempt {}, {} document attempts left: no decision yet",
                            s.getPublicId(), reasonCode, p.attempt(), remaining);
                    media.setCategory(docMedia, Codes.MediaCategory.FAILED_ATTEMPT_MEDIA);
                }
                message = messageFor(band, docName(docType));
            }
            audit.record("DOCUMENT_MATCHED", "verification_session", s.getPublicId(),
                    mapOf("attempt", p.attempt(), "documentType", docType, "band", outBand.name(),
                            "similarity", round(sim)));
            return new DocumentResult(s, outBand, sim, score, remaining, harm, model, reasonCode, message);
        });
        log.info("Selfie verification {} document attempt {} ({}): similarity={} score={} band={} harmonized={} reasonCode={} attemptsRemaining={} stage={}",
                publicId, p.attempt(), docType, String.format(Locale.ROOT, "%.3f", similarity), score, result.band(), harmonized,
                result.reasonCode(), result.attemptsRemaining(), result.session().getStage());
        return result;
    }

    // ================================================================ state, result, cancel

    public SessionView view(String publicId) {
        return tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            if (support.isExpired(s)) {
                support.expire(s);
            }
            ConfigService.Scope scope = ConfigService.Scope.of(FLOW);
            int livenessMax = support.maxAttempts(FLOW, Codes.LIVENESS, ConfigKey.LIVENESS_MAX_ATTEMPTS, scope);
            int documentMax = support.maxAttempts(FLOW, Codes.DOC_CAPTURE, ConfigKey.DOCUMENT_MAX_ATTEMPTS, scope);
            int livenessUsed = support.attemptsUsed(s, Codes.LIVENESS);
            int documentUsed = support.attemptsUsed(s, Codes.DOC_CAPTURE);
            String livenessStatus = switch (s.getStage()) {
                case CREATED -> "PENDING";
                case LIVENESS_FAILED -> "FAILED";
                default -> "PASSED";
            };
            String documentStatus = switch (s.getStage()) {
                case VERIFIED_MATCH -> "PASSED";
                case VERIFIED_REVIEW -> "REVIEW";
                case VERIFIED_NO_MATCH -> "FAILED";
                default -> documentUsed > 0 ? "FAILED" : "PENDING";
            };
            return new SessionView(s, nextStep(s), List.of(
                    new StepView("LIVENESS", livenessStatus, livenessUsed, livenessMax),
                    new StepView("DOCUMENT", documentStatus, documentUsed, documentMax)));
        });
    }

    public ResultView result(String publicId) {
        return tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            if (support.isExpired(s)) {
                support.expire(s);
            }
            VerificationDecision d = decisionRepository.findBySessionId(s.getId()).orElse(null);
            if (d == null) {
                log.debug("Selfie verification {} result requested: no decision yet (status={}, stage={})",
                        s.getPublicId(), s.getStatus(), s.getStage());
                return new ResultView(s, null, null, null);
            }
            Map<String, Object> claims = new LinkedHashMap<>();
            claims.put("sub", s.getSubjectRef() != null ? s.getSubjectRef() : partyPublicId(s));
            claims.put("sid", s.getPublicId());
            claims.put("flow", s.getFlowCode());
            claims.put("decision", d.getDecision().name());
            claims.put("decidedBy", d.getDecidedBy().name());
            claims.put("documentType", s.getDocumentType());
            claims.put("personId", partyPublicId(s));
            ResultTokenService.Issued token = resultTokens.issue(claims);
            d.setResultTokenJti(token.jti());
            log.info("Selfie verification {} result issued: decision={} decidedBy={} tokenExpiresAt={}",
                    s.getPublicId(), d.getDecision(), d.getDecidedBy(), token.expiresAt());
            return new ResultView(s, d, token.token(), token.expiresAt());
        });
    }

    public VerificationSession cancel(String publicId) {
        return tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            if (!s.getStatus().isOpen()) {
                throw new FaceMatchException(HttpStatus.CONFLICT, "SESSION_CLOSED", "This verification is already closed.");
            }
            log.info("Selfie verification {} cancelled at stage {}", s.getPublicId(), s.getStage());
            s.setStatus(Codes.SessionStatus.CANCELLED);
            s.setCompletedAt(Instant.now());
            audit.record("SESSION_CANCELLED", "verification_session", s.getPublicId(), null);
            return s;
        });
    }

    public static String nextStep(VerificationSession s) {
        if (!s.getStatus().isOpen()) {
            return "DONE";
        }
        return switch (s.getStage()) {
            case CREATED, LIVENESS_FAILED -> "LIVENESS";
            case VERIFIED_MATCH -> "DONE";
            default -> "DOCUMENT";
        };
    }

    /** Old Face Tech status values, still returned by /face-tech/sessions/**. */
    public static String legacyStatus(VerificationSession s) {
        return s.getStage().name();
    }

    // ================================================================ internals

    private void expireIfDue(String publicId) {
        Boolean expired = tx.execute(st -> {
            VerificationSession s = support.load(publicId, FLOW);
            if (support.isExpired(s)) {
                support.expire(s);
                return true;
            }
            return s.getStatus() == Codes.SessionStatus.EXPIRED;
        });
        if (Boolean.TRUE.equals(expired)) {
            throw SessionSupport.expired();
        }
    }

    private void requireOpenForLiveness(VerificationSession s) {
        if (s.getStage() != Codes.Stage.CREATED && s.getStage() != Codes.Stage.LIVENESS_FAILED) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "LIVENESS_ALREADY_DONE",
                    "Liveness was already completed for this session. Start a new session.");
        }
        if (s.getStatus() == Codes.SessionStatus.FAILED) {
            throw tooManyAttempts("Too many liveness attempts. Start a new session.");
        }
        if (!s.getStatus().isOpen()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "SESSION_CLOSED", "This verification is closed. Start a new one.");
        }
    }

    private void requireOpenForDocument(VerificationSession s, String docName) {
        if (s.getStage() == Codes.Stage.CREATED || s.getStage() == Codes.Stage.LIVENESS_FAILED) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "LIVENESS_REQUIRED",
                    "Complete the liveness check before scanning the " + docName + ".");
        }
        if (s.getStage() == Codes.Stage.VERIFIED_MATCH) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "ALREADY_VERIFIED",
                    "This session is already verified. Start a new session.");
        }
        if (s.getStatus() == Codes.SessionStatus.CANCELLED) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "SESSION_CLOSED", "This verification is closed. Start a new one.");
        }
        if (!s.getStatus().isOpen()) {
            throw tooManyAttempts("Too many document attempts. Please start again.");
        }
    }

    private static FaceMatchException tooManyAttempts(String message) {
        return new FaceMatchException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS", message);
    }

    /** Records a failed document attempt (bad number, expired, no face on the document...). */
    private FaceMatchException documentFailure(DocumentPrep p, String docType, DocumentInput in, String failedStep,
                                               FaceMatchException e, List<CheckDraft> validationChecks) {
        boolean system = SessionSupport.isSystemFailure(e);
        int remaining = Math.max(0, p.max() - p.counted() + (system ? 1 : 0));
        tx.executeWithoutResult(st -> {
            VerificationSession s = sessionRepository.findById(p.sessionId()).orElseThrow();
            VerificationStep capture = support.step(p.captureStepId());
            String role = docType.equals("PASSPORT") ? "PHOTO_PAGE" : "FRONT";
            try {
                MediaFile m = media.store(in.image(), Codes.MediaCategory.FAILED_ATTEMPT_MEDIA, false,
                        MediaKeys.sessionFile(FLOW, p.created(), p.publicId(), "document", p.attempt(), role));
                support.attachMedia(capture, m, role);
                if (in.backImage() != null) {
                    MediaFile back = media.store(in.backImage(), Codes.MediaCategory.FAILED_ATTEMPT_MEDIA, false,
                            MediaKeys.sessionFile(FLOW, p.created(), p.publicId(), "document", p.attempt(), "BACK"));
                    support.attachMedia(capture, back, "BACK");
                }
            } catch (FaceMatchException storageProblem) {
                log.warn("Could not keep the failed document image of {}: {} (cause: {})", p.publicId(),
                        storageProblem.getMessage(), String.valueOf(storageProblem.getCause()));
            }
            if (Codes.DOC_VALIDATION.equals(failedStep)) {
                support.finishStep(capture, Codes.StepStatus.PASSED, null, null);
                VerificationStep v = support.startStep(s, Codes.DOC_VALIDATION, p.attempt());
                support.saveChecks(v, validationChecks);
                support.finishStep(v, Codes.StepStatus.FAILED, e.getCode(), e.getMessage());
            } else {
                support.finishStep(capture, Codes.StepStatus.FAILED, e.getCode(), e.getMessage());
            }
            if (remaining == 0) {
                support.decide(s, Codes.Decision.REJECTED, "Document check failed: " + e.getCode(), null, null);
            }
            audit.record("DOCUMENT_FAILED", "verification_session", s.getPublicId(),
                    mapOf("attempt", p.attempt(), "reasonCode", e.getCode()));
        });
        log.info("Selfie verification {} document attempt {} failed at {}: {} (systemFailure={}, attemptsRemaining={})",
                p.publicId(), p.attempt(), failedStep, e.getCode(), system, remaining);
        return e.with("step", "DOCUMENT").with("attemptsRemaining", remaining)
                .with("nextStep", remaining > 0 ? "DOCUMENT" : "DONE");
    }

    private void validateDocumentFields(String docType, String number, String expiry, String mrzLine2,
                                        List<CheckDraft> checks) {
        if (docType.equals("EMIRATES_ID")) {
            if (number != null && !number.isBlank()) {
                boolean ok = EmiratesIdValidator.isValidNumber(number);
                checks.add(CheckDraft.of("EID_CHECKSUM", null, null, ok));
                if (!ok) {
                    throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, "ID_NUMBER_INVALID",
                            "The Emirates ID number could not be read correctly. Please rescan the card.");
                }
            } else {
                checks.add(new CheckDraft("EID_CHECKSUM", null, null, Codes.CheckOutcome.SKIPPED, mapOf("reason", "no number sent")));
            }
        } else if (mrzLine2 != null && !mrzLine2.isBlank()) {
            boolean ok = PassportMrzValidator.isValidLine2(mrzLine2);
            checks.add(CheckDraft.of("MRZ_CHECK_DIGITS", null, null, ok));
            if (!ok) {
                throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY, "MRZ_INVALID",
                        "The passport details could not be read correctly. Please rescan the photo page, "
                                + "keeping the two lines at the bottom sharp and fully visible.");
            }
        } else {
            checks.add(new CheckDraft("MRZ_CHECK_DIGITS", null, null, Codes.CheckOutcome.SKIPPED, mapOf("reason", "no MRZ sent")));
        }
        LocalDate expiryDate = EmiratesIdValidator.parseDate(expiry).orElse(null);
        if (expiryDate == null) {
            checks.add(new CheckDraft("DOC_NOT_EXPIRED", null, null, Codes.CheckOutcome.SKIPPED, mapOf("reason", "no expiry sent")));
            return;
        }
        boolean valid = !expiryDate.isBefore(LocalDate.now());
        checks.add(new CheckDraft("DOC_NOT_EXPIRED", null, null, valid ? Codes.CheckOutcome.PASS : Codes.CheckOutcome.FAIL,
                mapOf("expiry", expiryDate.toString())));
        if (!valid) {
            throw new FaceMatchException(HttpStatus.UNPROCESSABLE_ENTITY,
                    docType.equals("PASSPORT") ? "PASSPORT_EXPIRED" : "ID_EXPIRED",
                    "This " + docName(docType) + " expired on " + expiryDate + ". Please use a valid document.");
        }
    }

    /**
     * Links the session to the person and document. Returns true when the
     * document is already on file for a different person than the session's.
     */
    private boolean linkDocument(VerificationSession s, String docType, String country, String normalized,
                                 DocumentInput in, MediaFile docMedia, String role, Long stepId) {
        boolean ownerMismatch = false;
        IdentityDocument doc = null;
        if (normalized != null) {
            doc = parties.findDocument(docType, country, normalized).orElse(null);
            if (doc != null && doc.getPartyId() != null) {
                if (s.getPartyId() == null) {
                    s.setPartyId(doc.getPartyId());
                    log.debug("Selfie verification {}: linked to party {} through the document on file", s.getPublicId(), doc.getPartyId());
                } else if (!s.getPartyId().equals(doc.getPartyId())) {
                    ownerMismatch = true;
                    log.debug("Selfie verification {}: document {} belongs to party {}, session party is {}",
                            s.getPublicId(), doc.getPublicId(), doc.getPartyId(), s.getPartyId());
                }
            }
        }
        if (s.getPartyId() == null) {
            s.setPartyId(parties.findOrCreatePerson(s.getSubjectRef()).getId());
        }
        if (doc == null && normalized == null) {
            log.debug("Selfie verification {}: no document number sent, document not linked", s.getPublicId());
        }
        if (doc == null && normalized != null) {
            doc = parties.createDocument(s.getPartyId(), docType, docType.equals("EMIRATES_ID") ? "ICP" : null,
                    country, normalized);
        }
        if (doc == null) {
            return false;
        }
        if (doc.getPartyId() == null) {
            doc.setPartyId(s.getPartyId());
        }
        LocalDate expiry = EmiratesIdValidator.parseDate(in.expiry()).orElse(null);
        if (expiry != null) {
            doc.setExpiryDate(expiry);
        }
        parties.setField(doc, "DOCUMENT_NUMBER", null, normalized, null, Codes.FieldSource.CLIENT_OCR, null, null, stepId);
        parties.setField(doc, "EXPIRY_DATE", null, null, expiry, Codes.FieldSource.CLIENT_OCR, null, null, stepId);
        if (in.mrzLine2() != null && !in.mrzLine2().isBlank()) {
            parties.setField(doc, "MRZ_LINE_2", null, in.mrzLine2(), null, Codes.FieldSource.CLIENT_OCR, null, null, stepId);
        }
        LocalDate dob = EmiratesIdValidator.parseDate(in.dateOfBirth()).orElse(null);
        // The client sends the Arabic name when the card's English name could not be read.
        boolean arabicName = in.fullName() != null && in.fullName().codePoints()
                .anyMatch(c -> Character.UnicodeScript.of(c) == Character.UnicodeScript.ARABIC);
        parties.setField(doc, "FULL_NAME", arabicName ? "ar" : "en", in.fullName(), null, Codes.FieldSource.CLIENT_OCR,
                null, null, stepId);
        parties.setField(doc, "DATE_OF_BIRTH", null, null, dob, Codes.FieldSource.CLIENT_OCR, null, null, stepId);
        if (!ownerMismatch) {
            parties.enrichPerson(s.getPartyId(), arabicName ? null : in.fullName(), arabicName ? in.fullName() : null,
                    dob, null, null, false);
        }
        DocumentMedia dm = new DocumentMedia();
        dm.setTenantId(s.getTenantId());
        dm.setDocumentId(doc.getId());
        dm.setMediaId(docMedia.getId());
        dm.setRole(role);
        documentMediaRepository.save(dm);
        s.setDocumentId(doc.getId());
        return ownerMismatch;
    }

    /** 1:N search of the normal selfie against every other person's registered face. */
    private DuplicateFaceSearch.Result dedup(DocumentPrep p, String docType, String country, String normalized) {
        Set<Long> own = new HashSet<>();
        if (p.partyId() != null) {
            own.add(p.partyId());
        }
        parties.findDocument(docType, country, normalized).map(IdentityDocument::getPartyId).ifPresent(own::add);
        return duplicates.search(FLOW, p.scope(), p.normalEmbedding(), own, p.publicId());
    }

    private static String fmt3(Double v) {
        return v == null ? null : String.format(Locale.ROOT, "%.3f", v);
    }

    private void saveTemplate(VerificationSession s, MediaFile source, Codes.TemplateRole role, String pose,
                              FaceEmbeddingClient.EmbedResult embed) {
        FaceTemplate t = new FaceTemplate();
        t.setTenantId(s.getTenantId());
        t.setPartyId(s.getPartyId());
        t.setSessionId(s.getId());
        t.setSourceMediaId(source != null ? source.getId() : null);
        t.setRole(role);
        t.setPose(pose);
        t.setModelVersion(embed.modelVersion() != null ? embed.modelVersion() : "unknown");
        t.setDimension(embed.embedding().size());
        t.setVector(EmbeddingCodec.encode(embed.embedding()));
        t.setQualityScore(embed.detScore() > 0 ? BigDecimal.valueOf(embed.detScore()).setScale(6, RoundingMode.HALF_UP) : null);
        t.setStatus(Codes.TemplateStatus.SESSION);
        templateRepository.save(t);
    }

    private byte[] readMedia(Long mediaId) {
        MediaFile m = mediaRepository.findById(mediaId).orElseThrow(() -> new FaceMatchException(
                HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_ERROR", "Stored liveness image is missing. Please start again."));
        return media.read(m);
    }

    private FaceMatchScoring scoring(ConfigService.Scope scope) {
        return new FaceMatchScoring(
                config.getDouble(ConfigKey.FACE_DOC_MATCH_SIMILARITY, scope),
                config.getDouble(ConfigKey.FACE_REVIEW_SIMILARITY, scope),
                config.getDouble(ConfigKey.FACE_EXCELLENT_SIMILARITY, scope));
    }

    private String partyPublicId(VerificationSession s) {
        return s.getPartyId() == null ? null : parties.findParty(s.getPartyId()).map(Party::getPublicId).orElse(null);
    }

    static String normalizeDocType(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    private static String issuingCountry(String docType, String raw) {
        if (docType.equals("EMIRATES_ID")) {
            return "ARE";
        }
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String c = raw.trim().toUpperCase(Locale.ROOT);
        return c.length() == 3 ? c : null;
    }

    static String docName(String docType) {
        return "PASSPORT".equals(docType) ? "passport" : "Emirates ID";
    }

    static String messageFor(FaceMatchScoring.Decision decision, String docName) {
        return switch (decision) {
            case MATCH -> "Your face matches your " + docName + ".";
            case REVIEW -> "We could not confirm the match with enough confidence. Rescan the " + docName
                    + " in good light, without glare, or start again without glasses.";
            case NO_MATCH -> "The face on the " + docName + " does not match your selfie.";
        };
    }

    private static double round(double v) {
        return Math.round(v * 1_000_000d) / 1_000_000d;
    }

    /** "CODE=OUTCOME" pairs for logs (no field values). */
    private static List<String> checkSummary(List<CheckDraft> checks) {
        return checks.stream().map(c -> c.code() + "=" + c.outcome()).toList();
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    /** Map.of that tolerates null values. */
    static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            if (kv[i + 1] != null) {
                m.put((String) kv[i], kv[i + 1]);
            }
        }
        return m;
    }
}
