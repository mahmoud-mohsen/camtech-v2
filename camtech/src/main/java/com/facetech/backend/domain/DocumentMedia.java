package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class DocumentMedia extends BaseEntity {

    private Long tenantId;

    private Long documentId;

    private Long scanId;

    private Long mediaId;

    private String role;
}
