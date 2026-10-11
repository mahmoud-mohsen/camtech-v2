package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.VerificationSession;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface VerificationSessionRepository extends JpaRepository<VerificationSession, Long> {

    Optional<VerificationSession> findByPublicId(String publicId);

    List<VerificationSession> findTop200ByStatusInAndExpiresAtBefore(Collection<Codes.SessionStatus> statuses, Instant before);

    List<VerificationSession> findByPartyIdOrderByCreatedAtDesc(Long partyId);

    List<VerificationSession> findByTenantIdAndCreatedAtGreaterThanEqual(Long tenantId, Instant from);

    /** Dashboard: session counts per (decision, status, flowCode, channel, clientAppId), counted by the database. */
    @Query("select s.decision, s.status, s.flowCode, s.channel, s.clientAppId, count(s) from VerificationSession s"
            + " where s.tenantId = :tenantId and s.createdAt >= :from"
            + " group by s.decision, s.status, s.flowCode, s.channel, s.clientAppId")
    List<Object[]> countForDashboard(@Param("tenantId") Long tenantId, @Param("from") Instant from);

    /** Dashboard: (decision, count) of the sessions created in [from, to). */
    @Query("select s.decision, count(s) from VerificationSession s"
            + " where s.tenantId = :tenantId and s.createdAt >= :from and s.createdAt < :to group by s.decision")
    List<Object[]> countDecisions(@Param("tenantId") Long tenantId, @Param("from") Instant from, @Param("to") Instant to);

    List<VerificationSession> findByParentSessionId(Long parentSessionId);

    @Query("select s from VerificationSession s where s.tenantId = :tenantId"
            + " and (:status is null or s.status = :status)"
            + " and (:decision is null or s.decision = :decision)"
            + " and (:flowCode is null or s.flowCode = :flowCode)"
            + " and (:channel is null or s.channel = :channel)"
            + " and (:clientAppId is null or s.clientAppId = :clientAppId)"
            + " and (cast(:from as Instant) is null or s.createdAt >= :from)"
            + " and (cast(:to as Instant) is null or s.createdAt < :to)"
            + " and (:q is null or s.publicId like :q escape '\\' or lower(s.subjectRef) like :q escape '\\'"
            + "   or exists (select 1 from IdentityDocument d where d.id = s.documentId and lower(d.documentNumber) like :q escape '\\')"
            + "   or exists (select 1 from PartyPerson pp where pp.partyId = s.partyId and lower(pp.fullNameEn) like :q escape '\\'))")
    Page<VerificationSession> search(@Param("tenantId") Long tenantId, @Param("status") Codes.SessionStatus status,
                                     @Param("decision") Codes.Decision decision, @Param("flowCode") String flowCode,
                                     @Param("channel") Codes.Channel channel, @Param("clientAppId") Long clientAppId,
                                     @Param("from") Instant from, @Param("to") Instant to, @Param("q") String q, Pageable pageable);
}
