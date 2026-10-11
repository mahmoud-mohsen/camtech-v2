package com.facetech.backend.repository;

import com.facetech.backend.domain.RefFlowDef;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RefFlowDefRepository extends JpaRepository<RefFlowDef, Long> {

    Optional<RefFlowDef> findByCode(String code);

    List<RefFlowDef> findAllByOrderByIdAsc();
}
