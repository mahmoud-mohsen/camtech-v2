package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class MediaFile extends BaseEntity {

    private Long tenantId;

    private String sha256;

    private String mimeType;

    private long byteCount;

    private Integer width;

    private Integer height;

    private String storageUri;

    @Enumerated(EnumType.STRING)
    private Codes.MediaCategory dataCategory;

    private Instant purgeAfter;

    private Instant purgedAt;
}
