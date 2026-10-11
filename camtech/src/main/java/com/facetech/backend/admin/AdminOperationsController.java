package com.facetech.backend.admin;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.ReviewAction;
import com.facetech.backend.domain.ReviewCase;
import com.facetech.backend.domain.VerificationDecision;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.OutboxService;
import com.facetech.backend.platform.ReasonCatalog;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantSettingsService;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.DocumentScanRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.ReviewActionRepository;
import com.facetech.backend.repository.ReviewCaseRepository;
import com.facetech.backend.repository.VerificationCheckRepository;
import com.facetech.backend.repository.VerificationDecisionRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.repository.VerificationStepRepository;
import com.facetech.backend.verification.SessionSupport;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Dashboard, verification sessions, images and the review queue. */
@Slf4j
@RestController
@RequestMapping("/v2/admin")
public class AdminOperationsController {

    /** Dashboard days are counted in UAE time. */
    private static final ZoneId ZONE = ZoneId.of("Asia/Dubai");

    private final VerificationSessionRepository sessionRepository;
    private final VerificationStepRepository stepRepository;
    private final VerificationCheckRepository checkRepository;
    private final VerificationDecisionRepository decisionRepository;
    private final ReviewCaseRepository reviewCaseRepository;
    private final ReviewActionRepository reviewActionRepository;
    private final IdentityDocumentRepository documentRepository;
    private final ClientAppRepository clientAppRepository;
    private final MediaFileRepository mediaRepository;
    private final DocumentScanRepository scanRepository;
    private final MediaStorageService media;
    private final SessionSupport support;
    private final OutboxService outbox;
    private final AuditService audit;
    private final ReasonCatalog reasons;
    private final AdminViews views;
    private final TenantSettingsService tenantSettings;

    public AdminOperationsController(VerificationSessionRepository sessionRepository,
                                     VerificationStepRepository stepRepository,
                                     VerificationCheckRepository checkRepository,
                                     VerificationDecisionRepository decisionRepository,
                                     ReviewCaseRepository reviewCaseRepository,
                                     ReviewActionRepository reviewActionRepository,
                                     IdentityDocumentRepository documentRepository,
                                     ClientAppRepository clientAppRepository, MediaFileRepository mediaRepository,
                                     DocumentScanRepository scanRepository,
                                     MediaStorageService media, SessionSupport support, OutboxService outbox,
                                     AuditService audit, ReasonCatalog reasons, AdminViews views,
                                     TenantSettingsService tenantSettings) {
        this.sessionRepository = sessionRepository;
        this.stepRepository = stepRepository;
        this.checkRepository = checkRepository;
        this.decisionRepository = decisionRepository;
        this.reviewCaseRepository = reviewCaseRepository;
        this.reviewActionRepository = reviewActionRepository;
        this.documentRepository = documentRepository;
        this.clientAppRepository = clientAppRepository;
        this.mediaRepository = mediaRepository;
        this.scanRepository = scanRepository;
        this.media = media;
        this.support = support;
        this.outbox = outbox;
        this.audit = audit;
        this.reasons = reasons;
        this.views = views;
        this.tenantSettings = tenantSettings;
    }

    // ================================================================ dashboard

    @GetMapping("/dashboard")
    @Transactional(readOnly = true)
    public Map<String, Object> dashboard(@RequestParam(defaultValue = "14") int days) {
        int window = Math.max(1, Math.min(days, 90));
        Long tenantId = tenant();
        LocalDate today = LocalDate.now(ZONE);
        LocalDate first = today.minusDays(window - 1L);
        Instant from = first.atStartOfDay(ZONE).toInstant();
        // Counted by the database: only a few hundred grouped rows come back, whatever the traffic.
        List<SessionCount> sessions = sessionRepository.countForDashboard(tenantId, from).stream()
                .map(r -> new SessionCount((Codes.Decision) r[0], (Codes.SessionStatus) r[1], (String) r[2],
                        (Codes.Channel) r[3], (Long) r[4], ((Number) r[5]).longValue()))
                .toList();

        Map<String, Long> totals = new LinkedHashMap<>();
        totals.put("sessions", count(sessions, s -> true));
        totals.put("approved", count(sessions, s -> s.decision() == Codes.Decision.APPROVED));
        totals.put("review", count(sessions, s -> s.decision() == Codes.Decision.REVIEW));
        totals.put("rejected", count(sessions, s -> s.decision() == Codes.Decision.REJECTED));
        totals.put("inProgress", count(sessions, s -> s.status().isOpen()));
        totals.put("expired", count(sessions, s -> s.status() == Codes.SessionStatus.EXPIRED));
        totals.put("failed", count(sessions, s -> s.status() == Codes.SessionStatus.FAILED));
        long decided = totals.get("approved") + totals.get("review") + totals.get("rejected");

        List<Map<String, Object>> daily = new ArrayList<>();
        for (LocalDate d = first; !d.isAfter(today); d = d.plusDays(1)) {
            long[] r = new long[4];
            for (Object[] row : sessionRepository.countDecisions(tenantId, d.atStartOfDay(ZONE).toInstant(),
                    d.plusDays(1).atStartOfDay(ZONE).toInstant())) {
                Codes.Decision decision = (Codes.Decision) row[0];
                int idx = decision == Codes.Decision.APPROVED ? 0 : decision == Codes.Decision.REVIEW ? 1
                        : decision == Codes.Decision.REJECTED ? 2 : 3;
                r[idx] += ((Number) row[1]).longValue();
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date", d.toString());
            m.put("approved", r[0]);
            m.put("review", r[1]);
            m.put("rejected", r[2]);
            m.put("other", r[3]);
            daily.add(m);
        }

        Map<String, Long> reasonCounts = new HashMap<>();
        for (Object[] row : stepRepository.countReasons(tenantId, Codes.StepStatus.FAILED, from)) {
            reasonCounts.put((String) row[0], ((Number) row[1]).longValue());
        }
        List<Map<String, Object>> topReasons = reasonCounts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed()).limit(8)
                .map(e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("code", e.getKey());
                    String msg = reasons.message(e.getKey(), "en");
                    m.put("message", msg != null ? msg : e.getKey());
                    m.put("count", e.getValue());
                    return m;
                }).toList();

        Double avgScore = checkRepository.averageScore(tenantId, "SELFIE_VS_DOC_PHOTO", Codes.CheckOutcome.PASS, from);
        OptionalDouble avg = avgScore == null ? OptionalDouble.empty() : OptionalDouble.of(avgScore);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("days", window);
        out.put("totals", totals);
        out.put("approvalRate", decided == 0 ? null : totals.get("approved") / (double) decided);
        out.put("avgDocMatchSimilarity", avg.isPresent() ? Math.round(avg.getAsDouble() * 10000) / 10000.0 : null);
        out.put("pendingReviews", reviewCaseRepository.countByTenantIdAndStatusIn(tenantId,
                List.of(Codes.ReviewStatus.OPEN, Codes.ReviewStatus.IN_REVIEW)));
        out.put("daily", daily);
        out.put("topFailureReasons", topReasons);
        out.put("byFlow", group(sessions, SessionCount::flowCode, "flowCode"));
        out.put("byChannel", group(sessions, s -> s.channel().name(), "channel"));
        Map<Long, String> appCodes = clientAppRepository.findByTenantIdOrderByCode(tenantId).stream()
                .collect(Collectors.toMap(ClientApp::getId, ClientApp::getCode));
        out.put("byClientApp", group(sessions, s -> appCodes.getOrDefault(s.clientAppId(), "UNKNOWN"), "clientAppCode"));
        out.put("scans", scanRepository.countByTenantIdAndCreatedAtGreaterThanEqual(tenantId, from));
        return out;
    }

    // ================================================================ sessions

    @GetMapping("/sessions")
    @Transactional(readOnly = true)
    public AdminViews.PageView<AdminViews.SessionSummary> sessions(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status, @RequestParam(required = false) String decision,
            @RequestParam(required = false) String flowCode, @RequestParam(required = false) String channel,
            @RequestParam(required = false) String clientAppCode, @RequestParam(required = false) String from,
            @RequestParam(required = false) String to, @RequestParam(required = false) String q) {
        log.debug("Admin session search: page={} size={} status={} decision={} flow={} channel={} app={} from={} to={} q={}",
                page, size, status, decision, flowCode, channel, clientAppCode, from, to, q != null && !q.isBlank());
        Long appId = clientAppCode == null || clientAppCode.isBlank() ? null
                : clientAppRepository.findByTenantIdAndCode(tenant(), clientAppCode).map(ClientApp::getId).orElse(-1L);
        Page<VerificationSession> result = sessionRepository.search(tenant(),
                AdminParams.enumOrNull(Codes.SessionStatus.class, status),
                AdminParams.enumOrNull(Codes.Decision.class, decision),
                AdminParams.blankToNull(flowCode),
                AdminParams.enumOrNull(Codes.Channel.class, channel),
                appId, AdminParams.startOfDay(from), AdminParams.endOfDay(to), AdminParams.like(q),
                AdminParams.page(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return AdminViews.PageView.of(result, views.sessions(result.getContent()));
    }

    @GetMapping("/sessions/{publicId}")
    @Transactional(readOnly = true)
    public AdminViews.SessionDetail session(@PathVariable String publicId) {
        return views.session(sessionByPublicId(publicId));
    }

    @PostMapping("/sessions/{publicId}/cancel")
    @AdminAccess(Codes.AdminRole.REVIEWER)
    @Transactional
    public AdminViews.SessionDetail cancel(@PathVariable String publicId) {
        VerificationSession s = sessionByPublicId(publicId);
        if (!s.getStatus().isOpen()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "SESSION_CLOSED", "Only open verifications can be cancelled");
        }
        s.setStatus(Codes.SessionStatus.CANCELLED);
        s.setCompletedAt(Instant.now());
        outbox.publish("SESSION", s.getPublicId(), Codes.EVENT_SESSION_COMPLETED, support.eventData(s));
        audit.record("SESSION_CANCELLED", "verification_session", s.getPublicId(), null);
        log.info("Verification session cancelled by {}: tenantId={} session={} flow={}",
                actor(), s.getTenantId(), s.getPublicId(), s.getFlowCode());
        return views.session(s);
    }

    // ================================================================ media

    @GetMapping("/media/{id}")
    @Transactional
    public ResponseEntity<byte[]> mediaFile(@PathVariable Long id) {
        MediaFile m = mediaRepository.findById(id).filter(x -> x.getTenantId().equals(tenant())
                        || (RequestContext.get().getAdminUser() != null
                        && tenantSettings.camtechReviewedTenants().contains(x.getTenantId())))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Image not found"));
        byte[] bytes = media.read(m);
        audit.record("MEDIA_VIEWED", "media_file", m.getId(), null);
        log.info("Media viewed by {}: tenantId={} mediaId={} mimeType={} bytes={}",
                actor(), m.getTenantId(), m.getId(), m.getMimeType(), bytes != null ? bytes.length : 0);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(m.getMimeType()))
                .cacheControl(CacheControl.maxAge(10, TimeUnit.MINUTES).cachePrivate())
                .body(bytes);
    }

    // ================================================================ review cases

    public record AssignRequest(String assignee) {
    }

    public record NoteRequest(String note) {
    }

    public record DecideRequest(String decision, String note) {
    }

    public record ActionView(Long id, String action, String actor, String note, Instant createdAt) {
    }

    public record ReviewCaseDetail(Long id, String sessionPublicId, String status, String reason, Double finalSimilarity,
                                   String assignedTo, String partyName, String documentType, Instant createdAt,
                                   Instant updatedAt, AdminViews.SessionDetail session, List<ActionView> actions) {
    }

    @GetMapping("/review-cases")
    @Transactional(readOnly = true)
    public AdminViews.PageView<AdminViews.ReviewCaseSummary> reviewCases(
            @RequestParam(required = false) String status, @RequestParam(required = false) String assignedTo,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        Codes.ReviewStatus st = AdminParams.enumOrNull(Codes.ReviewStatus.class, status);
        org.springframework.data.domain.Pageable pageable = AdminParams.page(page, size, Sort.by(Sort.Direction.ASC, "createdAt"));
        // camtech operators review the default tenant's cases and those of tenants that leave reviews to camtech.
        Page<ReviewCase> result = RequestContext.get().getAdminUser() != null
                ? reviewCaseRepository.searchIn(tenantSettings.camtechReviewedTenants(), st, AdminParams.blankToNull(assignedTo), pageable)
                : reviewCaseRepository.search(tenant(), st, AdminParams.blankToNull(assignedTo), pageable);
        Map<Long, VerificationSession> sessions = sessionRepository.findAllById(
                        result.getContent().stream().map(ReviewCase::getSessionId).toList()).stream()
                .collect(Collectors.toMap(VerificationSession::getId, Function.identity()));
        return AdminViews.PageView.of(result, views.reviewCases(result.getContent(), sessions));
    }

    @GetMapping("/review-cases/{id}")
    @Transactional(readOnly = true)
    public ReviewCaseDetail reviewCase(@PathVariable Long id) {
        return detail(reviewCaseById(id));
    }

    @PostMapping("/review-cases/{id}/assign")
    @AdminAccess(Codes.AdminRole.REVIEWER)
    @Transactional
    public ReviewCaseDetail assign(@PathVariable Long id, @RequestBody(required = false) AssignRequest body) {
        ReviewCase rc = openCase(id);
        String assignee = body != null && body.assignee() != null && !body.assignee().isBlank()
                ? body.assignee().trim() : me();
        rc.setAssignedTo(assignee);
        rc.setStatus(Codes.ReviewStatus.IN_REVIEW);
        action(rc, Codes.ReviewActionType.ASSIGNED, "Assigned to " + assignee);
        audit.record("REVIEW_ASSIGNED", "review_case", rc.getId(), Map.of("assignee", assignee));
        log.info("Review case assigned by {}: reviewCaseId={} sessionId={} assignee={}",
                actor(), rc.getId(), rc.getSessionId(), assignee);
        return detail(rc);
    }

    @PostMapping("/review-cases/{id}/comment")
    @AdminAccess(Codes.AdminRole.REVIEWER)
    @Transactional
    public ReviewCaseDetail comment(@PathVariable Long id, @RequestBody NoteRequest body) {
        ReviewCase rc = reviewCaseById(id);
        if (RequestContext.get().getTenantUser() != null && !tenantSettings.tenantReviews(rc.getTenantId())) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "REVIEW_OWNED_BY_CAMTECH",
                    "camtech reviews this tenant's verifications");
        }
        String note = AdminParams.required(body != null ? body.note() : null, "note");
        action(rc, Codes.ReviewActionType.COMMENTED, note);
        log.info("Review case comment added by {}: reviewCaseId={} length={}", actor(), rc.getId(), note.length());
        return detail(rc);
    }

    @PostMapping("/review-cases/{id}/decide")
    @AdminAccess(Codes.AdminRole.REVIEWER)
    @Transactional
    public ReviewCaseDetail decide(@PathVariable Long id, @RequestBody DecideRequest body) {
        ReviewCase rc = openCase(id);
        Codes.Decision decision = AdminParams.enumOrNull(Codes.Decision.class, body.decision());
        if (decision != Codes.Decision.APPROVED && decision != Codes.Decision.REJECTED) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "decision must be APPROVED or REJECTED");
        }
        String note = AdminParams.required(body.note(), "note");
        VerificationSession s = sessionRepository.findById(rc.getSessionId()).orElseThrow();
        Instant now = Instant.now();
        VerificationDecision d = decisionRepository.findBySessionId(s.getId()).orElseGet(() -> {
            VerificationDecision n = new VerificationDecision();
            n.setTenantId(s.getTenantId());
            n.setSessionId(s.getId());
            n.setFinalSimilarity(rc.getFinalSimilarity());
            return n;
        });
        d.setDecision(decision);
        d.setDecidedBy(Codes.DecidedBy.USER);
        d.setDecidedByUser(me());
        d.setReason(SessionSupport.truncate(note, 1000));
        d.setDecidedAt(now);
        decisionRepository.save(d);
        s.setDecision(decision);
        s.setStatus(Codes.SessionStatus.COMPLETED);
        if (s.getCompletedAt() == null) {
            s.setCompletedAt(now);
        }
        if (decision == Codes.Decision.APPROVED) {
            support.enrollTemplates(s);
            if (s.getDocumentId() != null) {
                documentRepository.findById(s.getDocumentId()).ifPresent(doc -> doc.setStatus(Codes.DocumentStatus.VERIFIED));
            }
        }
        rc.setStatus(decision == Codes.Decision.APPROVED ? Codes.ReviewStatus.APPROVED : Codes.ReviewStatus.REJECTED);
        rc.setDecidedAt(now);
        if (rc.getAssignedTo() == null) {
            rc.setAssignedTo(me());
        }
        action(rc, decision == Codes.Decision.APPROVED ? Codes.ReviewActionType.APPROVED : Codes.ReviewActionType.REJECTED, note);
        Map<String, Object> data = support.eventData(s);
        data.put("reviewCaseId", rc.getId());
        boolean byCamtech = RequestContext.get().getAdminUser() != null;
        data.put("decidedBy", byCamtech ? "CAMTECH" : "TENANT");
        if (!byCamtech) {
            data.put("reviewer", me());
        }
        outbox.publish("REVIEW_CASE", String.valueOf(rc.getId()), Codes.EVENT_REVIEW_DECIDED, data);
        audit.record("REVIEW_DECIDED", "review_case", rc.getId(), Map.of("decision", decision.name()));
        log.info("Review case decided by {}: reviewCaseId={} session={} decision={} reviewStatus={}",
                actor(), rc.getId(), s.getPublicId(), decision, rc.getStatus());
        return detail(rc);
    }

    // ================================================================ helpers

    private ReviewCaseDetail detail(ReviewCase rc) {
        VerificationSession s = sessionRepository.findById(rc.getSessionId()).orElseThrow();
        AdminViews.SessionDetail session = views.session(s);
        List<ActionView> actions = reviewActionRepository.findByReviewCaseIdOrderByIdAsc(rc.getId()).stream()
                .map(a -> new ActionView(a.getId(), a.getAction().name(), a.getActor(), a.getNote(), a.getCreatedAt()))
                .toList();
        return new ReviewCaseDetail(rc.getId(), s.getPublicId(), rc.getStatus().name(), rc.getReason(),
                rc.getFinalSimilarity() != null ? rc.getFinalSimilarity().doubleValue() : null, rc.getAssignedTo(),
                session.partyName(), s.getDocumentType(), rc.getCreatedAt(), rc.getUpdatedAt(), session, actions);
    }

    private void action(ReviewCase rc, Codes.ReviewActionType type, String note) {
        ReviewAction a = new ReviewAction();
        a.setTenantId(rc.getTenantId());
        a.setReviewCaseId(rc.getId());
        a.setAction(type);
        a.setActor(me());
        a.setNote(SessionSupport.truncate(note, 2000));
        reviewActionRepository.save(a);
    }

    /**
     * A camtech operator works on the case as its tenant (so enrolment, events and audit land there); a tenant
     * user only sees its own tenant's cases.
     */
    private ReviewCase reviewCaseById(Long id) {
        RequestContext ctx = RequestContext.get();
        boolean admin = ctx.getAdminUser() != null;
        ReviewCase rc = reviewCaseRepository.findById(id)
                .filter(r -> admin ? tenantSettings.camtechReviewedTenants().contains(r.getTenantId())
                        : r.getTenantId().equals(tenant()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Review case not found"));
        if (admin) {
            ctx.setTenantId(rc.getTenantId());
        }
        return rc;
    }

    private ReviewCase openCase(Long id) {
        ReviewCase rc = reviewCaseById(id);
        if (RequestContext.get().getTenantUser() != null && !tenantSettings.tenantReviews(rc.getTenantId())) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "REVIEW_OWNED_BY_CAMTECH",
                    "camtech reviews this tenant's verifications");
        }
        if (rc.getStatus().isClosed()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "REVIEW_CLOSED", "This case was already decided");
        }
        return rc;
    }

    private VerificationSession sessionByPublicId(String publicId) {
        return sessionRepository.findByPublicId(publicId).filter(s -> s.getTenantId().equals(tenant()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Verification not found"));
    }

    /** One grouped row of the dashboard query. */
    private record SessionCount(Codes.Decision decision, Codes.SessionStatus status, String flowCode,
                                Codes.Channel channel, Long clientAppId, long count) {
    }

    private static long count(List<SessionCount> sessions, java.util.function.Predicate<SessionCount> p) {
        return sessions.stream().filter(p).mapToLong(SessionCount::count).sum();
    }

    private static List<Map<String, Object>> group(List<SessionCount> sessions,
                                                   Function<SessionCount, String> key, String keyName) {
        Map<String, Long> counts = new HashMap<>();
        for (SessionCount s : sessions) {
            counts.merge(key.apply(s), s.count(), Long::sum);
        }
        return counts.entrySet().stream().sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .map(e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put(keyName, e.getKey());
                    m.put("count", e.getValue());
                    return m;
                }).toList();
    }

    private static Long tenant() {
        return RequestContext.get().getTenantId();
    }

    /** The reviewer: a back-office user, or the signed-in tenant portal user. */
    private static String me() {
        RequestContext ctx = RequestContext.get();
        return ctx.getAdminUser() != null ? ctx.getAdminUser().getUsername() : com.facetech.backend.domain.Actor.current();
    }

    /** Who made a change, for the log: a back-office user, or the tenant portal (which reuses these handlers). */
    private static String actor() {
        RequestContext ctx = RequestContext.get();
        if (ctx.getAdminUser() != null) {
            return "adminUserId=" + ctx.getAdminUser().getId();
        }
        return "portalTenant=" + ctx.getPortalTenantCode()
                + (ctx.getTenantUser() != null ? " tenantUserId=" + ctx.getTenantUser().getId() : "");
    }

}
