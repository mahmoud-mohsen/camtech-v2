package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class Party extends BaseEntity {

    private String publicId;

    private Long tenantId;

    @Enumerated(EnumType.STRING)
    private Codes.PartyType partyType;

    /** The calling app’s own reference for this subject. */
    private String externalRef;

    private String status;
}
