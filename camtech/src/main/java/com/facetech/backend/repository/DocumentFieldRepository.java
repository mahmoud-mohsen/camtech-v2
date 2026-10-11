package com.facetech.backend.repository;

import com.facetech.backend.domain.DocumentField;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocumentFieldRepository extends JpaRepository<DocumentField, Long> {

    List<DocumentField> findByDocumentIdOrderByIdAsc(Long documentId);

    List<DocumentField> findByDocumentIdAndFieldCode(Long documentId, String fieldCode);
}
