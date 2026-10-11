package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

/**
 * Liveness limits for one tenant and flow, set by the back-office: the modes and challenges the
 * tenant may choose and how many challenges each user does. Lists are comma-separated.
 */
@Entity
@Getter
@Setter
public class FlowLivenessPolicy extends BaseEntity {

    private Long tenantId;

    private String flowCode;

    private String allowedModes;

    private String allowedActions;

    private int minActions;

    private int maxActions;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean requireSpareAction;
}
