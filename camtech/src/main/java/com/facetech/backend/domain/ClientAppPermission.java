package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

@Entity
@Getter
@Setter
public class ClientAppPermission extends BaseEntity {

    private Long tenantId;

    private Long clientAppId;

    private String featureCode;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean allowed;
}
