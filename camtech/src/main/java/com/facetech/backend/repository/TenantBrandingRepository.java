package com.facetech.backend.repository;

import com.facetech.backend.domain.TenantBranding;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TenantBrandingRepository extends JpaRepository<TenantBranding, Long> {

    Optional<TenantBranding> findByTenantId(Long tenantId);
}
