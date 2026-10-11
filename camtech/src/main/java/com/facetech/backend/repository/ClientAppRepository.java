package com.facetech.backend.repository;

import com.facetech.backend.domain.ClientApp;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ClientAppRepository extends JpaRepository<ClientApp, Long> {

    Optional<ClientApp> findByTenantIdAndCode(Long tenantId, String code);

    List<ClientApp> findByTenantIdOrderByCode(Long tenantId);
}
