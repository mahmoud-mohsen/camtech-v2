package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class BackofficeUser extends BaseEntity {

    private String username;

    private String displayName;

    private String email;

    private String passwordHash;

    @Enumerated(EnumType.STRING)
    private Codes.AdminRole role;

    @Enumerated(EnumType.STRING)
    private Codes.ActiveStatus status;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean mustChangePassword;

    private int failedLogins;

    private Instant lockedUntil;

    private Instant lastLoginAt;
}
