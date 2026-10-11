package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class OcrCall extends BaseEntity {

    private Long tenantId;

    private Long scanId;

    private String provider;

    private String status;

    private Long durationMs;

    private String errorMessage;
}
