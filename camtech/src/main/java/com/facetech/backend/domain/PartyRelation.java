package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Entity
@Getter
@Setter
public class PartyRelation extends BaseEntity {

    private Long tenantId;

    private Long fromPartyId;

    private Long toPartyId;

    private String relationType;

    private BigDecimal sharePct;

    private Long sourceDocumentId;
}
