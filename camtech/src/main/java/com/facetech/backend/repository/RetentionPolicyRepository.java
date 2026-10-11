package com.facetech.backend.repository;

import com.facetech.backend.domain.RetentionPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RetentionPolicyRepository extends JpaRepository<RetentionPolicy, Long> {

    List<RetentionPolicy> findByTenantIdOrderByDataCategoryAsc(Long tenantId);

    Optional<RetentionPolicy> findByTenantIdAndDataCategory(Long tenantId, String dataCategory);
}
