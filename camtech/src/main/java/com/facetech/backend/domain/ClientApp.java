package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class ClientApp extends BaseEntity {

    private Long tenantId;

    private String code;

    private String name;

    @Enumerated(EnumType.STRING)
    private Codes.Channel channel;

    private String platform;

    private String appIdentifier;

    /** Comma-separated web origins allowed to call with this app’s credentials. */
    private String allowedOrigins;

    @Enumerated(EnumType.STRING)
    private Codes.ActiveStatus status;
}
