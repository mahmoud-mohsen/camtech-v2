package com.facetech.backend.admin;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentField;
import com.facetech.backend.domain.DocumentMedia;
import com.facetech.backend.domain.DocumentScan;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.PartyOrganization;
import com.facetech.backend.domain.PartyPerson;
import com.facetech.backend.domain.RefDocumentType;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.DocumentFieldRepository;
import com.facetech.backend.repository.DocumentMediaRepository;
import com.facetech.backend.repository.DocumentScanRepository;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.PartyOrganizationRepository;
import com.facetech.backend.repository.PartyPersonRepository;
import com.facetech.backend.repository.PartyRelationRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.repository.ScanFieldResultRepository;
import com.facetech.backend.service.DocumentScanService;
import com.facetech.backend.service.ScanReviewPolicy;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.verification.ErasureService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/** People, identity documents and document scans. */
@Slf4j
@RestController
@RequestMapping("/v2/admin")
public class AdminRecordsController {

    private final PartyRepository partyRepository;
    private final PartyPersonRepository personRepository;
    private final PartyOrganizationRepository organizationRepository;
    private final PartyRelationRepository relationRepository;
    private final IdentityDocumentRepository documentRepository;
    private final DocumentFieldRepository fieldRepository;
    private final DocumentMediaRepository documentMediaRepository;
    private final DocumentScanRepository scanRepository;
    private final ScanFieldResultRepository scanFieldRepository;
    private final FaceTemplateRepository templateRepository;
    private final MediaFileRepository mediaRepository;
    private final VerificationSessionRepository sessionRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final ErasureService erasure;
    private final AuditService audit;
    private final AdminViews views;
    private final DocumentScanService scanService;

    public AdminRecordsController(PartyRepository partyRepository, PartyPersonRepository personRepository,
                                  PartyOrganizationRepository organizationRepository,
                                  PartyRelationRepository relationRepository,
                                  IdentityDocumentRepository documentRepository, DocumentFieldRepository fieldRepository,
                                  DocumentMediaRepository documentMediaRepository, DocumentScanRepository scanRepository,
                                  ScanFieldResultRepository scanFieldRepository, FaceTemplateRepository templateRepository,
                                  MediaFileRepository mediaRepository, VerificationSessionRepository sessionRepository,
                                  RefDocumentTypeRepository docTypeRepository, ErasureService erasure,
                                  AuditService audit, AdminViews views, DocumentScanService scanService) {
        this.partyRepository = partyRepository;
        this.personRepository = personRepository;
        this.organizationRepository = organizationRepository;
        this.relationRepository = relationRepository;
        this.documentRepository = documentRepository;
        this.fieldRepository = fieldRepository;
        this.documentMediaRepository = documentMediaRepository;
        this.scanRepository = scanRepository;
        this.scanFieldRepository = scanFieldRepository;
        this.templateRepository = templateRepository;
        this.mediaRepository = mediaRepository;
        this.sessionRepository = sessionRepository;
        this.docTypeRepository = docTypeRepository;
        this.erasure = erasure;
        this.audit = audit;
        this.views = views;
        this.scanService = scanService;
    }

    // ================================================================ people

    public record PersonView(String fullNameEn, String fullNameAr, LocalDate dateOfBirth, String gender, String nationality) {
    }

    public record OrganizationView(String legalNameEn, String legalNameAr, String legalForm, String issuerCode) {
    }

    public record TemplateView(Long id, String role, String modelVersion, int dimension, BigDecimal qualityScore,
                               String status, Long sourceMediaId, Instant createdAt) {
    }

    public record RelationView(String relationType, Long otherPartyId, String otherPartyName, BigDecimal sharePct) {
    }

    public record PartyDetail(Long id, String publicId, String partyType, String externalRef, String status,
                              String displayName, String nationality, LocalDate dateOfBirth, int documentsCount,
                              int sessionsCount, Instant lastVerifiedAt, Instant createdAt, PersonView person,
                              OrganizationView organization, List<AdminViews.DocumentSummary> documents,
                              List<TemplateView> faceTemplates, List<AdminViews.SessionSummary> sessions,
                              List<RelationView> relations) {
    }

    @GetMapping("/parties")
    @Transactional(readOnly = true)
    public AdminViews.PageView<AdminViews.PartySummary> parties(@RequestParam(required = false) String q,
                                                                @RequestParam(required = false) String partyType,
                                                                @RequestParam(defaultValue = "0") int page,
                                                                @RequestParam(defaultValue = "20") int size) {
        Page<Party> result = partyRepository.search(tenant(), AdminParams.enumOrNull(Codes.PartyType.class, partyType),
                AdminParams.like(q), AdminParams.page(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return AdminViews.PageView.of(result, views.parties(result.getContent()));
    }

    @GetMapping("/parties/{id}")
    @Transactional(readOnly = true)
    public PartyDetail party(@PathVariable Long id) {
        Party p = party0(id);
        AdminViews.PartySummary sum = views.parties(List.of(p)).get(0);
        PartyPerson pp = personRepository.findByPartyId(id).orElse(null);
        PartyOrganization po = organizationRepository.findByPartyId(id).orElse(null);
        List<VerificationSession> sessions = sessionRepository.findByPartyIdOrderByCreatedAtDesc(id);
        Instant lastVerified = sessions.stream().filter(s -> s.getDecision() == Codes.Decision.APPROVED)
                .map(VerificationSession::getCompletedAt).filter(Objects::nonNull).findFirst().orElse(null);
        List<RelationView> relations = relationRepository.findByFromPartyIdOrToPartyId(id, id).stream().map(r -> {
            Long other = r.getFromPartyId().equals(id) ? r.getToPartyId() : r.getFromPartyId();
            return new RelationView(r.getRelationType(), other, views.names(List.of(other)).get(other), r.getSharePct());
        }).toList();
        return new PartyDetail(p.getId(), p.getPublicId(), p.getPartyType().name(), p.getExternalRef(), p.getStatus(),
                sum.displayName(), sum.nationality(), sum.dateOfBirth(), sum.documentsCount(), sessions.size(),
                lastVerified, p.getCreatedAt(),
                pp == null ? null : new PersonView(pp.getFullNameEn(), pp.getFullNameAr(), pp.getDateOfBirth(), pp.getGender(), pp.getNationality()),
                po == null ? null : new OrganizationView(po.getLegalNameEn(), po.getLegalNameAr(), po.getLegalForm(), po.getIssuerCode()),
                views.documents(documentRepository.findByPartyIdOrderByCreatedAtDesc(id)),
                templateRepository.findByPartyIdOrderByCreatedAtDesc(id).stream().map(t -> new TemplateView(t.getId(),
                        t.getRole().name(), t.getModelVersion(), t.getDimension(), t.getQualityScore(), t.getStatus().name(),
                        t.getSourceMediaId(), t.getCreatedAt())).toList(),
                views.sessions(sessions), relations);
    }

    @DeleteMapping("/parties/{id}")
    public ResponseEntity<Void> erase(@PathVariable Long id) {
        party0(id);
        log.info("Party erasure requested by adminUserId={}: tenantId={} partyId={}", adminId(), tenant(), id);
        erasure.erase(id);
        log.info("Party erasure completed: partyId={}", id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/parties/{id}/face-templates/{templateId}/revoke")
    @Transactional
    public ResponseEntity<Void> revokeTemplate(@PathVariable Long id, @PathVariable Long templateId) {
        FaceTemplate t = templateRepository.findById(templateId).filter(x -> id.equals(x.getPartyId()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Face template not found"));
        t.setStatus(Codes.TemplateStatus.REVOKED);
        audit.record("FACE_TEMPLATE_REVOKED", "face_template", t.getId(), Map.of("partyId", id));
        log.info("Face template revoked by adminUserId={}: partyId={} templateId={} role={}",
                adminId(), id, t.getId(), t.getRole());
        return ResponseEntity.noContent().build();
    }

    // ================================================================ documents

    public record FieldView(String fieldCode, String lang, String value, String source, BigDecimal confidence,
                            String groupCode, Integer groupIdx) {
    }

    public record DocumentDetail(Long id, Long partyId, String partyName, String docTypeCode, String issuerCode,
                                 String documentNumber, String issuingCountry, LocalDate issueDate, LocalDate expiryDate,
                                 String status, Instant createdAt, List<FieldView> fields, List<AdminViews.MediaRef> media,
                                 List<AdminViews.ScanSummary> scans) {
    }

    @GetMapping("/documents")
    @Transactional(readOnly = true)
    public AdminViews.PageView<AdminViews.DocumentSummary> documents(
            @RequestParam(required = false) String q, @RequestParam(required = false) String docTypeCode,
            @RequestParam(required = false) String status, @RequestParam(required = false) String expiringBefore,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        Long typeId = AdminParams.blankToNull(docTypeCode) == null ? null
                : docTypeRepository.findByCode(docTypeCode.trim()).map(RefDocumentType::getId).orElse(-1L);
        Page<IdentityDocument> result = documentRepository.search(tenant(), typeId,
                AdminParams.enumOrNull(Codes.DocumentStatus.class, status), AdminParams.date(expiringBefore),
                AdminParams.like(q), AdminParams.page(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return AdminViews.PageView.of(result, views.documents(result.getContent()));
    }

    @GetMapping("/documents/{id}")
    @Transactional(readOnly = true)
    public DocumentDetail document(@PathVariable Long id) {
        IdentityDocument d = documentRepository.findById(id).filter(x -> x.getTenantId().equals(tenant()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Document not found"));
        AdminViews.DocumentSummary sum = views.document(d);
        List<FieldView> fields = fieldRepository.findByDocumentIdOrderByIdAsc(id).stream().map(this::field).toList();
        List<DocumentMedia> links = documentMediaRepository.findByDocumentIdOrderByIdAsc(id);
        Map<Long, MediaFile> files = mediaRepository.findByIdIn(links.stream().map(DocumentMedia::getMediaId).toList())
                .stream().collect(Collectors.toMap(MediaFile::getId, Function.identity()));
        List<AdminViews.MediaRef> media = links.stream().map(l -> views.media(files.get(l.getMediaId()), l.getRole()))
                .filter(Objects::nonNull).toList();
        return new DocumentDetail(sum.id(), sum.partyId(), sum.partyName(), sum.docTypeCode(), sum.issuerCode(),
                sum.documentNumber(), sum.issuingCountry(), sum.issueDate(), sum.expiryDate(), sum.status(),
                sum.createdAt(), fields, media, views.scans(scanRepository.findByDocumentIdOrderByCreatedAtDesc(id)));
    }

    // ================================================================ scans

    /**
     * @param rawValue      what OCR read
     * @param reviewedValue what a reviewer confirmed or corrected (null when not reviewed)
     * @param source        where the value was read (MRZ_VERIFIED, LAYOUT, LABEL...)
     */
    public record ScanFieldView(String fieldCode, String lang, String rawValue, BigDecimal confidence,
                                String validationStatus, String validationMessage, String source,
                                String reviewedValue) {
    }

    public record ReviewReasonView(String code, String field, String message) {
    }

    public record ScanDetail(Long id, String publicId, Long documentId, String docTypeCode, String status,
                             BigDecimal confidence, Long processingMs, String errorMessage, String ocrProvider,
                             Instant createdAt, List<ScanFieldView> fields, List<AdminViews.MediaRef> media,
                             String rawText, List<String> issues, List<ReviewReasonView> reviewReasons,
                             String reviewedBy, Instant reviewedAt, String reviewNote) {
    }

    @GetMapping("/document-scans")
    @Transactional(readOnly = true)
    public AdminViews.PageView<AdminViews.ScanSummary> scans(@RequestParam(required = false) String status,
                                                             @RequestParam(required = false) String docTypeCode,
                                                             @RequestParam(defaultValue = "0") int page,
                                                             @RequestParam(defaultValue = "20") int size) {
        Page<DocumentScan> result = scanRepository.search(tenant(), AdminParams.enumOrNull(Codes.ScanStatus.class, status),
                AdminParams.blankToNull(docTypeCode), AdminParams.page(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return AdminViews.PageView.of(result, views.scans(result.getContent()));
    }

    @GetMapping("/document-scans/{id}")
    @Transactional(readOnly = true)
    public ScanDetail scan(@PathVariable Long id) {
        DocumentScan s = scanRepository.findById(id).filter(x -> x.getTenantId().equals(tenant()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Scan not found"));
        AdminViews.ScanSummary sum = views.scans(List.of(s)).get(0);
        List<ScanFieldView> fields = scanFieldRepository.findByScanIdOrderByIdAsc(id).stream()
                .map(f -> new ScanFieldView(f.getFieldCode(), f.getLang(), f.getRawValue(), f.getConfidence(),
                        f.getValidationStatus(), f.getValidationMessage(), f.getExtractionSource(), f.getReviewedValue()))
                .toList();
        List<DocumentMedia> links = documentMediaRepository.findByScanIdOrderByIdAsc(id);
        Map<Long, MediaFile> files = mediaRepository.findByIdIn(links.stream().map(DocumentMedia::getMediaId).toList())
                .stream().collect(Collectors.toMap(MediaFile::getId, Function.identity()));
        List<AdminViews.MediaRef> media = links.stream().map(l -> views.media(files.get(l.getMediaId()), l.getRole()))
                .filter(Objects::nonNull).toList();
        return new ScanDetail(sum.id(), sum.publicId(), sum.documentId(), sum.docTypeCode(), sum.status(), sum.confidence(),
                sum.processingMs(), sum.errorMessage(), sum.ocrProvider(), sum.createdAt(), fields, media, s.getRawText(),
                s.getIssues() == null || s.getIssues().isBlank() ? List.of() : List.of(s.getIssues().split(",")),
                ScanReviewPolicy.decode(s.getReviewReasons()).stream()
                        .map(r -> new ReviewReasonView(r.code(), r.field(), r.message())).toList(),
                s.getReviewedBy(), s.getReviewedAt(), s.getReviewNote());
    }

    /** Approve (with corrections) or reject a scan waiting for review. */
    @PostMapping("/document-scans/{id}/review")
    public ScanDetail reviewScan(@PathVariable Long id, @RequestBody DocumentScanService.ReviewRequest body) {
        scanService.review(id, body);
        return scan(id);
    }

    // ================================================================ helpers

    private FieldView field(DocumentField f) {
        String value = f.getValueText() != null ? f.getValueText()
                : f.getValueDate() != null ? f.getValueDate().toString()
                : f.getValueNum() != null ? f.getValueNum().toPlainString() : null;
        return new FieldView(f.getFieldCode(), f.getLang(), value, f.getSource().name(), f.getConfidence(),
                f.getGroupCode(), f.getGroupIdx());
    }

    private Party party0(Long id) {
        return partyRepository.findById(id).filter(p -> p.getTenantId().equals(tenant()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Person not found"));
    }

    private static Long tenant() {
        return RequestContext.get().getTenantId();
    }

    private static Long adminId() {
        return RequestContext.get().getAdminUser() != null ? RequestContext.get().getAdminUser().getId() : null;
    }

}
