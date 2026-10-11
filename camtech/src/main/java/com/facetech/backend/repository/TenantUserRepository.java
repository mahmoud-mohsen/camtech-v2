package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.TenantUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TenantUserRepository extends JpaRepository<TenantUser, Long> {

    Optional<TenantUser> findByUsernameIgnoreCase(String username);

    Optional<TenantUser> findByIdAndTenantId(Long id, Long tenantId);

    List<TenantUser> findByTenantIdOrderByUsernameAsc(Long tenantId);

    long countByTenantIdAndRoleAndStatus(Long tenantId, Codes.TenantRole role, Codes.ActiveStatus status);
}
