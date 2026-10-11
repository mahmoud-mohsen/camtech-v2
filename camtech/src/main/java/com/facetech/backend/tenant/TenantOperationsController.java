package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminAuditController;
import com.facetech.backend.admin.AdminConfigController;
import com.facetech.backend.admin.AdminOperationsController;
import com.facetech.backend.admin.AdminRecordsController;
import com.facetech.backend.admin.AdminViews;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.RefDocumentType;
import com.facetech.backend.domain.RefFlowDef;
import com.facetech.backend.domain.Tenant;
import com.facetech.backend.domain.TenantEntitlement;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.repository.RefFlowDefRepository;
import com.facetech.backend.repository.TenantEntitlementRepository;
import com.facetech.backend.service.DocumentScanService;
import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * Tenant portal: the tenant's own verifications, scans, usage and audit log.
 *
 * <p>Same data as the back-office API, always limited to the tenant resolved by
 * {@link TenantPortalFilter}, and without what stays internal to camtech: similarity
 * scores and thresholds, images, IP addresses and reviewers' notes.
 */
@RestController
@RequestMapping("/v2/tenant")
public class TenantOperationsController {

    private final AdminOperationsController operations;
    private final AdminRecordsController records;
    private final AdminAuditController auditLog;
    private final AdminConfigController config;
    private final TenantService tenantService;
    private final EntitlementService entitlements;
    private final TenantEntitlementRepository entitlementRepository;
    private final RefFlowDefRepository flowRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final TenantAttentionService attention;

    public TenantOperationsController(AdminOperationsController operations, AdminRecordsController records,
                                      AdminAuditController auditLog, AdminConfigController config,
                                      TenantService tenantService, EntitlementService entitlements,
                                      TenantEntitlementRepository entitlementRepository,
                                      RefFlowDefRepository flowRepository, RefDocumentTypeRepository docTypeRepository,
                                      TenantAttentionService attention) {
        this.operations = operations;
        this.records = records;
        this.auditLog = auditLog;
        this.config = config;
        this.tenantService = tenantService;
        this.entitlements = entitlements;
        this.entitlementRepository = entitlementRepository;
        this.flowRepository = flowRepository;
        this.docTypeRepository = docTypeRepository;
        this.attention = attention;
    }

    // ================================================================ tenant

    public record Named(String code, String name, boolean enabled) {
    }

    public record Feature(String code, boolean enabled) {
    }

    public record TenantInfo(String code, String name, String status, Instant createdAt, List<Named> flows,
                             List<Named> documentTypes, List<Feature> features) {
    }

    @GetMapping("/info")
    @Transactional(readOnly = true)
    public TenantInfo info() {
        Tenant t = tenantService.currentTenant();
        Map<String, TenantEntitlement> ent = entitlementRepository.findByTenantIdOrderByFeatureTypeAscFeatureCodeAsc(t.getId())
                .stream().collect(Collectors.toMap(e -> e.getFeatureType() + ":" + e.getFeatureCode(), Function.identity()));
        Predicate<TenantEntitlement> active = e -> e != null && entitlements.isActive(e);
        // Every flow the tenant is entitled to; some (DOCUMENT_SCAN, FACE_IDENTIFICATION) have no step definition.
        Map<String, String> flowNames = flowRepository.findAllByOrderByIdAsc().stream()
                .collect(Collectors.toMap(RefFlowDef::getCode, RefFlowDef::getName, (a, b) -> a, LinkedHashMap::new));
        List<Named> flows = ent.values().stream().filter(e -> e.getFeatureType() == Codes.FeatureType.FLOW)
                .map(e -> new Named(e.getFeatureCode(), flowNames.getOrDefault(e.getFeatureCode(), humanize(e.getFeatureCode())),
                        active.test(e)))
                .sorted(Comparator.comparing(Named::code))
                .toList();
        List<Named> docs = docTypeRepository.findAllByOrderByIdAsc().stream()
                .filter(d -> ent.containsKey(Codes.FeatureType.DOCUMENT + ":" + d.getCode()))
                .map((RefDocumentType d) -> new Named(d.getCode(), d.getName(), active.test(ent.get(Codes.FeatureType.DOCUMENT + ":" + d.getCode()))))
                .toList();
        List<Feature> features = ent.values().stream().filter(e -> e.getFeatureType() == Codes.FeatureType.FEATURE)
                .map(e -> new Feature(e.getFeatureCode(), active.test(e))).toList();
        return new TenantInfo(t.getCode(), t.getName(), t.getStatus(), t.getCreatedAt(), flows, docs, features);
    }

    /** DOCUMENT_SCAN -> "Document scan". */
    private static String humanize(String code) {
        String s = code.replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard(@RequestParam(defaultValue = "14") int days) {
        Map<String, Object> out = new LinkedHashMap<>(operations.dashboard(days));
        out.remove("avgDocMatchSimilarity");
        out.put("attention", attention.attention(RequestContext.get().getTenantId()));
        return out;
    }

    @GetMapping("/entitlements")
    public List<AdminConfigController.EntitlementView> entitlements() {
        return config.entitlements();
    }

    @GetMapping("/reason-codes")
    public List<AdminConfigController.ReasonCodeView> reasonCodes() {
        return config.reasonCodes();
    }

    // ================================================================ verifications

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record SessionSummary(String publicId, String flowCode, String status, String decision, String channel,
                                 String clientAppCode, String subjectRef, String partyName, String documentType,
                                 String documentNumber, int livenessAttempts, int documentAttempts,
                                 Instant createdAt, Instant expiresAt, Instant completedAt) {
    }

    public record Device(String platform, String osVersion, String appVersion, String model) {
    }

    public record Check(String checkCode, String outcome) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Step(String stepCode, int attemptNo, String status, String reasonCode, String reasonMessage,
                       Instant startedAt, Instant endedAt, List<Check> checks, int imagesCount) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Document(String docTypeCode, String documentNumber, String issuingCountry, LocalDate expiryDate,
                           String status) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record DecisionDetail(String decision, String decidedBy, String reason, Instant decidedAt) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Review(String status, Instant openedAt, Instant decidedAt) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record SessionDetail(String publicId, String flowCode, String status, String decision, String channel,
                                String clientAppCode, String subjectRef, String partyName, String documentType,
                                String documentNumber, int livenessAttempts, int documentAttempts,
                                Instant createdAt, Instant expiresAt, Instant completedAt, Device device,
                                List<Step> steps, Document document, DecisionDetail decisionDetail, Review review,
                                List<AdminViews.EventView> events, boolean enrollFace, boolean faceRegistered) {
    }

    @GetMapping("/sessions")
    public AdminViews.PageView<SessionSummary> sessions(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status, @RequestParam(required = false) String decision,
            @RequestParam(required = false) String flowCode, @RequestParam(required = false) String channel,
            @RequestParam(required = false) String clientAppCode, @RequestParam(required = false) String from,
            @RequestParam(required = false) String to, @RequestParam(required = false) String q) {
        AdminViews.PageView<AdminViews.SessionSummary> p = operations.sessions(page, size, status, decision, flowCode,
                channel, clientAppCode, from, to, q);
        return new AdminViews.PageView<>(p.items().stream().map(TenantOperationsController::summary).toList(),
                p.page(), p.size(), p.total());
    }

    @GetMapping("/sessions/{publicId}")
    public SessionDetail session(@PathVariable String publicId) {
        return detail(operations.session(publicId));
    }

    @PostMapping("/sessions/{publicId}/cancel")
    @TenantAccess(Codes.TenantRole.REVIEWER)
    public SessionDetail cancel(@PathVariable String publicId) {
        return detail(operations.cancel(publicId));
    }

    static SessionSummary summary(AdminViews.SessionSummary s) {
        return new SessionSummary(s.publicId(), s.flowCode(), s.status(), s.decision(), s.channel(), s.clientAppCode(),
                s.subjectRef(), s.partyName(), s.documentType(), s.documentNumber(), s.livenessAttempts(),
                s.documentAttempts(), s.createdAt(), s.expiresAt(), s.completedAt());
    }

    static SessionDetail detail(AdminViews.SessionDetail d) {
        Device device = d.device() == null ? null
                : new Device(d.device().platform(), d.device().osVersion(), d.device().appVersion(), d.device().model());
        List<Step> steps = d.steps().stream().map(st -> new Step(st.stepCode(), st.attemptNo(), st.status(),
                st.reasonCode(), st.reasonMessage(), st.startedAt(), st.endedAt(),
                st.checks().stream().map(c -> new Check(c.checkCode(), c.outcome())).toList(),
                (int) st.media().stream().filter(m -> !m.purged()).count())).toList();
        Document document = d.document() == null ? null : new Document(d.document().docTypeCode(),
                d.document().documentNumber(), d.document().issuingCountry(), d.document().expiryDate(),
                d.document().status());
        DecisionDetail decision = null;
        if (d.decision() != null) {
            boolean byReviewer = Codes.DecidedBy.USER.name().equals(d.decision().decidedBy());
            // A reviewer's note is internal to camtech; the system's reason is the user-facing one.
            decision = new DecisionDetail(d.decision().decision(), byReviewer ? "REVIEWER" : "SYSTEM",
                    byReviewer ? null : d.decision().reason(), d.decision().decidedAt());
        }
        Review review = null;
        if (d.reviewCase() != null) {
            boolean closed = Codes.ReviewStatus.valueOf(d.reviewCase().status()).isClosed();
            review = new Review(d.reviewCase().status(), d.reviewCase().createdAt(),
                    closed && d.decision() != null ? d.decision().decidedAt() : null);
        }
        return new SessionDetail(d.publicId(), d.flowCode(), d.status(), d.decision() != null ? d.decision().decision() : null,
                d.channel(), d.clientAppCode(), d.subjectRef(), d.partyName(), d.documentType(), d.documentNumber(),
                d.livenessAttempts(), d.documentAttempts(), d.createdAt(), d.expiresAt(), d.completedAt(), device, steps,
                document, decision, review, d.events(), d.enrollFace(), d.faceRegistered());
    }

    // ================================================================ document scans

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ScanSummary(Long id, String publicId, String docTypeCode, String status, Double confidence,
                              Long processingMs, String errorMessage, Instant createdAt,
                              List<AdminRecordsController.ReviewReasonView> reviewReasons) {
    }

    /**
     * @param value         the value in use: the reviewer's when there is one, else what OCR read
     * @param ocrValue      what OCR read
     * @param reviewedValue what a reviewer confirmed or corrected
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ScanField(String fieldCode, String lang, String value, Double confidence, String validationStatus,
                            String validationMessage, String source, String ocrValue, String reviewedValue) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ScanDetail(Long id, String publicId, String docTypeCode, String status, Double confidence,
                             Long processingMs, String errorMessage, Instant createdAt, List<ScanField> fields,
                             List<String> issues, List<AdminRecordsController.ReviewReasonView> reviewReasons,
                             String reviewedBy, Instant reviewedAt, String reviewNote, Long documentId,
                             List<AdminViews.MediaRef> media) {
    }

    @GetMapping("/document-scans")
    public AdminViews.PageView<ScanSummary> scans(@RequestParam(required = false) String status,
                                                  @RequestParam(required = false) String docTypeCode,
                                                  @RequestParam(defaultValue = "0") int page,
                                                  @RequestParam(defaultValue = "20") int size) {
        AdminViews.PageView<AdminViews.ScanSummary> p = records.scans(status, docTypeCode, page, size);
        return new AdminViews.PageView<>(p.items().stream().map(s -> new ScanSummary(s.id(), s.publicId(), s.docTypeCode(),
                s.status(), s.confidence() != null ? s.confidence().doubleValue() : null, s.processingMs(), s.errorMessage(),
                s.createdAt(), s.reviewReasons())).toList(), p.page(), p.size(), p.total());
    }

    @GetMapping("/document-scans/{id}")
    public ScanDetail scan(@PathVariable Long id) {
        return tenantView(records.scan(id));
    }

    /** Approve (with corrections) or reject a scan waiting for review. */
    @PostMapping("/document-scans/{id}/review")
    @TenantAccess(Codes.TenantRole.REVIEWER)
    public ScanDetail reviewScan(@PathVariable Long id, @RequestBody DocumentScanService.ReviewRequest body) {
        return tenantView(records.reviewScan(id, body));
    }

    private static ScanDetail tenantView(AdminRecordsController.ScanDetail s) {
        // camtech operators may review too; who exactly stays internal, like in the audit log.
        String reviewer = s.reviewedBy() == null ? null
                : s.reviewedBy().startsWith("ADMIN:") ? "camtech" : s.reviewedBy().replaceFirst("^TENANT:", "");
        return new ScanDetail(s.id(), s.publicId(), s.docTypeCode(), s.status(),
                s.confidence() != null ? s.confidence().doubleValue() : null, s.processingMs(), s.errorMessage(),
                s.createdAt(), s.fields().stream().map(f -> new ScanField(f.fieldCode(), f.lang(),
                        f.reviewedValue() != null ? f.reviewedValue() : f.rawValue(),
                        f.confidence() != null ? f.confidence().doubleValue() : null, f.validationStatus(),
                        f.validationMessage(), f.source(), f.rawValue(), f.reviewedValue())).toList(),
                s.issues(), s.reviewReasons(), reviewer, s.reviewedAt(), s.reviewNote(), s.documentId(), s.media());
    }

    // ================================================================ audit

    @GetMapping("/audit-events")
    public AdminViews.PageView<AdminAuditController.AuditView> auditEvents(
            @RequestParam(required = false) String actor, @RequestParam(required = false) String actorType,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String entity, @RequestParam(required = false) String from,
            @RequestParam(required = false) String to, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        AdminViews.PageView<AdminAuditController.AuditView> p = auditLog.events(actor, actorType, action, entity, from, to, page, size);
        // camtech operators act on the tenant's data too (reviews, support); who exactly stays internal.
        return new AdminViews.PageView<>(p.items().stream().map(e -> Codes.ActorType.ADMIN.name().equals(e.actorType())
                ? new AdminAuditController.AuditView(e.id(), e.actorType(), "camtech", e.action(), e.entity(),
                        e.entityId(), null, e.details(), e.at())
                : e).toList(), p.page(), p.size(), p.total());
    }
}
