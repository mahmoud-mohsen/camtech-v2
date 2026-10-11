package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

@Entity
@Getter
@Setter
public class RefFlowStepDef extends BaseEntity {

    private Long flowId;

    private int seq;

    private String stepCode;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean mandatory;

    private int maxAttempts;
}
