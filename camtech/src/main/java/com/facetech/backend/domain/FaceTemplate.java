package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Entity
@Getter
@Setter
public class FaceTemplate extends BaseEntity {

    private Long tenantId;

    private Long partyId;

    private Long sessionId;

    private Long sourceMediaId;

    @Enumerated(EnumType.STRING)
    private Codes.TemplateRole role;

    private String pose;

    private String modelVersion;

    private int dimension;

    /** Little-endian float32 values, see EmbeddingCodec. */
    @Lob
    private byte[] vector;

    private BigDecimal qualityScore;

    @Enumerated(EnumType.STRING)
    private Codes.TemplateStatus status;
}
