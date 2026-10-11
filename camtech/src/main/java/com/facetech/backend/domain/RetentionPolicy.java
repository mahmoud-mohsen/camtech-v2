package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class RetentionPolicy extends BaseEntity {

    private Long tenantId;

    private String dataCategory;

    private int retentionDays;

    private String description;
}
