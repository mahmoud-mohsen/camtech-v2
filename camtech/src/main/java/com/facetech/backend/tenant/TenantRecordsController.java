package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminAuditController;
import com.facetech.backend.admin.AdminOperationsController;
import com.facetech.backend.admin.AdminRecordsController;
import com.facetech.backend.admin.AdminViews;
import com.facetech.backend.domain.AuditEvent;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.AuditEventRepository;
import com.facetech.backend.repository.DocumentMediaRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * The tenant's identity documents (with their images) and the people they belong to: search, view, revoke a
 * face, erase a person, export everything held about a person. Like the rest of /v2/tenant, internal data stays
 * out: no similarity scores, no selfies, no IP addresses, camtech operators shown as "camtech".
 */
@Slf4j
@RestController
@RequestMapping("/v2/tenant")
public class TenantRecordsController {

    private final AdminRecordsController records;
    private final AdminOperationsController operations;
    private final DocumentMediaRepository documentMediaRepository;
    private final MediaFileRepository mediaRepository;
    private final MediaStorageService media;
    private final AuditEventRepository auditRepository;
    private final AuditService audit;
    private final ObjectMapper exportMapper;
    private final AdminViews views;

    public TenantRecordsController(AdminRecordsController records, AdminOperationsController operations,
                                   DocumentMediaRepository documentMediaRepository, MediaFileRepository mediaRepository,
                                   MediaStorageService media, AuditEventRepository auditRepository, AuditService audit,
                                   ObjectMapper objectMapper, AdminViews views) {
        this.records = records;
        this.operations = operations;
        this.documentMediaRepository = documentMediaRepository;
        this.mediaRepository = mediaRepository;
        this.media = media;
        this.auditRepository = auditRepository;
        this.audit = audit;
        this.exportMapper = objectMapper.copy().enable(SerializationFeature.INDENT_OUTPUT);
        this.views = views;
    }

    // ================================================================ documents

    public record DocumentDetail(Long id, Long partyId, String partyName, String docTypeCode, String issuerCode,
                                 String documentNumber, String issuingCountry, LocalDate issueDate, LocalDate expiryDate,
                                 String status, Instant createdAt, List<AdminRecordsController.FieldView> fields,
                                 List<AdminViews.MediaRef> media, List<TenantOperationsController.ScanSummary> scans) {
    }

    @GetMapping("/documents")
    public AdminViews.PageView<AdminViews.DocumentSummary> documents(
            @RequestParam(required = false) String q, @RequestParam(required = false) String docTypeCode,
            @RequestParam(required = false) String status, @RequestParam(required = false) String expiringBefore,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return records.documents(q, docTypeCode, status, expiringBefore, page, size);
    }

    @GetMapping("/documents/{id}")
    public DocumentDetail document(@PathVariable Long id) {
        return document(records.document(id));
    }

    /** A document image (front, back, scan page). Selfies and face crops are never served to tenants. */
    @GetMapping("/media/{id}")
    public ResponseEntity<byte[]> mediaFile(@PathVariable Long id) {
        if (!documentMediaRepository.existsByMediaIdAndTenantId(id, RequestContext.get().getTenantId())) {
            throw new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Image not found");
        }
        ResponseEntity<byte[]> file = operations.mediaFile(id);
        return ResponseEntity.ok().headers(h -> h.setContentType(file.getHeaders().getContentType()))
                .cacheControl(CacheControl.noStore().cachePrivate()).body(file.getBody());
    }

    // ================================================================ people

    public record FaceTemplateView(Long id, String role, String status, Instant createdAt) {
    }

    public record PartyDetail(Long id, String publicId, String partyType, String subjectRef, String status,
                              String displayName, String nationality, LocalDate dateOfBirth, int documentsCount,
                              int sessionsCount, Instant lastVerifiedAt, Instant createdAt,
                              AdminRecordsController.PersonView person, AdminRecordsController.OrganizationView organization,
                              List<AdminViews.DocumentSummary> documents, List<FaceTemplateView> faceTemplates,
                              List<TenantOperationsController.SessionSummary> sessions) {
    }

    @GetMapping("/parties")
    public AdminViews.PageView<AdminViews.PartySummary> parties(@RequestParam(required = false) String q,
                                                                @RequestParam(required = false) String partyType,
                                                                @RequestParam(defaultValue = "0") int page,
                                                                @RequestParam(defaultValue = "20") int size) {
        return records.parties(q, partyType, page, size);
    }

    @GetMapping("/parties/{id}")
    public PartyDetail party(@PathVariable Long id) {
        AdminRecordsController.PartyDetail p = records.party(id);
        return new PartyDetail(p.id(), p.publicId(), p.partyType(), p.externalRef(), p.status(), p.displayName(),
                p.nationality(), p.dateOfBirth(), p.documentsCount(), p.sessionsCount(), p.lastVerifiedAt(),
                p.createdAt(), p.person(), p.organization(), p.documents(),
                p.faceTemplates().stream().map(t -> new FaceTemplateView(t.id(), t.role(), t.status(), t.createdAt())).toList(),
                p.sessions().stream().map(TenantOperationsController::summary).toList());
    }

    @DeleteMapping("/parties/{id}")
    @TenantAccess(Codes.TenantRole.OWNER)
    public ResponseEntity<Void> erase(@PathVariable Long id) {
        return records.erase(id);
    }

    @PostMapping("/parties/{id}/face-templates/{templateId}/revoke")
    @TenantAccess(Codes.TenantRole.OWNER)
    public ResponseEntity<Void> revokeTemplate(@PathVariable Long id, @PathVariable Long templateId) {
        return records.revokeTemplate(id, templateId);
    }

    /**
     * Everything held about a person, for a data-subject access request: a ZIP with person.json (profile,
     * verifications with their steps and decisions, documents with their fields, face template records,
     * audit entries about them) and the person's document images.
     */
    @GetMapping("/parties/{id}/export")
    @TenantAccess(Codes.TenantRole.OWNER)
    @Transactional
    public ResponseEntity<byte[]> export(@PathVariable Long id) throws IOException {
        PartyDetail person = party(id);
        List<TenantOperationsController.SessionDetail> sessions = new ArrayList<>();
        for (TenantOperationsController.SessionSummary s : person.sessions()) {
            sessions.add(TenantOperationsController.detail(operations.session(s.publicId())));
        }
        List<DocumentDetail> documents = person.documents().stream().map(d -> document(d.id())).toList();

        Set<String> entityIds = new LinkedHashSet<>();
        entityIds.add(person.publicId());
        entityIds.add(String.valueOf(person.id()));
        sessions.forEach(s -> entityIds.add(s.publicId()));
        documents.forEach(d -> entityIds.add(String.valueOf(d.id())));
        List<AdminAuditController.AuditView> auditEntries = auditRepository
                .findByTenantIdAndEntityIdInOrderByOccurredAtAsc(RequestContext.get().getTenantId(), entityIds).stream()
                .map(this::auditView).toList();

        Map<String, Object> export = new LinkedHashMap<>();
        export.put("exportedAt", Instant.now());
        export.put("tenant", RequestContext.get().getPortalTenantCode());
        export.put("person", person);
        export.put("verifications", sessions);
        export.put("documents", documents);
        export.put("auditEvents", auditEntries);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int images = 0;
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("person.json"));
            zip.write(exportMapper.writeValueAsBytes(export));
            zip.closeEntry();
            for (DocumentDetail d : documents) {
                for (AdminViews.MediaRef ref : d.media()) {
                    if (ref.purged()) {
                        continue;
                    }
                    MediaFile m = mediaRepository.findById(ref.id()).orElse(null);
                    byte[] bytes = m == null ? null : media.read(m);
                    if (bytes == null) {
                        continue;
                    }
                    zip.putNextEntry(new ZipEntry("documents/" + d.id() + "/" + safe(ref.role()) + "-" + ref.id()
                            + extension(ref.mimeType())));
                    zip.write(bytes);
                    zip.closeEntry();
                    images++;
                }
            }
        }
        audit.record("PARTY_EXPORTED", "party", person.publicId(),
                Map.of("verifications", sessions.size(), "documents", documents.size(), "images", images));
        log.info("Person data exported by {}: tenantId={} partyId={} verifications={} documents={} images={}",
                com.facetech.backend.domain.Actor.current(), RequestContext.get().getTenantId(), id, sessions.size(),
                documents.size(), images);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename("person-" + person.publicId() + ".zip").build().toString())
                .cacheControl(CacheControl.noStore())
                .body(out.toByteArray());
    }

    // ================================================================ helpers

    private static DocumentDetail document(AdminRecordsController.DocumentDetail d) {
        return new DocumentDetail(d.id(), d.partyId(), d.partyName(), d.docTypeCode(), d.issuerCode(), d.documentNumber(),
                d.issuingCountry(), d.issueDate(), d.expiryDate(), d.status(), d.createdAt(), d.fields(), d.media(),
                d.scans().stream().map(TenantRecordsController::scanSummary).toList());
    }

    static TenantOperationsController.ScanSummary scanSummary(AdminViews.ScanSummary s) {
        return new TenantOperationsController.ScanSummary(s.id(), s.publicId(), s.docTypeCode(), s.status(),
                s.confidence() != null ? s.confidence().doubleValue() : null, s.processingMs(), s.errorMessage(),
                s.createdAt(), s.reviewReasons());
    }

    private AdminAuditController.AuditView auditView(AuditEvent e) {
        boolean camtech = e.getActorType() == Codes.ActorType.ADMIN;
        return new AdminAuditController.AuditView(e.getId(), e.getActorType().name(), camtech ? "camtech" : e.getActor(),
                e.getAction(), e.getEntity(), e.getEntityId(), null, views.json(e.getDetails()), e.getOccurredAt());
    }

    private static String safe(String s) {
        return s == null ? "image" : s.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    private static String extension(String mimeType) {
        if (mimeType == null) {
            return "";
        }
        return switch (mimeType) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            case "application/pdf" -> ".pdf";
            default -> "";
        };
    }
}
