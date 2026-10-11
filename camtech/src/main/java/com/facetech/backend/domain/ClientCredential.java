package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class ClientCredential extends BaseEntity {

    private Long tenantId;

    private Long clientAppId;

    private String keyId;

    private String secretHash;

    @Enumerated(EnumType.STRING)
    private Codes.CredentialStatus status;

    private Instant expiresAt;

    private Instant lastUsedAt;
}
