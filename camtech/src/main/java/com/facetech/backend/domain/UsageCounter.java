package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Entity
@Getter
@Setter
public class UsageCounter extends BaseEntity {

    private Long tenantId;

    private String featureCode;

    private LocalDate usageDate;

    private long usedCount;
}
