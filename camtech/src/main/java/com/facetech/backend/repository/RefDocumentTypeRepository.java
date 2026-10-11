package com.facetech.backend.repository;

import com.facetech.backend.domain.RefDocumentType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RefDocumentTypeRepository extends JpaRepository<RefDocumentType, Long> {

    Optional<RefDocumentType> findByCode(String code);

    List<RefDocumentType> findAllByOrderByIdAsc();
}
