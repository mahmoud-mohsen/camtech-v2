package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface FaceTemplateRepository extends JpaRepository<FaceTemplate, Long> {

    List<FaceTemplate> findBySessionId(Long sessionId);

    List<FaceTemplate> findByPartyIdOrderByCreatedAtDesc(Long partyId);

    List<FaceTemplate> findByPartyIdAndStatusAndRole(Long partyId, Codes.TemplateStatus status, Codes.TemplateRole role);

    List<FaceTemplate> findByTenantIdAndStatusAndRole(Long tenantId, Codes.TemplateStatus status, Codes.TemplateRole role);

    /** (id, rowVersion) pairs only, without the vectors: see FaceGallery. */
    @Query("select t.id, t.rowVersion from FaceTemplate t where t.tenantId = :tenantId and t.status = :status"
            + " and t.role = :role")
    List<Object[]> findRefsByTenantIdAndStatusAndRole(@Param("tenantId") Long tenantId,
                                                       @Param("status") Codes.TemplateStatus status,
                                                       @Param("role") Codes.TemplateRole role);

    List<FaceTemplate> findByIdIn(Collection<Long> ids);

    /**
     * Templates that were never registered (status SESSION) of sessions that ended before {@code before} and have
     * no open review case: a rejected or verify-only session needs no biometric data once it is decided.
     */
    @Modifying
    @Query("delete from FaceTemplate t where t.status = com.facetech.backend.domain.Codes.TemplateStatus.SESSION"
            + " and t.sessionId in (select s.id from VerificationSession s where s.completedAt < :before"
            + " and s.status not in (com.facetech.backend.domain.Codes.SessionStatus.CREATED,"
            + " com.facetech.backend.domain.Codes.SessionStatus.IN_PROGRESS))"
            + " and not exists (select r.id from ReviewCase r where r.sessionId = t.sessionId"
            + " and r.status in (com.facetech.backend.domain.Codes.ReviewStatus.OPEN,"
            + " com.facetech.backend.domain.Codes.ReviewStatus.IN_REVIEW))")
    int deleteUnregisteredEndedBefore(@Param("before") Instant before);
}
