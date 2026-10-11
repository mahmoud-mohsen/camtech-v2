package com.facetech.backend.repository;

import com.facetech.backend.domain.LivenessChallenge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface LivenessChallengeRepository extends JpaRepository<LivenessChallenge, Long> {

    Optional<LivenessChallenge> findByPublicId(String publicId);
}
