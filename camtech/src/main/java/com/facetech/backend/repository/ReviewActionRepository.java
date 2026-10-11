package com.facetech.backend.repository;

import com.facetech.backend.domain.ReviewAction;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewActionRepository extends JpaRepository<ReviewAction, Long> {

    List<ReviewAction> findByReviewCaseIdOrderByIdAsc(Long reviewCaseId);
}
