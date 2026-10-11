package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

@Entity
@Getter
@Setter
public class RefFieldDef extends BaseEntity {

    private Long docTypeId;

    private String fieldCode;

    private String dataType;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean isPii;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean repeatable;

    private String groupCode;
}
