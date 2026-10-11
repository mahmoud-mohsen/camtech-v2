package com.facetech.backend.repository;

import com.facetech.backend.domain.PartyRelation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PartyRelationRepository extends JpaRepository<PartyRelation, Long> {

    List<PartyRelation> findByFromPartyIdOrToPartyId(Long fromPartyId, Long toPartyId);
}
