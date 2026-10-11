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
public class VerificationSession extends BaseEntity {

    private Long tenantId;

    private String publicId;

    private String flowCode;

    private Long partyId;

    private Long parentSessionId;

    private Long clientAppId;

    private Long deviceId;

    @Enumerated(EnumType.STRING)
    private Codes.Channel channel;

    private String subjectRef;

    private String tokenHash;

    @Enumerated(EnumType.STRING)
    private Codes.SessionStatus status;

    @Enumerated(EnumType.STRING)
    private Codes.Stage stage;

    @Enumerated(EnumType.STRING)
    private Codes.Decision decision;

    private String documentType;

    private Long documentId;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean selfieGrayscale;

    /** True: an APPROVED decision (automatic or by a reviewer) registers the session's face for the person. */
    @Convert(converter = NumericBooleanConverter.class)
    private boolean enrollFace;

    /** The liveness mode of the last liveness attempt. */
    @Enumerated(EnumType.STRING)
    private Codes.LivenessMode livenessMode;

    private String ipAddress;

    private String userAgent;

    private Instant expiresAt;

    private Instant completedAt;
}
