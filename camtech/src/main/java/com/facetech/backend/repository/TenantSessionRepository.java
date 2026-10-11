package com.facetech.backend.repository;

import com.facetech.backend.domain.TenantSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface TenantSessionRepository extends JpaRepository<TenantSession, Long> {

    Optional<TenantSession> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update TenantSession s set s.revoked = true where s.userId = :userId")
    int revokeAllForUser(@Param("userId") Long userId);
}
