package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Entity
@Getter
@Setter
public class ScanFieldResult extends BaseEntity {

    private Long tenantId;

    private Long scanId;

    private String fieldCode;

    private String lang;

    @Lob
    private String rawValue;

    private BigDecimal confidence;

    private String validationStatus;

    private String validationMessage;

    /** ExtractionSource name: where the value was read (MRZ_VERIFIED, LAYOUT, LABEL...). */
    private String extractionSource;

    /** Value confirmed or corrected by a reviewer; raw_value keeps what OCR read. */
    @Lob
    private String reviewedValue;
}
