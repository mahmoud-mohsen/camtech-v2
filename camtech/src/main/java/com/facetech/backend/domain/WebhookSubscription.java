package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class WebhookSubscription extends BaseEntity {

    private Long tenantId;

    private String url;

    /** Comma-separated event types. */
    private String events;

    private String secret;

    @Enumerated(EnumType.STRING)
    private Codes.ActiveStatus status;
}
