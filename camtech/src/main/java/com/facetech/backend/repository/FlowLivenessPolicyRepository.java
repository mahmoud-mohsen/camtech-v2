package com.facetech.backend.repository;

import com.facetech.backend.domain.FlowLivenessPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FlowLivenessPolicyRepository extends JpaRepository<FlowLivenessPolicy, Long> {

    Optional<FlowLivenessPolicy> findByTenantIdAndFlowCode(Long tenantId, String flowCode);

    List<FlowLivenessPolicy> findByTenantId(Long tenantId);
}
