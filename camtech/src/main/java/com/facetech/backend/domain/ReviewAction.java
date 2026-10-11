package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class ReviewAction extends BaseEntity {

    private Long tenantId;

    private Long reviewCaseId;

    @Enumerated(EnumType.STRING)
    private Codes.ReviewActionType action;

    private String actor;

    private String note;
}
