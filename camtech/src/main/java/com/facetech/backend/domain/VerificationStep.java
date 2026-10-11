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
public class VerificationStep extends BaseEntity {

    private Long tenantId;

    private Long sessionId;

    private String stepCode;

    private int attemptNo;

    @Enumerated(EnumType.STRING)
    private Codes.StepStatus status;

    private String reasonCode;

    private String reasonMessage;

    private Instant startedAt;

    private Instant endedAt;
}
