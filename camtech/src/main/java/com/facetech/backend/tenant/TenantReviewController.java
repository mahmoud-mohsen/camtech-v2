package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminOperationsController;
import com.facetech.backend.admin.AdminParams;
import com.facetech.backend.admin.AdminViews;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.ReviewCase;
import com.facetech.backend.domain.StepMedia;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantSettingsService;
import com.facetech.backend.repository.DocumentScanRepository;
import com.facetech.backend.repository.ReviewCaseRepository;
import com.facetech.backend.repository.StepMediaRepository;
import com.facetech.backend.repository.TenantUserRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.repository.VerificationStepRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Verifications that need a person, decided by the tenant's reviewers when the tenant reviews its own
 * (review.owner = TENANT, the default), plus who reviews and how many items wait. Reviewers see the selfie and
 * the document photo with a match label (STRONG, WEAK, NO_MATCH) but never the raw similarity score.
 */
@Slf4j
@RestController
@RequestMapping("/v2/tenant")
public class TenantReviewController {

    /** Selfie and document images a reviewer compares; challenge frames and the closer selfie stay internal. */
    private static final Set<String> EVIDENCE_ROLES = Set.of("SELFIE_NORMAL", "FRONT", "BACK", "DOCUMENT");

    private final AdminOperationsController operations;
    private final ReviewCaseRepository reviewCaseRepository;
    private final VerificationSessionRepository sessionRepository;
    private final VerificationStepRepository stepRepository;
    private final StepMediaRepository stepMediaRepository;
    private final DocumentScanRepository scanRepository;
    private final TenantUserRepository userRepository;
    private final TenantSettingsService settings;
    private final ConfigService config;
    private final AuditService audit;
    private final AdminViews views;

    public TenantReviewController(AdminOperationsController operations, ReviewCaseRepository reviewCaseRepository,
                                  VerificationSessionRepository sessionRepository, VerificationStepRepository stepRepository,
                                  StepMediaRepository stepMediaRepository, DocumentScanRepository scanRepository,
                                  TenantUserRepository userRepository, TenantSettingsService settings,
                                  ConfigService config, AuditService audit, AdminViews views) {
        this.operations = operations;
        this.reviewCaseRepository = reviewCaseRepository;
        this.sessionRepository = sessionRepository;
        this.stepRepository = stepRepository;
        this.stepMediaRepository = stepMediaRepository;
        this.scanRepository = scanRepository;
        this.userRepository = userRepository;
        this.settings = settings;
        this.config = config;
        this.audit = audit;
        this.views = views;
    }

    // ================================================================ settings and counts

    public record ReviewSettings(String owner, List<String> owners) {
    }

    public record OwnerUpdate(String owner) {
    }

    public record ReviewSummary(String owner, long scansToReview, long verificationsToReview) {
    }

    @GetMapping("/review-settings")
    public ReviewSettings reviewSettings() {
        return new ReviewSettings(settings.reviewOwner(tenantId()), ConfigKey.REVIEW_OWNERS);
    }

    @PutMapping("/review-settings")
    @TenantAccess(Codes.TenantRole.OWNER)
    @Transactional
    public ReviewSettings saveReviewSettings(@RequestBody OwnerUpdate body) {
        String owner = body == null || body.owner() == null ? null : body.owner().trim().toUpperCase();
        String before = settings.reviewOwner(tenantId());
        settings.set(tenantId(), ConfigKey.REVIEW_OWNER, owner);
        audit.record("REVIEW_OWNER_CHANGED", "tenant", RequestContext.get().getPortalTenantCode(),
                Map.of("from", before, "to", owner));
        return reviewSettings();
    }

    @GetMapping("/reviews/summary")
    @Transactional(readOnly = true)
    public ReviewSummary summary() {
        Long tenantId = tenantId();
        return new ReviewSummary(settings.reviewOwner(tenantId),
                scanRepository.countByTenantIdAndStatus(tenantId, Codes.ScanStatus.NEEDS_REVIEW),
                reviewCaseRepository.countByTenantIdAndStatusIn(tenantId,
                        List.of(Codes.ReviewStatus.OPEN, Codes.ReviewStatus.IN_REVIEW)));
    }

    // ================================================================ review cases

    /** matchLabel: STRONG, WEAK or NO_MATCH (null when no face comparison ran). */
    public record CaseSummary(Long id, String sessionPublicId, String status, String reason, String matchLabel,
                              String assignedTo, String partyName, String documentType, Instant createdAt,
                              Instant updatedAt) {
    }

    public record Evidence(Long mediaId, String stepCode, String role) {
    }

    public record Action(Long id, String action, String actor, String note, Instant createdAt) {
    }

    /** canDecide: the tenant reviews its own verifications and this case is still open. */
    public record CaseDetail(Long id, String sessionPublicId, String status, String reason, String matchLabel,
                             String assignedTo, String partyName, String documentType, Instant createdAt,
                             Instant updatedAt, boolean canDecide, List<Evidence> evidence,
                             TenantOperationsController.SessionDetail session, List<Action> actions) {
    }

    @GetMapping("/review-cases")
    @Transactional(readOnly = true)
    public AdminViews.PageView<CaseSummary> cases(@RequestParam(required = false) String status,
                                                  @RequestParam(defaultValue = "false") boolean mine,
                                                  @RequestParam(defaultValue = "0") int page,
                                                  @RequestParam(defaultValue = "20") int size) {
        Page<ReviewCase> result = reviewCaseRepository.search(tenantId(),
                AdminParams.enumOrNull(Codes.ReviewStatus.class, status), mine ? me().getUsername() : null,
                AdminParams.page(page, size, Sort.by(Sort.Direction.ASC, "createdAt")));
        Map<Long, VerificationSession> sessions = sessionRepository.findAllById(
                        result.getContent().stream().map(ReviewCase::getSessionId).toList()).stream()
                .collect(Collectors.toMap(VerificationSession::getId, Function.identity()));
        Set<String> people = tenantUsernames();
        List<AdminViews.ReviewCaseSummary> sums = views.reviewCases(result.getContent(), sessions);
        Map<Long, ReviewCase> byId = result.getContent().stream().collect(Collectors.toMap(ReviewCase::getId, x -> x));
        return AdminViews.PageView.of(result, sums.stream().map(c -> new CaseSummary(c.id(), c.sessionPublicId(),
                c.status(), withoutScore(c.reason()), matchLabel(byId.get(c.id()), sessions.get(byId.get(c.id()).getSessionId())),
                mask(c.assignedTo(), people), c.partyName(), c.documentType(), c.createdAt(), c.updatedAt())).toList());
    }

    @GetMapping("/review-cases/{id}")
    @Transactional(readOnly = true)
    public CaseDetail reviewCase(@PathVariable Long id) {
        return detail(operations.reviewCase(id));
    }

    @PostMapping("/review-cases/{id}/assign")
    @TenantAccess(Codes.TenantRole.REVIEWER)
    public CaseDetail assign(@PathVariable Long id, @RequestBody(required = false) AdminOperationsController.AssignRequest body) {
        if (body != null && body.assignee() != null && !body.assignee().isBlank()
                && !tenantUsernames().contains(body.assignee().trim())) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Assign the case to one of your users");
        }
        return detail(operations.assign(id, body));
    }

    @PostMapping("/review-cases/{id}/comment")
    @TenantAccess(Codes.TenantRole.REVIEWER)
    public CaseDetail comment(@PathVariable Long id, @RequestBody AdminOperationsController.NoteRequest body) {
        return detail(operations.comment(id, body));
    }

    @PostMapping("/review-cases/{id}/decide")
    @TenantAccess(Codes.TenantRole.REVIEWER)
    public CaseDetail decide(@PathVariable Long id, @RequestBody AdminOperationsController.DecideRequest body) {
        return detail(operations.decide(id, body));
    }

    /** The selfie or document image of an open case the tenant reviews; nothing else of the session. */
    @GetMapping("/review-cases/{id}/media/{mediaId}")
    @TenantAccess(Codes.TenantRole.REVIEWER)
    @Transactional(readOnly = true)
    public ResponseEntity<byte[]> evidence(@PathVariable Long id, @PathVariable Long mediaId) {
        ReviewCase rc = reviewCaseRepository.findById(id).filter(r -> r.getTenantId().equals(tenantId()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Review case not found"));
        if (rc.getStatus().isClosed() || !settings.tenantReviews(rc.getTenantId())
                || evidence(rc).stream().noneMatch(e -> e.mediaId().equals(mediaId))) {
            throw new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Image not found");
        }
        ResponseEntity<byte[]> file = operations.mediaFile(mediaId);
        return ResponseEntity.ok().headers(h -> h.setContentType(file.getHeaders().getContentType()))
                .cacheControl(CacheControl.noStore().cachePrivate()).body(file.getBody());
    }

    // ================================================================ helpers

    private CaseDetail detail(AdminOperationsController.ReviewCaseDetail d) {
        ReviewCase rc = reviewCaseRepository.findById(d.id()).orElseThrow();
        VerificationSession s = sessionRepository.findById(rc.getSessionId()).orElseThrow();
        Set<String> people = tenantUsernames();
        boolean canDecide = !rc.getStatus().isClosed() && settings.tenantReviews(rc.getTenantId());
        List<Action> actions = d.actions().stream().map(a -> new Action(a.id(), a.action(),
                "system".equals(a.actor()) ? "system" : mask(a.actor(), people),
                // camtech operators' notes stay internal, like on the verification itself
                people.contains(a.actor()) ? a.note() : "system".equals(a.actor()) ? withoutScore(a.note()) : null,
                a.createdAt())).toList();
        return new CaseDetail(d.id(), d.sessionPublicId(), d.status(), withoutScore(d.reason()), matchLabel(rc, s),
                mask(d.assignedTo(), people), d.partyName(), d.documentType(), d.createdAt(), d.updatedAt(), canDecide,
                canDecide ? evidence(rc) : List.of(), TenantOperationsController.detail(d.session()), actions);
    }

    /** The latest selfie and document images of the case's verification. */
    private List<Evidence> evidence(ReviewCase rc) {
        List<VerificationStep> steps = stepRepository.findBySessionIdOrderByIdAsc(rc.getSessionId());
        Map<Long, VerificationStep> byId = steps.stream().collect(Collectors.toMap(VerificationStep::getId, x -> x));
        List<StepMedia> media = stepMediaRepository.findByStepIdInOrderByIdAsc(byId.keySet());
        Map<String, StepMedia> latest = new java.util.LinkedHashMap<>();
        media.stream().filter(m -> EVIDENCE_ROLES.contains(m.getRole()))
                .sorted(Comparator.comparing(StepMedia::getId))
                .forEach(m -> latest.put(byId.get(m.getStepId()).getStepCode() + "/" + m.getRole(), m));
        return latest.values().stream()
                .map(m -> new Evidence(m.getMediaId(), byId.get(m.getStepId()).getStepCode(), m.getRole())).toList();
    }

    /** STRONG at or above the tenant's match threshold, WEAK at or above its review threshold, else NO_MATCH. */
    private String matchLabel(ReviewCase rc, VerificationSession s) {
        if (rc == null || rc.getFinalSimilarity() == null) {
            return null;
        }
        ConfigService.Scope scope = ConfigService.Scope.of(s != null ? s.getFlowCode() : null);
        double v = rc.getFinalSimilarity().doubleValue();
        if (v >= config.getDouble(ConfigKey.FACE_DOC_MATCH_SIMILARITY, scope)) {
            return "STRONG";
        }
        return v >= config.getDouble(ConfigKey.FACE_REVIEW_SIMILARITY, scope) ? "WEAK" : "NO_MATCH";
    }

    /** "Borderline face match (similarity 0.33)" -> "Borderline face match": scores stay internal. */
    static String withoutScore(String text) {
        return text == null ? null : text.replaceAll("\\s*\\((?:similarity|score)[^)]*\\)", "").trim();
    }

    /** Tenant users keep their name; camtech operators show as "camtech". */
    private static String mask(String actor, Set<String> people) {
        if (actor == null) {
            return null;
        }
        return people.contains(actor) ? actor : "camtech";
    }

    private Set<String> tenantUsernames() {
        return userRepository.findByTenantIdOrderByUsernameAsc(tenantId()).stream().map(TenantUser::getUsername)
                .filter(Objects::nonNull).collect(Collectors.toSet());
    }

    private static TenantUser me() {
        return RequestContext.get().getTenantUser();
    }

    private static Long tenantId() {
        return RequestContext.get().getTenantId();
    }
}
