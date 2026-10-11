package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Entity
@Getter
@Setter
public class IdentityDocument extends BaseEntity {

    private Long tenantId;

    private String publicId;

    private Long partyId;

    private Long docTypeId;

    private Long issuerId;

    private String documentNumber;

    private String issuingCountry;

    private LocalDate issueDate;

    private LocalDate expiryDate;

    /** When the DOCUMENT_EXPIRING event was sent; null until then. */
    private java.time.Instant expiryNotifiedAt;

    @Enumerated(EnumType.STRING)
    private Codes.DocumentStatus status;
}
