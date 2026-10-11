package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentScan;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface DocumentScanRepository extends JpaRepository<DocumentScan, Long> {

    Optional<DocumentScan> findByPublicId(String publicId);

    List<DocumentScan> findByTenantIdAndSubjectRefOrderByCreatedAtDesc(Long tenantId, String subjectRef);

    List<DocumentScan> findByDocumentIdOrderByCreatedAtDesc(Long documentId);

    long countByTenantIdAndCreatedAtGreaterThanEqual(Long tenantId, Instant from);

    long countByTenantIdAndStatus(Long tenantId, com.facetech.backend.domain.Codes.ScanStatus status);

    @Query("select s from DocumentScan s where s.tenantId = :tenantId"
            + " and (:status is null or s.status = :status)"
            + " and (:docTypeCode is null or s.docTypeCode = :docTypeCode)")
    Page<DocumentScan> search(@Param("tenantId") Long tenantId, @Param("status") Codes.ScanStatus status, @Param("docTypeCode") String docTypeCode, Pageable pageable);
}
