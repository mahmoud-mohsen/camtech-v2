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
public class AuditEvent extends BaseEntity {

    private Long tenantId;

    @Enumerated(EnumType.STRING)
    private Codes.ActorType actorType;

    private String actor;

    private String action;

    private String entity;

    private String entityId;

    private String ipAddress;

    @Lob
    private String details;

    private Instant occurredAt;
}
