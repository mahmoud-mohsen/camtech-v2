package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class RefIssuer extends BaseEntity {

    private String code;

    private Long docTypeId;

    private String countryCode;

    private String emirate;

    private String nameEn;

    private String nameAr;
}
