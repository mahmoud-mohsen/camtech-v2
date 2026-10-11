package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Getter
@Setter
public class VerificationDecision extends BaseEntity {

    private Long tenantId;

    private Long sessionId;

    @Enumerated(EnumType.STRING)
    private Codes.Decision decision;

    @Enumerated(EnumType.STRING)
    private Codes.DecidedBy decidedBy;

    private String decidedByUser;

    private String reason;

    private BigDecimal finalSimilarity;

    private String resultTokenJti;

    private Instant decidedAt;
}
