package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.VerificationStep;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface VerificationStepRepository extends JpaRepository<VerificationStep, Long> {

    List<VerificationStep> findBySessionIdOrderByIdAsc(Long sessionId);

    List<VerificationStep> findBySessionIdInOrderByIdAsc(Collection<Long> sessionIds);

    long countBySessionIdAndStepCode(Long sessionId, String stepCode);

    List<VerificationStep> findByTenantIdAndStatusAndCreatedAtGreaterThanEqual(Long tenantId, Codes.StepStatus status, Instant from);

    /** (reasonCode, count) of the steps with this status since {@code from}. */
    @Query("select st.reasonCode, count(st) from VerificationStep st where st.tenantId = :tenantId and st.status = :status"
            + " and st.createdAt >= :from and st.reasonCode is not null group by st.reasonCode")
    List<Object[]> countReasons(@Param("tenantId") Long tenantId, @Param("status") Codes.StepStatus status,
                                @Param("from") Instant from);
}
