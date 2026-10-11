package com.facetech.backend.repository;

import com.facetech.backend.domain.RefFlowStepDef;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RefFlowStepDefRepository extends JpaRepository<RefFlowStepDef, Long> {

    List<RefFlowStepDef> findByFlowIdOrderBySeqAsc(Long flowId);

    Optional<RefFlowStepDef> findByFlowIdAndStepCode(Long flowId, String stepCode);

    List<RefFlowStepDef> findAllByOrderByFlowIdAscSeqAsc();
}
