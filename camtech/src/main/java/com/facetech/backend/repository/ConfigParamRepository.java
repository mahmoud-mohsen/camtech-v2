package com.facetech.backend.repository;

import com.facetech.backend.domain.ConfigParam;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ConfigParamRepository extends JpaRepository<ConfigParam, Long> {

    List<ConfigParam> findByTenantId(Long tenantId);

    List<ConfigParam> findByParamKeyAndParamValue(String paramKey, String paramValue);
}
