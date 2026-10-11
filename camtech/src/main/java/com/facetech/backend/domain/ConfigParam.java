package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class ConfigParam extends BaseEntity {

    private Long tenantId;

    private String flowCode;

    private String channel;

    private String clientAppCode;

    private String paramKey;

    private String paramValue;

    private String description;
}
