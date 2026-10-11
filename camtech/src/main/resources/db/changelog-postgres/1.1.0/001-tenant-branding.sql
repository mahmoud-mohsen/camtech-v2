--liquibase formatted sql

-- How a tenant's end users see the web SDK (camtech-ui/apps/sdk), edited in the tenant portal.
-- One row per tenant; no row = camtech defaults.

--changeset camtech:1.1.0-001-tenant-branding
CREATE TABLE tenant_branding (
    id                BIGINT          NOT NULL,
    tenant_id         BIGINT          NOT NULL,
    display_name      VARCHAR(100),
    logo_data_url     TEXT,
    primary_color     VARCHAR(9)    NOT NULL,
    accent_color      VARCHAR(9)    NOT NULL,
    background_color  VARCHAR(9)    NOT NULL,
    surface_color     VARCHAR(9)    NOT NULL,
    text_color        VARCHAR(9)    NOT NULL,
    border_radius     SMALLINT           NOT NULL,
    font_family       VARCHAR(60)   NOT NULL,
    theme_mode        VARCHAR(10)   NOT NULL,
    support_email     VARCHAR(200),
    support_url       VARCHAR(500),
    privacy_url       VARCHAR(500),
    show_powered_by   SMALLINT           DEFAULT 1 NOT NULL,
    texts             TEXT,
    created_at        TIMESTAMP           NOT NULL,
    created_by        VARCHAR(100),
    updated_at        TIMESTAMP           NOT NULL,
    updated_by        VARCHAR(100),
    row_version       INTEGER          DEFAULT 0 NOT NULL,
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
