package com.facetech.backend.repository;

import com.facetech.backend.domain.AuditEvent;
import com.facetech.backend.domain.Codes;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

public interface AuditEventRepository extends JpaRepository<AuditEvent, Long> {

    @Query("select a from AuditEvent a where a.tenantId = :tenantId"
            + " and (cast(:actor as String) is null or lower(a.actor) like lower(concat('%', cast(:actor as String), '%')) escape '\\')"
            + " and (:actorType is null or a.actorType = :actorType)"
            + " and (:action is null or a.action = :action)"
            + " and (:entity is null or a.entity = :entity)"
            + " and (cast(:from as Instant) is null or a.occurredAt >= :from)"
            + " and (cast(:to as Instant) is null or a.occurredAt < :to)")
    Page<AuditEvent> search(@Param("tenantId") Long tenantId, @Param("actor") String actor,
                            @Param("actorType") Codes.ActorType actorType, @Param("action") String action,
                            @Param("entity") String entity, @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);

    @Modifying
    @Query("delete from AuditEvent a where a.tenantId = :tenantId and a.occurredAt < :before")
    int deleteOlderThan(@Param("tenantId") Long tenantId, @Param("before") Instant before);

    java.util.List<AuditEvent> findByTenantIdAndEntityIdInOrderByOccurredAtAsc(Long tenantId,
                                                                      java.util.Collection<String> entityIds);
}
