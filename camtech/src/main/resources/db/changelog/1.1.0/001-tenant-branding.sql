--liquibase formatted sql

-- How a tenant's end users see the web SDK (camtech-ui/apps/sdk), edited in the tenant portal.
-- One row per tenant; no row = camtech defaults.

--changeset camtech:1.1.0-001-tenant-branding
CREATE TABLE tenant_branding (
    id                NUMBER(19)          NOT NULL,
    tenant_id         NUMBER(19)          NOT NULL,
    display_name      VARCHAR2(100 CHAR),
    logo_data_url     CLOB,
    primary_color     VARCHAR2(9 CHAR)    NOT NULL,
    accent_color      VARCHAR2(9 CHAR)    NOT NULL,
    background_color  VARCHAR2(9 CHAR)    NOT NULL,
    surface_color     VARCHAR2(9 CHAR)    NOT NULL,
    text_color        VARCHAR2(9 CHAR)    NOT NULL,
    border_radius     NUMBER(3)           NOT NULL,
    font_family       VARCHAR2(60 CHAR)   NOT NULL,
    theme_mode        VARCHAR2(10 CHAR)   NOT NULL,
    support_email     VARCHAR2(200 CHAR),
    support_url       VARCHAR2(500 CHAR),
    privacy_url       VARCHAR2(500 CHAR),
    show_powered_by   NUMBER(1)           DEFAULT 1 NOT NULL,
    texts             CLOB,
    created_at        TIMESTAMP           NOT NULL,
    created_by        VARCHAR2(100 CHAR),
    updated_at        TIMESTAMP           NOT NULL,
    updated_by        VARCHAR2(100 CHAR),
    row_version       NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_tenant_branding PRIMARY KEY (id),
    CONSTRAINT fk_tenant_branding_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_tenant_branding_tenant UNIQUE (tenant_id),
    CONSTRAINT ck_tenant_branding_theme CHECK (theme_mode IN ('LIGHT', 'DARK', 'AUTO')),
    CONSTRAINT ck_tenant_branding_powered CHECK (show_powered_by IN (0, 1))
);
COMMENT ON TABLE tenant_branding IS 'Web SDK look per tenant: colours, logo, font, texts (JSON by language). No row = defaults.';
--rollback DROP TABLE tenant_branding;

--changeset camtech:1.1.0-001-tenant-branding-json dbms:oracle
ALTER TABLE tenant_branding ADD CONSTRAINT ck_tenant_branding_texts_json CHECK (texts IS JSON);
--rollback ALTER TABLE tenant_branding DROP CONSTRAINT ck_tenant_branding_texts_json;
