package com.facetech.backend.repository;

import com.facetech.backend.domain.ClientAppPermission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ClientAppPermissionRepository extends JpaRepository<ClientAppPermission, Long> {

    List<ClientAppPermission> findByClientAppId(Long clientAppId);

    Optional<ClientAppPermission> findByClientAppIdAndFeatureCode(Long clientAppId, String featureCode);
}
