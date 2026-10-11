package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentField;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.PartyPerson;
import com.facetech.backend.domain.RefDocumentType;
import com.facetech.backend.repository.DocumentFieldRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.PartyPersonRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.repository.RefIssuerRepository;
import com.facetech.backend.platform.TenantService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** Finds or creates the people and documents being verified. Callers own the transaction. */
@Service
@Slf4j
public class PartyService {

    private final PartyRepository partyRepository;
    private final PartyPersonRepository personRepository;
    private final IdentityDocumentRepository documentRepository;
    private final DocumentFieldRepository fieldRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final RefIssuerRepository issuerRepository;
    private final TenantService tenantService;

    public PartyService(PartyRepository partyRepository, PartyPersonRepository personRepository,
                        IdentityDocumentRepository documentRepository, DocumentFieldRepository fieldRepository,
                        RefDocumentTypeRepository docTypeRepository, RefIssuerRepository issuerRepository,
                        TenantService tenantService) {
        this.partyRepository = partyRepository;
        this.personRepository = personRepository;
        this.documentRepository = documentRepository;
        this.fieldRepository = fieldRepository;
        this.docTypeRepository = docTypeRepository;
        this.issuerRepository = issuerRepository;
        this.tenantService = tenantService;
    }

    public Optional<Party> findByExternalRef(String externalRef) {
        if (externalRef == null || externalRef.isBlank()) {
            return Optional.empty();
        }
        return partyRepository.findFirstByTenantIdAndExternalRefOrderByIdAsc(tenantService.currentTenantId(), externalRef);
    }

    public Optional<Party> findParty(Long id) {
        return partyRepository.findById(id);
    }

    public Optional<IdentityDocument> findDocumentById(Long id) {
        return documentRepository.findById(id);
    }

    public Party findOrCreatePerson(String externalRef) {
        return findByExternalRef(externalRef).orElseGet(() -> createPerson(externalRef));
    }

    public Party createPerson(String externalRef) {
        Party p = new Party();
        p.setPublicId(UUID.randomUUID().toString());
        p.setTenantId(tenantService.currentTenantId());
        p.setPartyType(Codes.PartyType.PERSON);
        p.setExternalRef(externalRef != null && !externalRef.isBlank() ? externalRef : null);
        p.setStatus("ACTIVE");
        p = partyRepository.save(p);
        PartyPerson person = new PartyPerson();
        person.setPartyId(p.getId());
        personRepository.save(person);
        log.info("Person {} created (tenant {}, externalRef sent={})", p.getPublicId(), p.getTenantId(), p.getExternalRef() != null);
        log.debug("Person {} externalRef={}", p.getPublicId(), p.getExternalRef());
        return p;
    }

    public PartyPerson person(Long partyId) {
        return personRepository.findByPartyId(partyId).orElseGet(() -> {
            PartyPerson person = new PartyPerson();
            person.setPartyId(partyId);
            return personRepository.save(person);
        });
    }

    /** Fills empty person attributes; values already on file are kept. */
    public void enrichPerson(Long partyId, String fullNameEn, String fullNameAr, LocalDate dateOfBirth, String gender,
                             String nationality, boolean overwrite) {
        PartyPerson p = person(partyId);
        if (fullNameEn != null && (overwrite || p.getFullNameEn() == null)) {
            p.setFullNameEn(cut(fullNameEn.trim(), 300));
        }
        if (fullNameAr != null && (overwrite || p.getFullNameAr() == null)) {
            p.setFullNameAr(cut(fullNameAr.trim(), 300));
        }
        if (dateOfBirth != null && (overwrite || p.getDateOfBirth() == null)) {
            p.setDateOfBirth(dateOfBirth);
        }
        if (gender != null && (overwrite || p.getGender() == null)) {
            p.setGender(cut(gender.trim(), 10));
        }
        if (nationality != null && (overwrite || p.getNationality() == null)) {
            p.setNationality(cut(nationality.trim(), 100));
        }
    }

    public RefDocumentType docType(String code) {
        return docTypeRepository.findByCode(code)
                .orElseThrow(() -> new IllegalArgumentException("Unknown document type " + code));
    }

    /** Emirates ID numbers are stored as 15 digits, other numbers upper-cased without spaces. */
    public static String normalizeNumber(String docTypeCode, String number) {
        if (number == null || number.isBlank()) {
            return null;
        }
        if ("EMIRATES_ID".equals(docTypeCode)) {
            String digits = number.replaceAll("\\D", "");
            return digits.isEmpty() ? null : digits;
        }
        return number.replaceAll("\\s", "").toUpperCase();
    }

    public Optional<IdentityDocument> findDocument(String docTypeCode, String issuingCountry, String normalizedNumber) {
        if (normalizedNumber == null) {
            return Optional.empty();
        }
        Long tenantId = tenantService.currentTenantId();
        Long typeId = docType(docTypeCode).getId();
        return issuingCountry == null
                ? documentRepository.findByTenantIdAndDocTypeIdAndIssuingCountryIsNullAndDocumentNumber(tenantId, typeId, normalizedNumber)
                : documentRepository.findByTenantIdAndDocTypeIdAndIssuingCountryAndDocumentNumber(tenantId, typeId, issuingCountry, normalizedNumber);
    }

    public IdentityDocument createDocument(Long partyId, String docTypeCode, String issuerCode, String issuingCountry,
                                           String normalizedNumber) {
        IdentityDocument d = new IdentityDocument();
        d.setTenantId(tenantService.currentTenantId());
        d.setPublicId(UUID.randomUUID().toString());
        d.setPartyId(partyId);
        d.setDocTypeId(docType(docTypeCode).getId());
        if (issuerCode != null) {
            issuerRepository.findByCode(issuerCode).ifPresent(i -> d.setIssuerId(i.getId()));
        }
        d.setIssuingCountry(issuingCountry);
        d.setDocumentNumber(normalizedNumber);
        d.setStatus(Codes.DocumentStatus.CAPTURED);
        IdentityDocument saved = documentRepository.save(d);
        log.info("Identity document {} created: type={} issuingCountry={} party={}", saved.getPublicId(), docTypeCode,
                issuingCountry, partyId);
        return saved;
    }

    /** Replaces the value of a single-valued field (all earlier rows with the same code and language go). */
    public void setField(IdentityDocument doc, String fieldCode, String lang, String text, LocalDate date,
                         Codes.FieldSource source, BigDecimal confidence, Long scanId, Long stepId) {
        if ((text == null || text.isBlank()) && date == null) {
            return;
        }
        for (DocumentField f : fieldRepository.findByDocumentIdAndFieldCode(doc.getId(), fieldCode)) {
            if (lang == null ? f.getLang() == null : lang.equals(f.getLang())) {
                fieldRepository.delete(f);
            }
        }
        DocumentField f = new DocumentField();
        f.setTenantId(doc.getTenantId());
        f.setDocumentId(doc.getId());
        f.setFieldCode(fieldCode);
        f.setLang(lang);
        f.setValueText(text != null ? cut(text.trim(), 2000) : null);
        f.setValueDate(date);
        f.setSource(source);
        f.setConfidence(confidence);
        f.setSourceScanId(scanId);
        f.setSourceStepId(stepId);
        fieldRepository.save(f);
    }

    /** Appends one value of a repeatable field (trade licence activities, partners). */
    public void addGroupField(IdentityDocument doc, String groupCode, int groupIdx, String fieldCode, String text,
                              Codes.FieldSource source, Long scanId) {
        if (text == null || text.isBlank()) {
            return;
        }
        DocumentField f = new DocumentField();
        f.setTenantId(doc.getTenantId());
        f.setDocumentId(doc.getId());
        f.setFieldCode(fieldCode);
        f.setGroupCode(groupCode);
        f.setGroupIdx(groupIdx);
        f.setValueText(cut(text.trim(), 2000));
        f.setSource(source);
        f.setSourceScanId(scanId);
        fieldRepository.save(f);
    }

    private static String cut(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
