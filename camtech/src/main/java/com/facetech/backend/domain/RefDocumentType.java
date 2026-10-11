package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

@Entity
@Getter
@Setter
public class RefDocumentType extends BaseEntity {

    private String code;

    private String name;

    private int sides;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean hasMrz;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean hasFacePhoto;
}
