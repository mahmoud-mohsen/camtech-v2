package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Getter
@Setter
public class DocumentField extends BaseEntity {

    private Long tenantId;

    private Long documentId;

    private String fieldCode;

    private String lang;

    private String valueText;

    private LocalDate valueDate;

    private BigDecimal valueNum;

    private String groupCode;

    private Integer groupIdx;

    @Enumerated(EnumType.STRING)
    private Codes.FieldSource source;

    private BigDecimal confidence;

    private Long sourceScanId;

    private Long sourceStepId;
}
