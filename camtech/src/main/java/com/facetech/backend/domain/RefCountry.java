package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class RefCountry extends BaseEntity {

    private String code;

    private String iso2;

    private String nameEn;

    private String nameAr;
}
