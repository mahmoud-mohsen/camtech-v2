package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class OutboxEvent extends BaseEntity {

    private Long tenantId;

    private String aggregateType;

    private String aggregateId;

    private String eventType;

    @Lob
    private String payload;

    @Enumerated(EnumType.STRING)
    private Codes.OutboxStatus status;

    private Instant processedAt;
}
