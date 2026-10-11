package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class Tenant extends BaseEntity {

    private String code;

    private String name;

    private String status;
}
