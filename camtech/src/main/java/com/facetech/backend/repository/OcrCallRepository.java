package com.facetech.backend.repository;

import com.facetech.backend.domain.OcrCall;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface OcrCallRepository extends JpaRepository<OcrCall, Long> {

    List<OcrCall> findByScanIdOrderByIdAsc(Long scanId);

    List<OcrCall> findByScanIdIn(Collection<Long> scanIds);
}
