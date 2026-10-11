package com.facetech.backend.service;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.Tenant;
import com.facetech.backend.platform.OutboxService;
import com.facetech.backend.platform.TenantSettingsService;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.repository.TenantRepository;
import com.facetech.backend.domain.RefDocumentType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sends DOCUMENT_EXPIRING once per document when it enters its tenant's warning period
 * (document.expiry_warning_days before the expiry date).
 */
@Slf4j
@Service
public class DocumentExpiryService {

    private final TenantRepository tenantRepository;
    private final IdentityDocumentRepository documentRepository;
    private final PartyRepository partyRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final TenantSettingsService settings;
    private final OutboxService outbox;

    public DocumentExpiryService(TenantRepository tenantRepository, IdentityDocumentRepository documentRepository,
                                 PartyRepository partyRepository, RefDocumentTypeRepository docTypeRepository,
                                 TenantSettingsService settings, OutboxService outbox) {
        this.tenantRepository = tenantRepository;
        this.documentRepository = documentRepository;
        this.partyRepository = partyRepository;
        this.docTypeRepository = docTypeRepository;
        this.settings = settings;
        this.outbox = outbox;
    }

    /** @return how many events were queued */
    @Transactional
    public int notifyExpiring(LocalDate today) {
        int sent = 0;
        for (Tenant t : tenantRepository.findAll()) {
            if (!"ACTIVE".equals(t.getStatus())) {
                continue;
            }
            int days = settings.expiryWarningDays(t.getId());
            List<IdentityDocument> docs = documentRepository.findExpiringNotNotified(t.getId(), today, today.plusDays(days));
            for (IdentityDocument d : docs) {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("documentId", d.getId());
                data.put("documentType", d.getDocTypeId() == null ? null
                        : docTypeRepository.findById(d.getDocTypeId()).map(RefDocumentType::getCode).orElse(null));
                Party p = d.getPartyId() == null ? null : partyRepository.findById(d.getPartyId()).orElse(null);
                data.put("partyId", p != null ? p.getPublicId() : null);
                data.put("subjectRef", p != null ? p.getExternalRef() : null);
                data.put("expiresOn", d.getExpiryDate().toString());
                data.put("daysLeft", ChronoUnit.DAYS.between(today, d.getExpiryDate()));
                outbox.publish(t.getId(), "DOCUMENT", String.valueOf(d.getId()), Codes.EVENT_DOCUMENT_EXPIRING, data);
                d.setExpiryNotifiedAt(Instant.now());
                sent++;
            }
            if (!docs.isEmpty()) {
                log.info("DOCUMENT_EXPIRING queued for {} documents of tenant {} (warning period {} days)",
                        docs.size(), t.getCode(), days);
            }
        }
        return sent;
    }
}
