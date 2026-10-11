package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class RefReasonCode extends BaseEntity {

    private String code;

    private String category;

    private int httpStatus;

    private String messageEn;

    private String messageAr;
}
