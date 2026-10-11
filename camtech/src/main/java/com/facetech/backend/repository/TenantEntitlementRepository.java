package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.TenantEntitlement;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TenantEntitlementRepository extends JpaRepository<TenantEntitlement, Long> {

    List<TenantEntitlement> findByTenantIdOrderByFeatureTypeAscFeatureCodeAsc(Long tenantId);

    Optional<TenantEntitlement> findByTenantIdAndFeatureTypeAndFeatureCode(Long tenantId, Codes.FeatureType featureType, String featureCode);
}
