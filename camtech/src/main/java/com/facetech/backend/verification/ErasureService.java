package com.facetech.backend.verification;

import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.OutboxService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.PartyRepository;
import jakarta.persistence.EntityManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Right to erasure: deletes a person with their documents, images, face
 * templates and verification history. Only an audit entry (without personal
 * data) remains.
 */
@Service
@Slf4j
public class ErasureService {

    private final EntityManager em;
    private final PartyRepository partyRepository;
    private final MediaFileRepository mediaRepository;
    private final MediaStorageService media;
    private final AuditService audit;
    private final OutboxService outbox;

    public ErasureService(EntityManager em, PartyRepository partyRepository, MediaFileRepository mediaRepository,
                          MediaStorageService media, AuditService audit, OutboxService outbox) {
        this.outbox = outbox;
        this.em = em;
        this.partyRepository = partyRepository;
        this.mediaRepository = mediaRepository;
        this.media = media;
        this.audit = audit;
    }

    @Transactional
    public void erase(Long partyId) {
        Party party = partyRepository.findById(partyId)
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Person not found"));

        List<Long> sessions = ids("select s.id from VerificationSession s where s.partyId = :p", partyId);
        List<Long> docs = ids("select d.id from IdentityDocument d where d.partyId = :p", partyId);
        List<Long> scans = docs.isEmpty() ? List.of()
                : longs(em.createQuery("select s.id from DocumentScan s where s.documentId in :d", Long.class)
                .setParameter("d", docs).getResultList());
        List<Long> steps = sessions.isEmpty() ? List.of()
                : longs(em.createQuery("select s.id from VerificationStep s where s.sessionId in :s", Long.class)
                .setParameter("s", sessions).getResultList());

        Set<Long> mediaIds = new HashSet<>();
        if (!steps.isEmpty()) {
            mediaIds.addAll(em.createQuery("select m.mediaId from StepMedia m where m.stepId in :x", Long.class)
                    .setParameter("x", steps).getResultList());
        }
        if (!docs.isEmpty()) {
            mediaIds.addAll(em.createQuery("select m.mediaId from DocumentMedia m where m.documentId in :x", Long.class)
                    .setParameter("x", docs).getResultList());
        }
        if (!scans.isEmpty()) {
            mediaIds.addAll(em.createQuery("select m.mediaId from DocumentMedia m where m.scanId in :x", Long.class)
                    .setParameter("x", scans).getResultList());
        }
        mediaIds.addAll(em.createQuery("select t.sourceMediaId from FaceTemplate t where t.partyId = :p and t.sourceMediaId is not null", Long.class)
                .setParameter("p", partyId).getResultList());

        if (!sessions.isEmpty()) {
            List<Long> cases = longs(em.createQuery("select r.id from ReviewCase r where r.sessionId in :s", Long.class)
                    .setParameter("s", sessions).getResultList());
            exec("delete from ReviewAction a where a.reviewCaseId in :x", cases);
            exec("delete from ReviewCase r where r.sessionId in :x", sessions);
            exec("delete from VerificationCheck c where c.stepId in :x", steps);
            exec("delete from StepMedia m where m.stepId in :x", steps);
            exec("delete from VerificationStep s where s.sessionId in :x", sessions);
            exec("delete from VerificationDecision d where d.sessionId in :x", sessions);
            exec("delete from FaceTemplate t where t.sessionId in :x", sessions);
            exec("delete from LivenessChallenge c where c.sessionId in :x", sessions);
            exec("update VerificationSession s set s.parentSessionId = null where s.parentSessionId in :x", sessions);
            exec("update DocumentScan s set s.sessionId = null where s.sessionId in :x", sessions);
        }
        em.createQuery("delete from FaceTemplate t where t.partyId = :p").setParameter("p", partyId).executeUpdate();
        if (party.getExternalRef() != null) {
            // Face authentication challenges are issued for the person's subjectRef, not a session.
            em.createQuery("delete from LivenessChallenge c where c.tenantId = :t and c.sessionId is null and c.subjectRef = :r")
                    .setParameter("t", party.getTenantId()).setParameter("r", party.getExternalRef()).executeUpdate();
        }
        exec("delete from ScanFieldResult f where f.scanId in :x", scans);
        exec("delete from OcrCall o where o.scanId in :x", scans);
        exec("delete from DocumentMedia m where m.scanId in :x", scans);
        exec("delete from DocumentScan s where s.id in :x", scans);
        exec("delete from DocumentField f where f.documentId in :x", docs);
        exec("delete from DocumentMedia m where m.documentId in :x", docs);
        exec("delete from VerificationSession s where s.id in :x", sessions);
        exec("update VerificationSession s set s.documentId = null where s.documentId in :x", docs);
        exec("delete from IdentityDocument d where d.id in :x", docs);
        em.createQuery("delete from PartyRelation r where r.fromPartyId = :p or r.toPartyId = :p").setParameter("p", partyId).executeUpdate();
        em.createQuery("delete from PartyPerson p where p.partyId = :p").setParameter("p", partyId).executeUpdate();
        em.createQuery("delete from PartyOrganization o where o.partyId = :p").setParameter("p", partyId).executeUpdate();

        List<MediaFile> files = mediaIds.isEmpty() ? List.of() : mediaRepository.findByIdIn(mediaIds);
        for (MediaFile m : files) {
            media.purge(m);
        }
        exec("delete from MediaFile m where m.id in :x", List.copyOf(mediaIds));
        em.createQuery("delete from Party p where p.id = :p").setParameter("p", partyId).executeUpdate();

        audit.record("PARTY_ERASED", "party", party.getPublicId(), Map.of(
                "sessions", sessions.size(), "documents", docs.size(), "images", files.size()));
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("partyId", party.getPublicId());
        event.put("subjectRef", party.getExternalRef());
        event.put("erasedAt", Instant.now().toString());
        event.put("erasedBy", RequestContext.get().getAdminUser() != null ? "CAMTECH" : "TENANT");
        outbox.publish(party.getTenantId(), "PARTY", party.getPublicId(), Codes.EVENT_PARTY_ERASED, event);
        log.info("Erased person {}: {} sessions, {} documents, {} images", party.getPublicId(), sessions.size(), docs.size(), files.size());
    }

    private List<Long> ids(String jpql, Long partyId) {
        return longs(em.createQuery(jpql, Long.class).setParameter("p", partyId).getResultList());
    }

    private static List<Long> longs(List<Long> l) {
        return l;
    }

    private void exec(String jpql, Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }
        em.createQuery(jpql).setParameter("x", ids).executeUpdate();
    }
}
