package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class BackofficeSession extends BaseEntity {

    private Long userId;

    private String tokenHash;

    private Instant expiresAt;

    private Instant lastSeenAt;

    private String ipAddress;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean revoked;
}
