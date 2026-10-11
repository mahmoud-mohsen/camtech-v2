package com.facetech.backend.repository;

import com.facetech.backend.domain.PartyOrganization;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PartyOrganizationRepository extends JpaRepository<PartyOrganization, Long> {

    Optional<PartyOrganization> findByPartyId(Long partyId);

    List<PartyOrganization> findByPartyIdIn(Collection<Long> partyIds);
}
