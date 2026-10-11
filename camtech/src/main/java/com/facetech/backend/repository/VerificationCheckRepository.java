package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.VerificationCheck;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface VerificationCheckRepository extends JpaRepository<VerificationCheck, Long> {

    List<VerificationCheck> findByStepIdInOrderByIdAsc(Collection<Long> stepIds);

    @Query("select c from VerificationCheck c where c.tenantId = :tenantId and c.checkCode = :checkCode and c.outcome = :outcome and c.createdAt >= :from")
    List<VerificationCheck> findRecent(@Param("tenantId") Long tenantId, @Param("checkCode") String checkCode, @Param("outcome") Codes.CheckOutcome outcome, @Param("from") Instant from);

    /** Average score (nulls ignored) of {@link #findRecent}; null when there is none. */
    @Query("select avg(c.score) from VerificationCheck c where c.tenantId = :tenantId and c.checkCode = :checkCode and c.outcome = :outcome and c.createdAt >= :from")
    Double averageScore(@Param("tenantId") Long tenantId, @Param("checkCode") String checkCode, @Param("outcome") Codes.CheckOutcome outcome, @Param("from") Instant from);
}
