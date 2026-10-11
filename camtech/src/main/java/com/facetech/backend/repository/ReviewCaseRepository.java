package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.ReviewCase;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ReviewCaseRepository extends JpaRepository<ReviewCase, Long> {

    Optional<ReviewCase> findBySessionId(Long sessionId);

    long countByTenantIdAndStatusIn(Long tenantId, Collection<Codes.ReviewStatus> statuses);

    @Query("select r from ReviewCase r where r.tenantId = :tenantId"
            + " and (:status is null or r.status = :status)"
            + " and (:assignedTo is null or r.assignedTo = :assignedTo)")
    Page<ReviewCase> search(@Param("tenantId") Long tenantId, @Param("status") Codes.ReviewStatus status, @Param("assignedTo") String assignedTo, Pageable pageable);

    List<ReviewCase> findBySessionIdIn(Collection<Long> sessionIds);

    @Query("select r from ReviewCase r where r.tenantId in :tenantIds"
            + " and (:status is null or r.status = :status)"
            + " and (:assignedTo is null or r.assignedTo = :assignedTo)")
    Page<ReviewCase> searchIn(@Param("tenantIds") Collection<Long> tenantIds, @Param("status") Codes.ReviewStatus status,
                              @Param("assignedTo") String assignedTo, Pageable pageable);
}
