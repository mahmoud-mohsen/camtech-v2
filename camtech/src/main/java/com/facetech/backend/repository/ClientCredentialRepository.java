package com.facetech.backend.repository;

import com.facetech.backend.domain.ClientCredential;
import com.facetech.backend.domain.Codes;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ClientCredentialRepository extends JpaRepository<ClientCredential, Long> {

    Optional<ClientCredential> findByKeyId(String keyId);

    List<ClientCredential> findByClientAppIdOrderByCreatedAtDesc(Long clientAppId);

    long countByClientAppIdAndStatus(Long clientAppId, Codes.CredentialStatus status);
}
