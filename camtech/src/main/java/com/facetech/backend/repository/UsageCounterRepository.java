package com.facetech.backend.repository;

import com.facetech.backend.domain.UsageCounter;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface UsageCounterRepository extends JpaRepository<UsageCounter, Long> {

    Optional<UsageCounter> findByTenantIdAndFeatureCodeAndUsageDate(Long tenantId, String featureCode, LocalDate usageDate);

    List<UsageCounter> findByTenantIdAndUsageDate(Long tenantId, LocalDate usageDate);

    @Modifying
    @Query("update UsageCounter u set u.usedCount = u.usedCount + 1 where u.tenantId = :tenantId and u.featureCode = :featureCode and u.usageDate = :usageDate")
    int increment(@Param("tenantId") Long tenantId, @Param("featureCode") String featureCode, @Param("usageDate") LocalDate usageDate);

    /** Counts one use only while under {@code quota}, in one statement, so concurrent requests cannot overshoot. */
    @Modifying
    @Query("update UsageCounter u set u.usedCount = u.usedCount + 1 where u.tenantId = :tenantId and u.featureCode = :featureCode and u.usageDate = :usageDate and u.usedCount < :quota")
    int incrementBelow(@Param("tenantId") Long tenantId, @Param("featureCode") String featureCode,
                       @Param("usageDate") LocalDate usageDate, @Param("quota") long quota);
}
