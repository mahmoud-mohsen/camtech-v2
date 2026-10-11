package com.facetech.backend.admin;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentScan;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.OcrCall;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.PartyOrganization;
import com.facetech.backend.domain.PartyPerson;
import com.facetech.backend.domain.RefDocumentType;
import com.facetech.backend.domain.RefIssuer;
import com.facetech.backend.domain.ReviewCase;
import com.facetech.backend.domain.StepMedia;
import com.facetech.backend.domain.VerificationCheck;
import com.facetech.backend.domain.VerificationDecision;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.DeviceRepository;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.OcrCallRepository;
import com.facetech.backend.repository.OutboxEventRepository;
import com.facetech.backend.repository.PartyOrganizationRepository;
import com.facetech.backend.repository.PartyPersonRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.repository.RefIssuerRepository;
import com.facetech.backend.repository.ReviewCaseRepository;
import com.facetech.backend.repository.StepMediaRepository;
import com.facetech.backend.repository.VerificationCheckRepository;
import com.facetech.backend.repository.VerificationDecisionRepository;
import com.facetech.backend.repository.VerificationStepRepository;
import com.facetech.backend.service.ScanReviewPolicy;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Response shapes of the admin API (docs/admin-api.md) and the code that builds them. */
@Component
public class AdminViews {

    // ================================================================ shapes

    public record PageView<T>(List<T> items, int page, int size, long total) {
        public static <T> PageView<T> of(Page<?> page, List<T> items) {
            return new PageView<>(items, page.getNumber(), page.getSize(), page.getTotalElements());
        }
    }

    public record SessionSummary(String publicId, String flowCode, String status, String decision, String channel,
                                 String clientAppCode, Long partyId, String partyName, String subjectRef,
                                 String documentType, String documentNumber, Double finalSimilarity,
                                 int livenessAttempts, int documentAttempts, Instant createdAt, Instant expiresAt,
                                 Instant completedAt) {
    }

    public record DeviceView(Long id, String deviceRef, String platform, String osVersion, String appVersion,
                             String model, String attestationStatus) {
    }

    public record MediaRef(Long id, String role, String mimeType, long byteCount, Integer width, Integer height,
                           Instant createdAt, boolean purged) {
    }

    public record CheckView(Long id, String checkCode, Double score, String thresholdUsed, String outcome,
                            Map<String, Object> details) {
    }

    public record StepView(Long id, String stepCode, int attemptNo, String status, String reasonCode,
                           String reasonMessage, Instant startedAt, Instant endedAt, List<CheckView> checks,
                           List<MediaRef> media) {
    }

    public record DecisionView(String decision, String decidedBy, String decidedByUser, String reason,
                               Double finalSimilarity, Instant decidedAt) {
    }

    public record ReviewCaseSummary(Long id, String sessionPublicId, String status, String reason,
                                    Double finalSimilarity, String assignedTo, String partyName, String documentType,
                                    Instant createdAt, Instant updatedAt, Long tenantId) {
    }

    public record EventView(String eventType, String status, Instant createdAt) {
    }

    public record SessionDetail(String publicId, String flowCode, String status, String channel,
                                String clientAppCode, Long partyId, String partyName, String subjectRef,
                                String documentType, String documentNumber, Double finalSimilarity,
                                int livenessAttempts, int documentAttempts, Instant createdAt, Instant expiresAt,
                                Instant completedAt, DeviceView device, String ipAddress, String userAgent,
                                List<StepView> steps, DocumentSummary document, DecisionView decision,
                                ReviewCaseSummary reviewCase, List<EventView> events,
                                boolean enrollFace, boolean faceRegistered) {
    }

    public record DocumentSummary(Long id, Long partyId, String partyName, String docTypeCode, String issuerCode,
                                  String documentNumber, String issuingCountry, LocalDate issueDate,
                                  LocalDate expiryDate, String status, Instant createdAt) {
    }

    public record ScanSummary(Long id, String publicId, Long documentId, String docTypeCode, String status,
                              BigDecimal confidence, Long processingMs, String errorMessage, String ocrProvider,
                              Instant createdAt, List<AdminRecordsController.ReviewReasonView> reviewReasons) {
    }

    public record PartySummary(Long id, String publicId, String partyType, String externalRef, String status,
                               String displayName, String nationality, LocalDate dateOfBirth, int documentsCount,
                               int sessionsCount, Instant lastVerifiedAt, Instant createdAt) {
    }

    // ================================================================ builders

    private final ClientAppRepository clientAppRepository;
    private final FaceTemplateRepository templateRepository;
    private final PartyRepository partyRepository;
    private final PartyPersonRepository personRepository;
    private final PartyOrganizationRepository organizationRepository;
    private final IdentityDocumentRepository documentRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final RefIssuerRepository issuerRepository;
    private final VerificationStepRepository stepRepository;
    private final VerificationCheckRepository checkRepository;
    private final StepMediaRepository stepMediaRepository;
    private final VerificationDecisionRepository decisionRepository;
    private final ReviewCaseRepository reviewCaseRepository;
    private final MediaFileRepository mediaRepository;
    private final DeviceRepository deviceRepository;
    private final OutboxEventRepository outboxRepository;
    private final OcrCallRepository ocrCallRepository;
    private final ObjectMapper objectMapper;

    public AdminViews(ClientAppRepository clientAppRepository, PartyRepository partyRepository,
                      PartyPersonRepository personRepository, PartyOrganizationRepository organizationRepository,
                      IdentityDocumentRepository documentRepository, RefDocumentTypeRepository docTypeRepository,
                      RefIssuerRepository issuerRepository, VerificationStepRepository stepRepository,
                      VerificationCheckRepository checkRepository, StepMediaRepository stepMediaRepository,
                      VerificationDecisionRepository decisionRepository, ReviewCaseRepository reviewCaseRepository,
                      MediaFileRepository mediaRepository, DeviceRepository deviceRepository,
                      OutboxEventRepository outboxRepository, OcrCallRepository ocrCallRepository,
                      FaceTemplateRepository templateRepository, ObjectMapper objectMapper) {
        this.clientAppRepository = clientAppRepository;
        this.templateRepository = templateRepository;
        this.partyRepository = partyRepository;
        this.personRepository = personRepository;
        this.organizationRepository = organizationRepository;
        this.documentRepository = documentRepository;
        this.docTypeRepository = docTypeRepository;
        this.issuerRepository = issuerRepository;
        this.stepRepository = stepRepository;
        this.checkRepository = checkRepository;
        this.stepMediaRepository = stepMediaRepository;
        this.decisionRepository = decisionRepository;
        this.reviewCaseRepository = reviewCaseRepository;
        this.mediaRepository = mediaRepository;
        this.deviceRepository = deviceRepository;
        this.outboxRepository = outboxRepository;
        this.ocrCallRepository = ocrCallRepository;
        this.objectMapper = objectMapper;
    }

    public List<SessionSummary> sessions(Collection<VerificationSession> sessions) {
        if (sessions.isEmpty()) {
            return List.of();
        }
        List<Long> ids = sessions.stream().map(VerificationSession::getId).toList();
        Map<Long, String> apps = clientAppRepository.findAll().stream()
                .collect(Collectors.toMap(ClientApp::getId, ClientApp::getCode));
        Map<Long, String> names = names(sessions.stream().map(VerificationSession::getPartyId).filter(Objects::nonNull).toList());
        Map<Long, IdentityDocument> docs = byId(documentRepository.findByIdIn(
                sessions.stream().map(VerificationSession::getDocumentId).filter(Objects::nonNull).toList()), IdentityDocument::getId);
        Map<Long, VerificationDecision> decisions = decisionRepository.findBySessionIdIn(ids).stream()
                .collect(Collectors.toMap(VerificationDecision::getSessionId, Function.identity(), (a, b) -> a));
        Map<Long, int[]> attempts = new HashMap<>();
        for (VerificationStep st : stepRepository.findBySessionIdInOrderByIdAsc(ids)) {
            int[] a = attempts.computeIfAbsent(st.getSessionId(), k -> new int[2]);
            if (Codes.LIVENESS.equals(st.getStepCode())) {
                a[0]++;
            } else if (Codes.DOC_CAPTURE.equals(st.getStepCode())) {
                a[1]++;
            }
        }
        return sessions.stream().map(s -> {
            IdentityDocument d = s.getDocumentId() != null ? docs.get(s.getDocumentId()) : null;
            VerificationDecision dec = decisions.get(s.getId());
            int[] a = attempts.getOrDefault(s.getId(), new int[2]);
            return new SessionSummary(s.getPublicId(), s.getFlowCode(), s.getStatus().name(),
                    s.getDecision() != null ? s.getDecision().name() : null, s.getChannel().name(),
                    apps.get(s.getClientAppId()), s.getPartyId(), names.get(s.getPartyId()), s.getSubjectRef(),
                    s.getDocumentType(), d != null ? d.getDocumentNumber() : null,
                    dec != null && dec.getFinalSimilarity() != null ? dec.getFinalSimilarity().doubleValue() : null,
                    a[0], a[1], s.getCreatedAt(), s.getExpiresAt(), s.getCompletedAt());
        }).toList();
    }

    public SessionDetail session(VerificationSession s) {
        SessionSummary sum = sessions(List.of(s)).get(0);
        List<VerificationStep> steps = stepRepository.findBySessionIdOrderByIdAsc(s.getId());
        List<Long> stepIds = steps.stream().map(VerificationStep::getId).toList();
        Map<Long, List<VerificationCheck>> checks = stepIds.isEmpty() ? Map.of()
                : checkRepository.findByStepIdInOrderByIdAsc(stepIds).stream().collect(Collectors.groupingBy(VerificationCheck::getStepId));
        List<StepMedia> stepMedia = stepIds.isEmpty() ? List.of() : stepMediaRepository.findByStepIdInOrderByIdAsc(stepIds);
        Map<Long, MediaFile> files = byId(mediaRepository.findByIdIn(stepMedia.stream().map(StepMedia::getMediaId).toList()), MediaFile::getId);
        Map<Long, List<StepMedia>> mediaByStep = stepMedia.stream().collect(Collectors.groupingBy(StepMedia::getStepId));

        List<StepView> stepViews = steps.stream().map(st -> new StepView(st.getId(), st.getStepCode(), st.getAttemptNo(),
                st.getStatus().name(), st.getReasonCode(), st.getReasonMessage(), st.getStartedAt(), st.getEndedAt(),
                checks.getOrDefault(st.getId(), List.of()).stream().map(this::check).toList(),
                mediaByStep.getOrDefault(st.getId(), List.of()).stream()
                        .map(sm -> media(files.get(sm.getMediaId()), sm.getRole())).filter(Objects::nonNull).toList()))
                .toList();

        DeviceView device = s.getDeviceId() == null ? null : deviceRepository.findById(s.getDeviceId())
                .map(d -> new DeviceView(d.getId(), d.getDeviceRef(), d.getPlatform(), d.getOsVersion(), d.getAppVersion(),
                        d.getModel(), d.getAttestationStatus())).orElse(null);
        DocumentSummary doc = s.getDocumentId() == null ? null
                : documentRepository.findById(s.getDocumentId()).map(this::document).orElse(null);
        DecisionView decision = decisionRepository.findBySessionId(s.getId()).map(AdminViews::decision).orElse(null);
        ReviewCaseSummary review = reviewCaseRepository.findBySessionId(s.getId()).map(rc -> reviewCase(rc, s, sum)).orElse(null);
        List<EventView> events = outboxRepository.findByAggregateTypeAndAggregateIdOrderByCreatedAtAsc("SESSION", s.getPublicId())
                .stream().map(e -> new EventView(e.getEventType(), e.getStatus().name(), e.getCreatedAt())).toList();

        return new SessionDetail(sum.publicId(), sum.flowCode(), sum.status(), sum.channel(),
                sum.clientAppCode(), sum.partyId(), sum.partyName(), sum.subjectRef(), sum.documentType(),
                sum.documentNumber(), sum.finalSimilarity(), sum.livenessAttempts(), sum.documentAttempts(),
                sum.createdAt(), sum.expiresAt(), sum.completedAt(), device, s.getIpAddress(), s.getUserAgent(),
                stepViews, doc, decision, review, events, s.isEnrollFace(),
                templateRepository.findBySessionId(s.getId()).stream()
                        .anyMatch(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED));
    }

    public List<ReviewCaseSummary> reviewCases(List<ReviewCase> cases, Map<Long, VerificationSession> sessionsById) {
        List<SessionSummary> sums = sessions(sessionsById.values());
        Map<String, SessionSummary> byPublic = sums.stream().collect(Collectors.toMap(SessionSummary::publicId, x -> x));
        return cases.stream().map(rc -> {
            VerificationSession s = sessionsById.get(rc.getSessionId());
            return reviewCase(rc, s, s != null ? byPublic.get(s.getPublicId()) : null);
        }).toList();
    }

    public ReviewCaseSummary reviewCase(ReviewCase rc, VerificationSession s, SessionSummary sum) {
        return new ReviewCaseSummary(rc.getId(), s != null ? s.getPublicId() : null, rc.getStatus().name(), rc.getReason(),
                rc.getFinalSimilarity() != null ? rc.getFinalSimilarity().doubleValue() : null, rc.getAssignedTo(),
                sum != null ? sum.partyName() : null, s != null ? s.getDocumentType() : null,
                rc.getCreatedAt(), rc.getUpdatedAt(), rc.getTenantId());
    }

    public static DecisionView decision(VerificationDecision d) {
        return new DecisionView(d.getDecision().name(), d.getDecidedBy().name(), d.getDecidedByUser(), d.getReason(),
                d.getFinalSimilarity() != null ? d.getFinalSimilarity().doubleValue() : null, d.getDecidedAt());
    }

    public DocumentSummary document(IdentityDocument d) {
        return documents(List.of(d)).get(0);
    }

    public List<DocumentSummary> documents(Collection<IdentityDocument> docs) {
        Map<Long, String> types = docTypeRepository.findAll().stream().collect(Collectors.toMap(RefDocumentType::getId, RefDocumentType::getCode));
        Map<Long, String> issuers = issuerRepository.findAll().stream().collect(Collectors.toMap(RefIssuer::getId, RefIssuer::getCode));
        Map<Long, String> names = names(docs.stream().map(IdentityDocument::getPartyId).filter(Objects::nonNull).toList());
        return docs.stream().map(d -> new DocumentSummary(d.getId(), d.getPartyId(), names.get(d.getPartyId()),
                types.get(d.getDocTypeId()), d.getIssuerId() != null ? issuers.get(d.getIssuerId()) : null,
                d.getDocumentNumber(), d.getIssuingCountry(), d.getIssueDate(), d.getExpiryDate(), d.getStatus().name(),
                d.getCreatedAt())).toList();
    }

    public List<ScanSummary> scans(Collection<DocumentScan> scans) {
        List<Long> ids = scans.stream().map(DocumentScan::getId).toList();
        Map<Long, String> providers = ids.isEmpty() ? Map.of() : ocrCallRepository.findByScanIdIn(ids).stream()
                .collect(Collectors.toMap(OcrCall::getScanId, OcrCall::getProvider, (a, b) -> b));
        return scans.stream().map(s -> new ScanSummary(s.getId(), s.getPublicId(), s.getDocumentId(), s.getDocTypeCode(),
                s.getStatus().name(), s.getConfidence(), s.getProcessingMs(), s.getErrorMessage(), providers.get(s.getId()),
                s.getCreatedAt(), reviewReasons(s))).toList();
    }

    /** Why a scan waits for review (empty for scans that do not). */
    private static List<AdminRecordsController.ReviewReasonView> reviewReasons(DocumentScan s) {
        return ScanReviewPolicy.decode(s.getReviewReasons()).stream()
                .map(r -> new AdminRecordsController.ReviewReasonView(r.code(), r.field(), r.message())).toList();
    }

    public List<PartySummary> parties(Collection<Party> parties) {
        List<Long> ids = parties.stream().map(Party::getId).toList();
        if (ids.isEmpty()) {
            return List.of();
        }
        Map<Long, PartyPerson> persons = personRepository.findByPartyIdIn(ids).stream()
                .collect(Collectors.toMap(PartyPerson::getPartyId, Function.identity(), (a, b) -> a));
        Map<Long, PartyOrganization> orgs = organizationRepository.findByPartyIdIn(ids).stream()
                .collect(Collectors.toMap(PartyOrganization::getPartyId, Function.identity(), (a, b) -> a));
        Map<Long, Long> docCounts = documentRepository.findByPartyIdInOrderByCreatedAtDesc(ids).stream()
                .collect(Collectors.groupingBy(IdentityDocument::getPartyId, Collectors.counting()));
        return parties.stream().map(p -> {
            PartyPerson pp = persons.get(p.getId());
            PartyOrganization po = orgs.get(p.getId());
            String name = pp != null && pp.getFullNameEn() != null ? pp.getFullNameEn()
                    : po != null ? po.getLegalNameEn() : pp != null ? pp.getFullNameAr() : null;
            return new PartySummary(p.getId(), p.getPublicId(), p.getPartyType().name(), p.getExternalRef(), p.getStatus(),
                    name, pp != null ? pp.getNationality() : null, pp != null ? pp.getDateOfBirth() : null,
                    docCounts.getOrDefault(p.getId(), 0L).intValue(), 0, null, p.getCreatedAt());
        }).toList();
    }

    public MediaRef media(MediaFile m, String role) {
        if (m == null) {
            return null;
        }
        return new MediaRef(m.getId(), role, m.getMimeType(), m.getByteCount(), m.getWidth(), m.getHeight(),
                m.getCreatedAt(), m.getPurgedAt() != null);
    }

    public Map<String, Object> json(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Map.of("raw", json);
        }
    }

    private CheckView check(VerificationCheck c) {
        return new CheckView(c.getId(), c.getCheckCode(), c.getScore() != null ? c.getScore().doubleValue() : null,
                c.getThresholdUsed(), c.getOutcome().name(), json(c.getDetails()));
    }

    /** Person or organization display names by party id. */
    public Map<Long, String> names(Collection<Long> partyIds) {
        Map<Long, String> out = new HashMap<>();
        if (partyIds.isEmpty()) {
            return out;
        }
        for (PartyPerson p : personRepository.findByPartyIdIn(partyIds)) {
            String n = p.getFullNameEn() != null ? p.getFullNameEn() : p.getFullNameAr();
            if (n != null) {
                out.put(p.getPartyId(), n);
            }
        }
        for (PartyOrganization o : organizationRepository.findByPartyIdIn(partyIds)) {
            if (o.getLegalNameEn() != null) {
                out.putIfAbsent(o.getPartyId(), o.getLegalNameEn());
            }
        }
        for (Party p : partyRepository.findAllById(partyIds)) {
            if (!out.containsKey(p.getId()) && p.getExternalRef() != null) {
                out.put(p.getId(), p.getExternalRef());
            }
        }
        return out;
    }

    private static <T> Map<Long, T> byId(List<T> list, Function<T, Long> id) {
        return list.stream().collect(Collectors.toMap(id, Function.identity(), (a, b) -> a));
    }

}
