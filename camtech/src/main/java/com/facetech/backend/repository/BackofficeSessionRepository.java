package com.facetech.backend.repository;

import com.facetech.backend.domain.BackofficeSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface BackofficeSessionRepository extends JpaRepository<BackofficeSession, Long> {

    Optional<BackofficeSession> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update BackofficeSession s set s.revoked = true where s.userId = :userId")
    int revokeAllForUser(@Param("userId") Long userId);
}
