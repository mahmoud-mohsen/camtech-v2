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
public class ReviewCase extends BaseEntity {

    private Long tenantId;

    private Long sessionId;

    @Enumerated(EnumType.STRING)
    private Codes.ReviewStatus status;

    private String reason;

    private BigDecimal finalSimilarity;

    private String assignedTo;

    private Instant decidedAt;
}
