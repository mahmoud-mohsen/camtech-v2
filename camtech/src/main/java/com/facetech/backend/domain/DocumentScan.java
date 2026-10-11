package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Getter
@Setter
public class DocumentScan extends BaseEntity {

    private Long tenantId;

    private String publicId;

    private Long documentId;

    private Long sessionId;

    private Long clientAppId;

    private String docTypeCode;

    private String tradeLicenceFormat;

    private String subjectRef;

    @Enumerated(EnumType.STRING)
    private Codes.ScanStatus status;

    private BigDecimal confidence;

    private Long processingMs;

    @Lob
    private String rawText;

    private String errorMessage;

    private String ipAddress;

    private String userAgent;

    /** Document-level issues found by the parser, comma-separated (e.g. EXPIRED,SIDES_MISMATCH). */
    private String issues;

    /** Why the scan needs review: one "CODE|field|message" per line. */
    private String reviewReasons;

    private String reviewedBy;

    private Instant reviewedAt;

    private String reviewNote;
}
