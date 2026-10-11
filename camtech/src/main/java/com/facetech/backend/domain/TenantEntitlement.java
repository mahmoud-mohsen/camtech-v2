package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

import java.time.LocalDate;

@Entity
@Getter
@Setter
public class TenantEntitlement extends BaseEntity {

    private Long tenantId;

    @Enumerated(EnumType.STRING)
    private Codes.FeatureType featureType;

    private String featureCode;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean enabled;

    /** Null = unlimited. */
    private Long quotaPerDay;

    private LocalDate validUntil;
}
