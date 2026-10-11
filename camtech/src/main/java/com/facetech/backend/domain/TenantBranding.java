package com.facetech.backend.domain;

import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.type.NumericBooleanConverter;

/** How a tenant's end users see the web SDK. One row per tenant; no row means camtech defaults. */
@Entity
@Getter
@Setter
public class TenantBranding extends BaseEntity {

    private Long tenantId;

    private String displayName;

    /** data:image/...;base64 URL, limited in size by the API. */
    @Lob
    private String logoDataUrl;

    private String primaryColor;

    private String accentColor;

    private String backgroundColor;

    private String surfaceColor;

    private String textColor;

    private int borderRadius;

    private String fontFamily;

    /** LIGHT, DARK or AUTO (follows the device). */
    private String themeMode;

    private String supportEmail;

    private String supportUrl;

    private String privacyUrl;

    @Convert(converter = NumericBooleanConverter.class)
    private boolean showPoweredBy;

    /** JSON: {"en": {"welcomeTitle": ...}, "ar": {...}}. */
    @Lob
    private String texts;
}
