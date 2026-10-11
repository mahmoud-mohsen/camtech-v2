package com.facetech.backend.repository;

import com.facetech.backend.domain.VerificationDecision;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface VerificationDecisionRepository extends JpaRepository<VerificationDecision, Long> {

    Optional<VerificationDecision> findBySessionId(Long sessionId);

    List<VerificationDecision> findBySessionIdIn(Collection<Long> sessionIds);
}
