package com.facetech.backend.repository;

import com.facetech.backend.domain.RefCountry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RefCountryRepository extends JpaRepository<RefCountry, Long> {

    Optional<RefCountry> findByCode(String code);
}
