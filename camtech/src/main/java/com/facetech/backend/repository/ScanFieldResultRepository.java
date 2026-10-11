package com.facetech.backend.repository;

import com.facetech.backend.domain.ScanFieldResult;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScanFieldResultRepository extends JpaRepository<ScanFieldResult, Long> {

    List<ScanFieldResult> findByScanIdOrderByIdAsc(Long scanId);
}
