package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/** An active-liveness challenge: random actions the user must perform, usable once before it expires. */
@Entity
@Getter
@Setter
public class LivenessChallenge extends BaseEntity {

    private Long tenantId;

    private String publicId;

    private Long clientAppId;

    /** The selfie verification it belongs to, or null for face authentication. */
    private Long sessionId;

    /** Face authentication: the user it was issued for. */
    private String subjectRef;

    /** The flow the challenge was issued for (null on rows from before 1.6.0). */
    private String flowCode;

    /** Comma-separated actions in the order they must be done. */
    private String actions;

    @Enumerated(EnumType.STRING)
    private Codes.ChallengeStatus status;

    private Instant expiresAt;

    private Instant usedAt;
}
