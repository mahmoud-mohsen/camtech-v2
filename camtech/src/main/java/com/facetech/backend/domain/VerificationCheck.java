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
public class VerificationCheck extends BaseEntity {

    private Long tenantId;

    private Long stepId;

    private String checkCode;

    private BigDecimal score;

    private String thresholdUsed;

    @Enumerated(EnumType.STRING)
    private Codes.CheckOutcome outcome;

    @Lob
    private String details;
}
