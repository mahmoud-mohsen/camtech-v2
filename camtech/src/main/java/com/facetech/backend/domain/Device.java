package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class Device extends BaseEntity {

    private Long tenantId;

    private Long clientAppId;

    private String deviceRef;

    private String platform;

    private String osVersion;

    private String appVersion;

    private String model;

    private String attestationStatus;

    private Instant firstSeenAt;

    private Instant lastSeenAt;
}
