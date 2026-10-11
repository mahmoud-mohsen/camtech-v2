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
public class WebhookDelivery extends BaseEntity {

    private Long tenantId;

    private Long subscriptionId;

    private Long outboxEventId;

    private String eventType;

    private int attempt;

    private Integer httpStatus;

    @Enumerated(EnumType.STRING)
    private Codes.DeliveryStatus status;

    private String errorMessage;

    private Instant nextRetryAt;

    private Instant deliveredAt;
}
