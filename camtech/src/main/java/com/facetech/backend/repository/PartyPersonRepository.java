package com.facetech.backend.repository;

import com.facetech.backend.domain.PartyPerson;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PartyPersonRepository extends JpaRepository<PartyPerson, Long> {

    Optional<PartyPerson> findByPartyId(Long partyId);

    List<PartyPerson> findByPartyIdIn(Collection<Long> partyIds);
}
