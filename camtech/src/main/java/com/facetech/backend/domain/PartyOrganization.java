package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class PartyOrganization extends BaseEntity {

    private Long partyId;

    private String legalNameEn;

    private String legalNameAr;

    private String legalForm;

    private String issuerCode;
}
