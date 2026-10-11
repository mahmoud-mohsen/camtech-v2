package com.facetech.backend.service;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentMedia;
import com.facetech.backend.domain.DocumentScan;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.OcrCall;
import com.facetech.backend.domain.ScanFieldResult;
import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.dto.response.DocumentScanResponse;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.exception.InvalidDocumentException;
import com.facetech.backend.exception.OcrProcessingException;
import com.facetech.backend.model.DocumentType;
import com.facetech.backend.model.TradeLicenceFormat;
import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.ocr.dto.OcrResult;
import com.facetech.backend.parser.DocumentParser;
import com.facetech.backend.parser.ParserFactory;
import com.facetech.backend.parser.impl.TradeLicenceParser;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.OutboxService;
import com.facetech.backend.platform.DocumentOcrSettingsService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.storage.MediaKeys;
import com.facetech.backend.repository.DocumentMediaRepository;
import com.facetech.backend.repository.DocumentScanRepository;
import com.facetech.backend.repository.OcrCallRepository;
import com.facetech.backend.repository.ScanFieldResultRepository;
import com.facetech.backend.util.EmiratesIdValidator;
import com.facetech.backend.verification.PartyService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * Server-side OCR of a document image (/api/v1/documents/scan): stores the
 * scan, the OCR call and every extracted field with how it was checked.
 * Scans that pass the tenant's review policy are COMPLETED; the others are
 * NEEDS_REVIEW until a person approves (with corrections) or rejects them.
 * Only accepted values are saved on the subject's document: OCR values with
 * source SERVER_OCR, reviewer corrections with source MANUAL.
 */
@Service
@Slf4j
public class DocumentScanService {

    /** Parser keys mapped to document field codes (key -> code, language). */
    private static final Map<String, String[]> FIELD_MAP = Map.ofEntries(
            Map.entry("emiratesIdNumber", new String[]{"DOCUMENT_NUMBER", null}),
            Map.entry("passportNumber", new String[]{"DOCUMENT_NUMBER", null}),
            Map.entry("licenseNo", new String[]{"DOCUMENT_NUMBER", null}),
            Map.entry("uidNumber", new String[]{"UID_NUMBER", null}),
            Map.entry("fullNameEn", new String[]{"FULL_NAME", "en"}),
            Map.entry("fullNameAr", new String[]{"FULL_NAME", "ar"}),
            Map.entry("companyName", new String[]{"TRADE_NAME", "en"}),
            Map.entry("companyNameAr", new String[]{"TRADE_NAME", "ar"}),
            Map.entry("nationality", new String[]{"NATIONALITY", "en"}),
            Map.entry("gender", new String[]{"GENDER", "en"}),
            Map.entry("occupation", new String[]{"OCCUPATION", "en"}),
            Map.entry("employer", new String[]{"EMPLOYER", "en"}),
            Map.entry("issuingPlace", new String[]{"ISSUING_PLACE", "en"}));

    private final DocumentValidationService validationService;
    private final OcrService ocrService;
    private final ParserFactory parserFactory;
    private final DocumentScanRepository scanRepository;
    private final ScanFieldResultRepository fieldResultRepository;
    private final OcrCallRepository ocrCallRepository;
    private final DocumentMediaRepository documentMediaRepository;
    private final MediaStorageService media;
    private final PartyService parties;
    private final EntitlementService entitlements;
    private final AuditService audit;
    private final DocumentOcrSettingsService ocrSettings;
    private final OutboxService outbox;
    private final TransactionTemplate tx;

    public DocumentScanService(DocumentValidationService validationService, OcrService ocrService,
                               ParserFactory parserFactory, DocumentScanRepository scanRepository,
                               ScanFieldResultRepository fieldResultRepository, OcrCallRepository ocrCallRepository,
                               DocumentMediaRepository documentMediaRepository, MediaStorageService media,
                               PartyService parties, EntitlementService entitlements, AuditService audit,
                               DocumentOcrSettingsService ocrSettings, OutboxService outbox,
                               PlatformTransactionManager txManager) {
        this.validationService = validationService;
        this.ocrService = ocrService;
        this.parserFactory = parserFactory;
        this.scanRepository = scanRepository;
        this.fieldResultRepository = fieldResultRepository;
        this.ocrCallRepository = ocrCallRepository;
        this.documentMediaRepository = documentMediaRepository;
        this.media = media;
        this.parties = parties;
        this.entitlements = entitlements;
        this.audit = audit;
        this.ocrSettings = ocrSettings;
        this.outbox = outbox;
        this.tx = new TransactionTemplate(txManager);
    }

    public DocumentScanResponse scanDocument(MultipartFile file, DocumentType documentType,
                                             TradeLicenceFormat tradeLicenceFormat, String subjectRef,
                                             HttpServletRequest request) {
        requireEntitled(documentType);
        long start = System.currentTimeMillis();
        String typeCode = baseType(documentType);
        DocumentScan scan = tx.execute(st -> {
            DocumentScan s = new DocumentScan();
            s.setTenantId(RequestContext.get().getTenantId());
            s.setPublicId(UUID.randomUUID().toString());
            s.setClientAppId(RequestContext.get().getClientApp().getId());
            s.setDocTypeCode(documentType.name());
            s.setTradeLicenceFormat(tradeLicenceFormat != null ? tradeLicenceFormat.name() : null);
            s.setSubjectRef(subjectRef);
            s.setStatus(Codes.ScanStatus.PENDING);
            s.setIpAddress(RequestContext.get().getIpAddress());
            s.setUserAgent(RequestContext.get().getUserAgent());
            return scanRepository.save(s);
        });
        String scanId = scan.getPublicId();
        log.info("Starting document scan {}: documentType={}, tradeLicenceFormat={}, subjectLinked={}, fileSizeBytes={}",
                scanId, documentType, tradeLicenceFormat, subjectRef != null && !subjectRef.isBlank(), file.getSize());
        try {
            DocumentValidationService.ValidationResult validation = validationService.validateDocument(file);
            if (!validation.isValid()) {
                throw new InvalidDocumentException("Document validation failed: " + String.join(", ", validation.getErrors()));
            }
            // Raw image, as scan-only does: Document AI reads the colour photo far better than a binarized copy.
            byte[] original = file.getBytes();
            log.debug("Document scan {}: validation passed ({} bytes) in {}ms",
                    scanId, original.length, System.currentTimeMillis() - start);
            OcrResult ocr = performOcr(original, scan.getId());
            DocumentFieldsDto fields = parse(documentType, ocr, tradeLicenceFormat);
            ScanReviewPolicy.Decision decision = ScanReviewPolicy.evaluate(fields, ocrSettings.effective());
            Codes.ScanStatus status = decision.reviewRequired() ? Codes.ScanStatus.NEEDS_REVIEW : Codes.ScanStatus.COMPLETED;
            long elapsed = System.currentTimeMillis() - start;

            tx.executeWithoutResult(st -> {
                DocumentScan s = scanRepository.findById(scan.getId()).orElseThrow();
                boolean linked = subjectRef != null && !subjectRef.isBlank() && typeCode != null;
                MediaFile m = media.store(original,
                        linked ? Codes.MediaCategory.VERIFIED_MEDIA : Codes.MediaCategory.SCAN_ONLY_MEDIA, true,
                        MediaKeys.scanFile(s.getCreatedAt(), s.getPublicId()));
                DocumentMedia dm = new DocumentMedia();
                dm.setTenantId(s.getTenantId());
                dm.setScanId(s.getId());
                dm.setMediaId(m.getId());
                dm.setRole("DOCUMENT");
                documentMediaRepository.save(dm);
                saveFieldResults(s, fields);
                s.setRawText(ocr.getFullText());
                s.setConfidence(fields.getOverallConfidence());
                s.setProcessingMs(elapsed);
                s.setStatus(status);
                s.setIssues(fields.getIssues().isEmpty() ? null : String.join(",", fields.getIssues()));
                s.setReviewReasons(ScanReviewPolicy.encode(decision.reasons()));
                if (linked && status == Codes.ScanStatus.COMPLETED) {
                    linkToPerson(s, typeCode, values(fields), Set.of(), m.getId());
                } else if (linked) {
                    log.info("Scan {} needs review ({} reasons): not linked to the subject's document until approved",
                            s.getPublicId(), decision.reasons().size());
                }
                if (status == Codes.ScanStatus.NEEDS_REVIEW) {
                    Map<String, Object> event = new LinkedHashMap<>();
                    event.put("scanId", s.getPublicId());
                    event.put("documentType", s.getDocTypeCode());
                    event.put("subjectRef", s.getSubjectRef());
                    event.put("reasons", decision.reasons().stream().map(ScanReviewPolicy.Reason::code).distinct().toList());
                    outbox.publish(s.getTenantId(), "DOCUMENT_SCAN", s.getPublicId(), Codes.EVENT_SCAN_REVIEW_REQUIRED, event);
                }
                audit.record("DOCUMENT_SCANNED", "document_scan", s.getPublicId(),
                        Map.of("documentType", documentType.name(), "status", status.name()));
            });
            log.info("Document scan {} done in {}ms: documentType={}, status={}, confidence={}, fieldCount={}, reasons={}",
                    scanId, elapsed, documentType, status, fields.getOverallConfidence(), fieldCount(fields),
                    decision.reasons().stream().map(ScanReviewPolicy.Reason::code).toList());
            return response(fields, decision, status, documentType, ocr.getFullText(), elapsed)
                    .scanId(scanId)
                    .message(status == Codes.ScanStatus.COMPLETED ? "Document processed successfully"
                            : "Document processed; some values need a review before they are used")
                    .build();
        } catch (InvalidDocumentException | OcrProcessingException e) {
            log.info("Document scan {} failed after {}ms: {}", scanId, System.currentTimeMillis() - start,
                    e.getClass().getSimpleName());
            markFailed(scan.getId(), e.getMessage(), start);
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error processing document scan {}: {}", scanId, e.getMessage(), e);
            markFailed(scan.getId(), "Internal processing error", start);
            throw new OcrProcessingException("Document processing failed", e);
        }
    }

    /** OCR + parse without storing anything. */
    public DocumentScanResponse scanDocumentOnly(MultipartFile file, DocumentType documentType,
                                                 TradeLicenceFormat tradeLicenceFormat) {
        requireEntitled(documentType);
        long start = System.currentTimeMillis();
        log.info("Starting stateless document scan: documentType={}, tradeLicenceFormat={}, fileSizeBytes={}",
                documentType, tradeLicenceFormat, file.getSize());
        try {
            DocumentValidationService.ValidationResult validation = validationService.validateDocument(file);
            if (!validation.isValid()) {
                throw new InvalidDocumentException("Document validation failed: " + String.join(", ", validation.getErrors()));
            }
            if (!ocrService.isAvailable()) {
                throw new OcrProcessingException("OCR service is not available");
            }
            // Raw image: Google Document AI works best with the original colour image.
            OcrResult ocr = ocrService.processImage(file.getBytes(), "ar,en");
            DocumentFieldsDto fields = parse(documentType, ocr, tradeLicenceFormat);
            ScanReviewPolicy.Decision decision = ScanReviewPolicy.evaluate(fields, ocrSettings.effective());
            Codes.ScanStatus status = decision.reviewRequired() ? Codes.ScanStatus.NEEDS_REVIEW : Codes.ScanStatus.COMPLETED;
            log.info("Stateless document scan completed in {}ms: documentType={}, status={}, confidence={}, fieldCount={}",
                    System.currentTimeMillis() - start, documentType, status, fields.getOverallConfidence(), fieldCount(fields));
            return response(fields, decision, status, documentType, ocr.getFullText(), System.currentTimeMillis() - start)
                    .message(status == Codes.ScanStatus.COMPLETED ? "Document processed successfully"
                            : "Document processed; some values failed validation")
                    .build();
        } catch (InvalidDocumentException | OcrProcessingException e) {
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error processing document: {}", e.getMessage(), e);
            throw new OcrProcessingException("Document processing failed", e);
        }
    }

    public Map<String, Object> getScanRecord(String scanId) {
        DocumentScan s = scanRepository.findByPublicId(scanId)
                .filter(x -> x.getTenantId().equals(RequestContext.get().getTenantId()))
                .orElseThrow(() -> new IllegalArgumentException("Scan record not found: " + scanId));
        return summary(s);
    }

    public List<Map<String, Object>> getUserScans(String subjectRef) {
        return scanRepository.findByTenantIdAndSubjectRefOrderByCreatedAtDesc(RequestContext.get().getTenantId(), subjectRef)
                .stream().map(DocumentScanService::summary).toList();
    }

    // ---------------------------------------------------------------- internals

    private void requireEntitled(DocumentType documentType) {
        entitlements.require(Codes.FeatureType.FLOW, Codes.FLOW_DOCUMENT_SCAN);
        entitlements.require(Codes.FeatureType.FEATURE, Codes.FEATURE_SERVER_OCR);
        String base = baseType(documentType);
        if (base != null) {
            entitlements.require(Codes.FeatureType.DOCUMENT, base);
        }
        entitlements.consume(Codes.FeatureType.FLOW, Codes.FLOW_DOCUMENT_SCAN);
    }

    private static String baseType(DocumentType t) {
        return switch (t) {
            case EMIRATES_ID, EMIRATES_ID_FRONT, EMIRATES_ID_BACK -> "EMIRATES_ID";
            case PASSPORT -> "PASSPORT";
            case TRADE_LICENCE -> "TRADE_LICENCE";
            case UNKNOWN -> null;
        };
    }

    private OcrResult performOcr(byte[] image, Long scanDbId) {
        long t0 = System.currentTimeMillis();
        String provider = ocrService.getProvider().getProviderName();
        try {
            if (!ocrService.isAvailable()) {
                throw new OcrProcessingException("OCR service is not available");
            }
            OcrResult result = ocrService.processImage(image, "ar,en");
            long ms = System.currentTimeMillis() - t0;
            log.debug("OCR via {} succeeded in {}ms (imageSizeBytes={}, textLength={})", provider, ms, image.length,
                    result.getFullText() != null ? result.getFullText().length() : 0);
            saveOcrCall(scanDbId, provider, "SUCCESS", ms, null);
            return result;
        } catch (Exception e) {
            log.warn("OCR via {} failed after {}ms: {}", provider, System.currentTimeMillis() - t0, e.toString());
            saveOcrCall(scanDbId, provider, "FAILED", System.currentTimeMillis() - t0, e.getMessage());
            throw new OcrProcessingException("OCR processing failed: " + e.getMessage(), e);
        }
    }

    private void saveOcrCall(Long scanDbId, String provider, String status, long ms, String error) {
        tx.executeWithoutResult(st -> {
            OcrCall c = new OcrCall();
            c.setTenantId(RequestContext.get().getTenantId());
            c.setScanId(scanDbId);
            c.setProvider(provider);
            c.setStatus(status);
            c.setDurationMs(ms);
            c.setErrorMessage(error != null && error.length() > 2000 ? error.substring(0, 2000) : error);
            ocrCallRepository.save(c);
        });
    }

    private DocumentFieldsDto parse(DocumentType documentType, OcrResult ocr, TradeLicenceFormat format) {
        String text = ocr.getFullText();
        DocumentParser parser;
        if (documentType == DocumentType.UNKNOWN) {
            parser = parserFactory.detectParser(text);
            log.debug("Document type UNKNOWN: auto-detected parser={}",
                    parser != null ? parser.getClass().getSimpleName() : null);
            if (parser == null) {
                throw new InvalidDocumentException("Unable to detect document type from OCR text");
            }
        } else {
            parser = parserFactory.getParser(documentType);
        }
        long t0 = System.currentTimeMillis();
        DocumentFieldsDto result = parser instanceof TradeLicenceParser tradeLicenceParser
                ? tradeLicenceParser.parse(text, format)
                : parser.parse(ocr);
        log.info("Parsed with {} (format={}) in {}ms: confidence={}, fieldCount={}",
                parser.getClass().getSimpleName(), format, System.currentTimeMillis() - t0,
                result.getOverallConfidence(), fieldCount(result));
        return result;
    }

    /** Number of extracted fields, not counting the per-field "_confidence" entries. */
    private static long fieldCount(DocumentFieldsDto dto) {
        return dto.getFields() == null ? 0
                : dto.getFields().keySet().stream().filter(k -> !k.endsWith("_confidence")).count();
    }

    /**
     * One row per field read, and per required field that was not (so a reviewer can fill it in). Fields of
     * parsers that do not validate get no validation status rather than a VALID nobody checked.
     */
    private void saveFieldResults(DocumentScan s, DocumentFieldsDto dto) {
        Set<String> keys = new LinkedHashSet<>();
        dto.getFields().keySet().stream().filter(k -> !k.endsWith("_confidence")).forEach(keys::add);
        keys.addAll(dto.getChecks().keySet());
        for (String key : keys) {
            Object value = dto.getFields().get(key);
            DocumentFieldsDto.FieldCheck check = dto.getChecks().get(key);
            ScanFieldResult f = new ScanFieldResult();
            f.setTenantId(s.getTenantId());
            f.setScanId(s.getId());
            f.setFieldCode(key.length() > 100 ? key.substring(0, 100) : key);
            f.setLang(key.endsWith("Ar") ? "ar" : null);
            f.setRawValue(value != null ? value.toString() : null);
            if (dto.getFields().get(key + "_confidence") instanceof BigDecimal c) {
                f.setConfidence(c);
            }
            if (check != null) {
                f.setValidationStatus(check.status());
                f.setValidationMessage(truncate(check.message(), 500));
                f.setExtractionSource(check.source());
            }
            fieldResultRepository.save(f);
        }
    }

    private static String truncate(String v, int max) {
        return v == null || v.length() <= max ? v : v.substring(0, max);
    }

    /** Field values without the per-field confidences. */
    private static Map<String, Object> values(DocumentFieldsDto dto) {
        Map<String, Object> out = new LinkedHashMap<>();
        dto.getFields().forEach((k, v) -> {
            if (!k.endsWith("_confidence")) {
                out.put(k, v);
            }
        });
        return out;
    }

    private static DocumentScanResponse.DocumentScanResponseBuilder response(DocumentFieldsDto fields,
            ScanReviewPolicy.Decision decision, Codes.ScanStatus status, DocumentType documentType, String rawText,
            long ms) {
        Map<String, DocumentScanResponse.FieldValidation> validations = new LinkedHashMap<>();
        fields.getChecks().forEach((k, c) -> validations.put(k,
                new DocumentScanResponse.FieldValidation(c.status(), c.source(), c.message())));
        return DocumentScanResponse.builder()
                .success(true)
                .documentType(documentType)
                .status(status.name())
                .reviewRequired(decision.reviewRequired())
                .reviewReasons(decision.reasons().stream()
                        .map(r -> new DocumentScanResponse.ReviewReason(r.code(), r.field(), r.message())).toList())
                .issues(List.copyOf(fields.getIssues()))
                .validations(validations)
                .confidence(fields.getOverallConfidence())
                .fields(fields.getFields())
                .rawText(rawText)
                .processingTimeMs(ms);
    }

    /**
     * Saves accepted values on the subject's document: source SERVER_OCR, or MANUAL for the
     * {@code corrected} fields a reviewer changed.
     */
    private void linkToPerson(DocumentScan s, String typeCode, Map<String, Object> fields, Set<String> corrected,
                              Long mediaId) {
        String rawNumber = firstText(fields, "emiratesIdNumber", "passportNumber", "licenseNo");
        String number = PartyService.normalizeNumber(typeCode, rawNumber);
        if (number == null) {
            log.info("Scan {}: no usable document number extracted; not linking to subject's document", s.getPublicId());
            return;
        }
        String country = "PASSPORT".equals(typeCode) ? null : "ARE";
        Long partyId = parties.findOrCreatePerson(s.getSubjectRef()).getId();
        IdentityDocument doc = parties.findDocument(typeCode, country, number)
                .orElseGet(() -> parties.createDocument(partyId, typeCode,
                        "EMIRATES_ID".equals(typeCode) ? "ICP" : s.getTradeLicenceFormat(), country, number));
        if (doc.getPartyId() == null) {
            doc.setPartyId(partyId);
        }
        LocalDate expiry = date(fields.get("expiryDate"));
        LocalDate issue = date(fields.get("issueDate"));
        if (expiry != null) {
            doc.setExpiryDate(expiry);
        }
        if (issue != null) {
            doc.setIssueDate(issue);
        }
        Function<String, Codes.FieldSource> src = key ->
                corrected.contains(key) ? Codes.FieldSource.MANUAL : Codes.FieldSource.SERVER_OCR;
        for (Map.Entry<String, String[]> e : FIELD_MAP.entrySet()) {
            Object v = fields.get(e.getKey());
            if (v != null) {
                BigDecimal conf = corrected.contains(e.getKey()) ? BigDecimal.ONE
                        : fields.get(e.getKey() + "_confidence") instanceof BigDecimal c ? c : null;
                String value = "DOCUMENT_NUMBER".equals(e.getValue()[0]) ? number : v.toString();
                parties.setField(doc, e.getValue()[0], e.getValue()[1], value, null, src.apply(e.getKey()), conf,
                        s.getId(), null);
            }
        }
        parties.setField(doc, "DATE_OF_BIRTH", null, null, date(fields.get("dateOfBirth")), src.apply("dateOfBirth"),
                null, s.getId(), null);
        parties.setField(doc, "EXPIRY_DATE", null, null, expiry, src.apply("expiryDate"), null, s.getId(), null);
        parties.setField(doc, "ISSUE_DATE", null, null, issue, src.apply("issueDate"), null, s.getId(), null);
        Object activities = fields.containsKey("activities") ? fields.get("activities") : fields.get("activity");
        if (activities != null && "TRADE_LICENCE".equals(typeCode)) {
            List<String> list = new ArrayList<>();
            if (activities instanceof Collection<?> c) {
                c.forEach(x -> list.add(String.valueOf(x)));
            } else {
                for (String part : activities.toString().split("[\\n;|]")) {
                    if (!part.isBlank()) {
                        list.add(part.trim());
                    }
                }
            }
            for (int i = 0; i < list.size(); i++) {
                parties.addGroupField(doc, "ACTIVITY", i + 1, "ACTIVITY", list.get(i), src.apply("activities"), s.getId());
            }
        }
        if (!"TRADE_LICENCE".equals(typeCode)) {
            parties.enrichPerson(doc.getPartyId(), text(fields.get("fullNameEn")), text(fields.get("fullNameAr")),
                    date(fields.get("dateOfBirth")), text(fields.get("gender")), text(fields.get("nationality")), false);
        }
        DocumentMedia dm = new DocumentMedia();
        dm.setTenantId(s.getTenantId());
        dm.setDocumentId(doc.getId());
        dm.setScanId(s.getId());
        dm.setMediaId(mediaId);
        dm.setRole("DOCUMENT");
        documentMediaRepository.save(dm);
        s.setDocumentId(doc.getId());
        log.info("Scan {} linked to identity document id={} (partyId={}, type={})",
                s.getPublicId(), doc.getId(), doc.getPartyId(), typeCode);
    }

    // ---------------------------------------------------------------- review

    /**
     * @param decision    APPROVE or REJECT
     * @param corrections field code -> value the reviewer read on the image (only the fields that change)
     * @param note        optional reviewer note
     */
    public record ReviewRequest(String decision, Map<String, String> corrections, String note) {
    }

    private static final Set<String> DATE_FIELDS = Set.of("dateOfBirth", "issueDate", "expiryDate");

    /**
     * Approves (with corrections) or rejects a scan waiting for review. Corrections must be well formed (a
     * valid ID number, a real date...), and so must every value that will be used: a reviewer cannot approve
     * a value that fails its check without correcting it. On approval, the scan's values are saved on the
     * subject's document, corrected ones with source MANUAL; OCR values stay in raw_value for comparison.
     */
    public void review(Long scanId, ReviewRequest body) {
        String decision = body == null || body.decision() == null ? "" : body.decision().trim().toUpperCase(Locale.ROOT);
        if (!decision.equals("APPROVE") && !decision.equals("REJECT")) {
            throw invalid("decision must be APPROVE or REJECT");
        }
        Map<String, String> corrections = body.corrections() == null ? Map.of() : body.corrections();
        tx.executeWithoutResult(st -> {
            DocumentScan s = scanRepository.findById(scanId)
                    .filter(x -> x.getTenantId().equals(RequestContext.get().getTenantId()))
                    .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Scan not found"));
            if (s.getStatus() != Codes.ScanStatus.NEEDS_REVIEW) {
                throw new FaceMatchException(HttpStatus.CONFLICT, "SCAN_NOT_IN_REVIEW",
                        "Only scans waiting for review can be approved or rejected (this one is " + s.getStatus() + ")");
            }
            Set<String> corrected = new LinkedHashSet<>();
            if (decision.equals("APPROVE")) {
                Map<String, ScanFieldResult> byCode = new LinkedHashMap<>();
                fieldResultRepository.findByScanIdOrderByIdAsc(s.getId()).forEach(r -> byCode.putIfAbsent(r.getFieldCode(), r));
                for (Map.Entry<String, String> e : corrections.entrySet()) {
                    String code = e.getKey() == null ? "" : e.getKey().trim();
                    if (!code.matches("[A-Za-z][A-Za-z0-9_]{0,99}")) {
                        throw invalid("Unknown field '" + e.getKey() + "'");
                    }
                    String value = normalizeCorrection(code, e.getValue());
                    ScanFieldResult r = byCode.get(code);
                    if (r == null) {
                        r = new ScanFieldResult();
                        r.setTenantId(s.getTenantId());
                        r.setScanId(s.getId());
                        r.setFieldCode(code);
                        r.setLang(code.endsWith("Ar") ? "ar" : null);
                        byCode.put(code, r);
                    }
                    if (!value.equals(r.getRawValue())) {
                        corrected.add(code);
                    }
                    r.setReviewedValue(value);
                    fieldResultRepository.save(r);
                }
                Map<String, Object> finals = new LinkedHashMap<>();
                byCode.forEach((code, r) -> {
                    String v = r.getReviewedValue() != null ? r.getReviewedValue() : r.getRawValue();
                    if (v != null && !v.isBlank()) {
                        finals.put(code, v);
                    }
                });
                for (ScanReviewPolicy.Reason reason : ScanReviewPolicy.decode(s.getReviewReasons())) {
                    if ("FIELD_MISSING".equals(reason.code()) && reason.field() != null && !finals.containsKey(reason.field())) {
                        throw invalid(reason.field() + " was not read from the document: enter it before approving");
                    }
                }
                finals.forEach((code, v) -> {
                    String error = formatError(code, v.toString());
                    if (error != null) {
                        throw invalid(code + ": " + error + ". Correct it before approving");
                    }
                });
                s.setStatus(Codes.ScanStatus.COMPLETED);
                String typeCode = baseType(documentType(s.getDocTypeCode()));
                if (s.getSubjectRef() != null && !s.getSubjectRef().isBlank() && typeCode != null) {
                    Long mediaId = documentMediaRepository.findByScanIdOrderByIdAsc(s.getId()).stream()
                            .filter(dm -> dm.getDocumentId() == null).map(DocumentMedia::getMediaId).findFirst().orElse(null);
                    linkToPerson(s, typeCode, finals, corrected, mediaId);
                }
            } else {
                s.setStatus(Codes.ScanStatus.REJECTED);
            }
            RequestContext ctx = RequestContext.get();
            s.setReviewedBy(ctx.getAdminUser() != null ? "ADMIN:" + ctx.getAdminUser().getUsername()
                    : "TENANT:" + com.facetech.backend.domain.Actor.current());
            s.setReviewedAt(Instant.now());
            s.setReviewNote(truncate(body.note() == null || body.note().isBlank() ? null : body.note().trim(), 1000));
            audit.record("DOCUMENT_SCAN_REVIEWED", "document_scan", s.getPublicId(),
                    Map.of("decision", decision, "correctedFields", List.copyOf(corrected)));
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("scanId", s.getPublicId());
            event.put("documentType", s.getDocTypeCode());
            event.put("subjectRef", s.getSubjectRef());
            event.put("decision", s.getStatus() == Codes.ScanStatus.COMPLETED ? "APPROVED" : "REJECTED");
            event.put("decidedBy", ctx.getAdminUser() != null ? "CAMTECH" : "TENANT");
            event.put("correctedFields", List.copyOf(corrected));
            outbox.publish(s.getTenantId(), "DOCUMENT_SCAN", s.getPublicId(), Codes.EVENT_SCAN_REVIEW_DECIDED, event);
            log.info("Scan {} reviewed: decision={}, correctedFields={}", s.getPublicId(), decision, corrected);
        });
    }

    /** A reviewer's value in its canonical form; 400 when it is not well formed. */
    static String normalizeCorrection(String code, String raw) {
        if (raw == null || raw.isBlank()) {
            throw invalid(code + ": a value is required");
        }
        String v = raw.trim();
        String error = formatError(code, v);
        if (error != null) {
            throw invalid(code + ": " + error);
        }
        if ("emiratesIdNumber".equals(code)) {
            return EmiratesIdValidator.normalizeNumber(v).replaceFirst("(\\d{3})(\\d{4})(\\d{7})(\\d)", "$1-$2-$3-$4");
        }
        if (DATE_FIELDS.contains(code)) {
            return EmiratesIdValidator.parseDate(v).orElseThrow()
                    .format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy"));
        }
        if ("gender".equals(code)) {
            return v.toUpperCase(Locale.ROOT).startsWith("F") ? "Female" : "Male";
        }
        return v.length() > 500 ? v.substring(0, 500) : v;
    }

    /** Why a value of a field with a known format is wrong, or null. */
    static String formatError(String code, String v) {
        if ("emiratesIdNumber".equals(code) && !EmiratesIdValidator.isValidNumber(v)) {
            return "not a valid Emirates ID number (15 digits starting with 784, matching check digit)";
        }
        if (DATE_FIELDS.contains(code)) {
            Optional<LocalDate> d = EmiratesIdValidator.parseDate(v);
            if (d.isEmpty()) {
                return "not a date (use dd/MM/yyyy)";
            }
            if ("dateOfBirth".equals(code) && d.get().isAfter(LocalDate.now())) {
                return "birth date is in the future";
            }
        }
        if ("gender".equals(code) && !v.trim().toUpperCase(Locale.ROOT).matches("M|F|MALE|FEMALE")) {
            return "use Male or Female";
        }
        return null;
    }

    private static DocumentType documentType(String code) {
        try {
            return DocumentType.valueOf(code);
        } catch (RuntimeException e) {
            return DocumentType.UNKNOWN;
        }
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    private void markFailed(Long scanDbId, String message, long start) {
        try {
            tx.executeWithoutResult(st -> scanRepository.findById(scanDbId).ifPresent(s -> {
                s.setStatus(Codes.ScanStatus.FAILED);
                s.setErrorMessage(message != null && message.length() > 1000 ? message.substring(0, 1000) : message);
                s.setProcessingMs(System.currentTimeMillis() - start);
            }));
        } catch (Exception e) {
            log.error("Error saving failed scan record for scan db id {}: {}", scanDbId, e.toString());
        }
    }

    private static Map<String, Object> summary(DocumentScan s) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("success", true);
        r.put("scanId", s.getPublicId());
        r.put("documentType", s.getDocTypeCode());
        r.put("processingStatus", s.getStatus().name());
        r.put("confidence", s.getConfidence());
        r.put("uploadedAt", s.getCreatedAt());
        r.put("processedAt", s.getStatus() == Codes.ScanStatus.COMPLETED || s.getStatus() == Codes.ScanStatus.FAILED
                ? s.getUpdatedAt() : null);
        r.put("processingTimeMs", s.getProcessingMs());
        return r;
    }

    private static String firstText(Map<String, Object> fields, String... keys) {
        for (String k : keys) {
            Object v = fields.get(k);
            if (v != null && !v.toString().isBlank()) {
                return v.toString();
            }
        }
        return null;
    }

    private static String text(Object v) {
        return v == null || v.toString().isBlank() ? null : v.toString();
    }

    private static LocalDate date(Object v) {
        return v == null ? null : EmiratesIdValidator.parseDate(v.toString()).orElse(null);
    }

}
