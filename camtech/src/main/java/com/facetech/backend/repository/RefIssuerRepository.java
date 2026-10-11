package com.facetech.backend.repository;

import com.facetech.backend.domain.RefIssuer;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RefIssuerRepository extends JpaRepository<RefIssuer, Long> {

    Optional<RefIssuer> findByCode(String code);

    List<RefIssuer> findAllByOrderByIdAsc();
}
