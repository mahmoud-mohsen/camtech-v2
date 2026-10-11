package com.facetech.backend.repository;

import com.facetech.backend.domain.RefFieldDef;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RefFieldDefRepository extends JpaRepository<RefFieldDef, Long> {

    List<RefFieldDef> findByDocTypeId(Long docTypeId);
}
