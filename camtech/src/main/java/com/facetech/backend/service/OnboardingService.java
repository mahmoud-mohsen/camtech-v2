package com.facetech.backend.service;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentMedia;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.dto.EmiratesIdOcrDtos;
import com.facetech.backend.dto.PassportDtos;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.storage.MediaKeys;
import com.facetech.backend.repository.DocumentMediaRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.util.EmiratesIdValidator;
import com.facetech.backend.verification.PartyService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Legacy onboarding (/onboarding/**): a session that owns a person, then
 * face registrations and Emirates ID / passport data uploaded by the app.
 * The app does the OCR, so fields are stored with source CLIENT_OCR.
 */
@Service
@Slf4j
public class OnboardingService {

    private final VerificationSessionRepository sessionRepository;
    private final PartyRepository partyRepository;
    private final IdentityDocumentRepository documentRepository;
    private final DocumentMediaRepository documentMediaRepository;
    private final PartyService parties;
    private final MediaStorageService media;
    private final EntitlementService entitlements;
    private final AuditService audit;

    public OnboardingService(VerificationSessionRepository sessionRepository, PartyRepository partyRepository,
                             IdentityDocumentRepository documentRepository,
                             DocumentMediaRepository documentMediaRepository, PartyService parties,
                             MediaStorageService media, EntitlementService entitlements, AuditService audit) {
        this.sessionRepository = sessionRepository;
        this.partyRepository = partyRepository;
        this.documentRepository = documentRepository;
        this.documentMediaRepository = documentMediaRepository;
        this.parties = parties;
        this.media = media;
        this.entitlements = entitlements;
        this.audit = audit;
    }

    public record Session(String sessionKey, Long userId, String status) {
    }

    @Transactional
    public Session createSession(String preferredName) {
        entitlements.require(Codes.FeatureType.FLOW, Codes.FLOW_ONBOARDING);
        entitlements.consume(Codes.FeatureType.FLOW, Codes.FLOW_ONBOARDING);
        String sessionKey = UUID.randomUUID().toString();
        Party party = parties.createPerson(uniqueName(preferredName, sessionKey));
        RequestContext ctx = RequestContext.get();
        VerificationSession s = new VerificationSession();
        s.setTenantId(ctx.getTenantId());
        s.setPublicId(sessionKey);
        s.setFlowCode(Codes.FLOW_ONBOARDING);
        s.setPartyId(party.getId());
        s.setClientAppId(ctx.getClientApp().getId());
        s.setChannel(ctx.getClientApp().getChannel());
        s.setSubjectRef(party.getExternalRef());
        s.setStatus(Codes.SessionStatus.IN_PROGRESS);
        s.setStage(Codes.Stage.CREATED);
        s.setIpAddress(ctx.getIpAddress());
        s.setUserAgent(ctx.getUserAgent());
        s.setExpiresAt(Instant.now().plus(30, ChronoUnit.DAYS));
        sessionRepository.save(s);
        audit.record("ONBOARDING_STARTED", "party", party.getPublicId(), null);
        log.info("Onboarding session {} created for party {} (userId={})", sessionKey, party.getPublicId(), party.getId());
        return new Session(sessionKey, party.getId(), "in_progress");
    }

    @Transactional(readOnly = true)
    public Long userIdBySessionKey(String sessionKey) {
        return sessionRepository.findByPublicId(sessionKey)
                .filter(s -> Codes.FLOW_ONBOARDING.equals(s.getFlowCode()))
                .map(VerificationSession::getPartyId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));
    }

    @Transactional
    public Map<String, Object> attachEmiratesId(Long userId, EmiratesIdOcrDtos.EmiratesIdOcrResponse data,
                                                MultipartFile front, MultipartFile back, MultipartFile face,
                                                MultipartFile signature) throws IOException {
        entitlements.require(Codes.FeatureType.DOCUMENT, "EMIRATES_ID");
        Party party = party(userId);
        String number = PartyService.normalizeNumber("EMIRATES_ID", data.getEmiratesIdNumber());
        log.info("Attaching Emirates ID to party {} (numberProvided={})", party.getPublicId(), number != null);
        IdentityDocument doc = document(party, "EMIRATES_ID", "ICP", "ARE", number);
        LocalDate dob = date(data.getDateOfBirth());
        doc.setIssueDate(date(data.getIssueDate()));
        doc.setExpiryDate(date(data.getExpiryDate()));
        Codes.FieldSource src = Codes.FieldSource.CLIENT_OCR;
        parties.setField(doc, "DOCUMENT_NUMBER", null, number, null, src, null, null, null);
        parties.setField(doc, "UID_NUMBER", null, data.getUidNumber(), null, src, null, null, null);
        parties.setField(doc, "FULL_NAME", "en", data.getFullNameEn(), null, src, null, null, null);
        parties.setField(doc, "FULL_NAME", "ar", data.getFullNameAr(), null, src, null, null, null);
        parties.setField(doc, "DATE_OF_BIRTH", null, null, dob, src, null, null, null);
        parties.setField(doc, "ISSUE_DATE", null, null, doc.getIssueDate(), src, null, null, null);
        parties.setField(doc, "EXPIRY_DATE", null, null, doc.getExpiryDate(), src, null, null, null);
        parties.setField(doc, "GENDER", "en", data.getGender(), null, src, null, null, null);
        parties.setField(doc, "GENDER", "ar", data.getGenderAr(), null, src, null, null, null);
        parties.setField(doc, "NATIONALITY", "en", data.getNationality(), null, src, null, null, null);
        parties.setField(doc, "NATIONALITY", "ar", data.getNationalityAr(), null, src, null, null, null);
        parties.setField(doc, "OCCUPATION", "en", data.getOccupation(), null, src, null, null, null);
        parties.setField(doc, "OCCUPATION", "ar", data.getOccupationAr(), null, src, null, null, null);
        parties.setField(doc, "EMPLOYER", "en", data.getEmployer(), null, src, null, null, null);
        parties.setField(doc, "EMPLOYER", "ar", data.getEmployerAr(), null, src, null, null, null);
        parties.setField(doc, "ISSUING_PLACE", "en", data.getIssuingPlace(), null, src, null, null, null);
        parties.setField(doc, "ISSUING_PLACE", "ar", data.getIssuingPlaceAr(), null, src, null, null, null);
        parties.enrichPerson(party.getId(), data.getFullNameEn(), data.getFullNameAr(), dob, data.getGender(),
                data.getNationality(), true);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("emirates_id", doc.getId());
        MediaFile f = attach(party, doc, "emirates-id", "FRONT", front);
        if (f == null) {
            throw new IllegalArgumentException("front_image is required");
        }
        response.put("front_image_id", f.getId());
        response.put("front_image_path", f.getStorageUri());
        putImage(response, "back", attach(party, doc, "emirates-id", "BACK", back));
        putImage(response, "face", attach(party, doc, "emirates-id", "FACE_PHOTO", face));
        putImage(response, "signature", attach(party, doc, "emirates-id", "SIGNATURE", signature));
        audit.record("DOCUMENT_UPLOADED", "identity_document", doc.getPublicId(), Map.of("documentType", "EMIRATES_ID"));
        log.info("Emirates ID attached for party {}: documentId={}, images={}", party.getPublicId(), doc.getId(),
                response.keySet().stream().filter(k -> k.endsWith("_image_id")).toList());
        return response;
    }

    @Transactional
    public Map<String, Object> attachPassport(Long userId, PassportDtos.PassportMrzRequest data, MultipartFile image)
            throws IOException {
        entitlements.require(Codes.FeatureType.DOCUMENT, "PASSPORT");
        Party party = party(userId);
        String number = PartyService.normalizeNumber("PASSPORT", data.getDocumentNumber());
        String country = data.getIssuingCountry() != null && data.getIssuingCountry().trim().length() == 3
                ? data.getIssuingCountry().trim().toUpperCase() : null;
        log.info("Attaching passport to party {} (numberProvided={})",
                party.getPublicId(), number != null);
        IdentityDocument doc = document(party, "PASSPORT", null, country, number);
        LocalDate dob = date(data.getDateOfBirth());
        doc.setExpiryDate(date(data.getExpiryDate()));
        Codes.FieldSource src = Codes.FieldSource.MRZ;
        parties.setField(doc, "DOCUMENT_NUMBER", null, number, null, src, null, null, null);
        parties.setField(doc, "FULL_NAME", "en", data.getFullNameEn(), null, src, null, null, null);
        parties.setField(doc, "SURNAME", null, data.getSurname(), null, src, null, null, null);
        parties.setField(doc, "GIVEN_NAMES", null, data.getGivenNames(), null, src, null, null, null);
        parties.setField(doc, "DATE_OF_BIRTH", null, null, dob, src, null, null, null);
        parties.setField(doc, "EXPIRY_DATE", null, null, doc.getExpiryDate(), src, null, null, null);
        parties.setField(doc, "GENDER", null, data.getSex(), null, src, null, null, null);
        parties.setField(doc, "NATIONALITY", null, data.getNationality(), null, src, null, null, null);
        parties.setField(doc, "ISSUING_COUNTRY", null, data.getIssuingCountry(), null, src, null, null, null);
        parties.setField(doc, "MRZ_LINE_1", null, data.getMrzLine1(), null, src, null, null, null);
        parties.setField(doc, "MRZ_LINE_2", null, data.getMrzLine2(), null, src, null, null, null);
        parties.enrichPerson(party.getId(), data.getFullNameEn(), null, dob, data.getSex(), data.getNationality(), false);

        MediaFile m = attach(party, doc, "passport", "PHOTO_PAGE", image);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("passport_id", doc.getId());
        response.put("image_id", m.getId());
        response.put("image_path", m.getStorageUri());
        audit.record("DOCUMENT_UPLOADED", "identity_document", doc.getPublicId(), Map.of("documentType", "PASSPORT"));
        log.info("Passport attached for party {}: documentId={}",
                party.getPublicId(), doc.getId());
        return response;
    }

    private Party party(Long userId) {
        return partyRepository.findById(userId).orElseThrow(() -> new IllegalArgumentException("User not found"));
    }

    /** The document with this number, or the person's existing document of this type when no number was read. */
    private IdentityDocument document(Party party, String type, String issuer, String country, String number) {
        if (number == null) {
            log.debug("No {} number read for party {}; falling back to the party's latest document of that type",
                    type, party.getPublicId());
            Long typeId = parties.docType(type).getId();
            return documentRepository.findByPartyIdOrderByCreatedAtDesc(party.getId()).stream()
                    .filter(d -> d.getDocTypeId().equals(typeId)).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException(
                            ("EMIRATES_ID".equals(type) ? "emiratesIdNumber" : "documentNumber") + " is required"));
        }
        IdentityDocument doc = parties.findDocument(type, country, number)
                .orElseGet(() -> parties.createDocument(party.getId(), type, issuer, country, number));
        if (doc.getPartyId() == null) {
            doc.setPartyId(party.getId());
        } else if (!doc.getPartyId().equals(party.getId())) {
            log.warn("{} document {} is already owned by party {}; rejecting attach for party {}",
                    type, doc.getId(), doc.getPartyId(), party.getId());
            throw new IllegalArgumentException("This document is already registered to another user");
        }
        return doc;
    }

    private MediaFile attach(Party party, IdentityDocument doc, String folder, String role, MultipartFile file)
            throws IOException {
        if (file == null || file.isEmpty()) {
            return null;
        }
        MediaFile m = media.store(file.getBytes(), Codes.MediaCategory.VERIFIED_MEDIA, true,
                MediaKeys.onboardingFile(party.getPublicId(), folder, role));
        DocumentMedia dm = new DocumentMedia();
        dm.setTenantId(doc.getTenantId());
        dm.setDocumentId(doc.getId());
        dm.setMediaId(m.getId());
        dm.setRole(role);
        documentMediaRepository.save(dm);
        log.debug("Stored {} image for document {}: mediaId={}, sizeBytes={}", role, doc.getId(), m.getId(), file.getSize());
        return m;
    }

    private static void putImage(Map<String, Object> response, String prefix, MediaFile m) {
        if (m != null) {
            response.put(prefix + "_image_id", m.getId());
            response.put(prefix + "_image_path", m.getStorageUri());
        }
    }

    private static LocalDate date(String raw) {
        return EmiratesIdValidator.parseDate(raw).orElse(null);
    }

    private String uniqueName(String preferredName, String sessionKey) {
        String base = preferredName != null && !preferredName.trim().isEmpty()
                ? preferredName.trim() : "session_" + sessionKey.replace("-", "");
        if (parties.findByExternalRef(base).isEmpty()) {
            return base;
        }
        String candidate = base + "_" + sessionKey.substring(0, 8);
        if (parties.findByExternalRef(candidate).isEmpty()) {
            return candidate;
        }
        int counter = 2;
        while (parties.findByExternalRef(candidate + "_" + counter).isPresent()) {
            counter++;
        }
        return candidate + "_" + counter;
    }
}
