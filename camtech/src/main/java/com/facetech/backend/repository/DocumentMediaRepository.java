package com.facetech.backend.repository;

import com.facetech.backend.domain.DocumentMedia;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentMediaRepository extends JpaRepository<DocumentMedia, Long> {

    List<DocumentMedia> findByDocumentIdOrderByIdAsc(Long documentId);

    List<DocumentMedia> findByScanIdOrderByIdAsc(Long scanId);

    boolean existsByMediaIdAndTenantId(Long mediaId, Long tenantId);
}
