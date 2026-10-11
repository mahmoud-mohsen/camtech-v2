package com.facetech.backend.repository;

import com.facetech.backend.domain.RefReasonCode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RefReasonCodeRepository extends JpaRepository<RefReasonCode, Long> {

    Optional<RefReasonCode> findByCode(String code);

    List<RefReasonCode> findAllByOrderByCategoryAscCodeAsc();
}
