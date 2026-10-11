package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class RefFlowDef extends BaseEntity {

    private String code;

    private String name;

    private String description;
}
