package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class StepMedia extends BaseEntity {

    private Long tenantId;

    private Long stepId;

    private Long mediaId;

    private String role;
}
