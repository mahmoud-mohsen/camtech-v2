package com.facetech.backend.repository;

import com.facetech.backend.domain.StepMedia;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface StepMediaRepository extends JpaRepository<StepMedia, Long> {

    List<StepMedia> findByStepIdInOrderByIdAsc(Collection<Long> stepIds);
}
