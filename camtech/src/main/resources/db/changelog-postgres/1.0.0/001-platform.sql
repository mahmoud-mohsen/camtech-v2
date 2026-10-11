--liquibase formatted sql

-- Every table carries the same audit columns:
--   created_at / updated_at (UTC), created_by / updated_by (actor), row_version (optimistic locking).
-- All ids come from one sequence (camtech_seq, step 50 for Hibernate's pooled optimizer).
-- Seed rows use ids below 1000.

--changeset camtech:1.0.0-001-sequence
CREATE SEQUENCE camtech_seq START WITH 1000 INCREMENT BY 50;
--rollback DROP SEQUENCE camtech_seq;

--changeset camtech:1.0.0-001-tenant
CREATE TABLE tenant (
    id            BIGINT          NOT NULL,
    code          VARCHAR(30)   NOT NULL,
    name          VARCHAR(200)  NOT NULL,
    status        VARCHAR(20)   NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR(100),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR(100),
    row_version   INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_tenant PRIMARY KEY (id),
    CONSTRAINT uk_tenant_code UNIQUE (code),
    CONSTRAINT ck_tenant_status CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);
--rollback DROP TABLE tenant;

--changeset camtech:1.0.0-001-client-app
CREATE TABLE client_app (
    id              BIGINT           NOT NULL,
    tenant_id       BIGINT           NOT NULL,
    code            VARCHAR(50)    NOT NULL,
    name            VARCHAR(200)   NOT NULL,
    channel         VARCHAR(20)    NOT NULL,
    platform        VARCHAR(20),
    app_identifier  VARCHAR(200),
    allowed_origins VARCHAR(2000),
    status          VARCHAR(20)    NOT NULL,
    created_at      TIMESTAMP            NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP            NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_client_app PRIMARY KEY (id),
    CONSTRAINT fk_client_app_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_client_app_code UNIQUE (tenant_id, code),
    CONSTRAINT ck_client_app_channel CHECK (channel IN ('MOBILE', 'WEB', 'ADMIN')),
    CONSTRAINT ck_client_app_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
--rollback DROP TABLE client_app;

--changeset camtech:1.0.0-001-client-credential
CREATE TABLE client_credential (
    id             BIGINT          NOT NULL,
    tenant_id      BIGINT          NOT NULL,
    client_app_id  BIGINT          NOT NULL,
    key_id         VARCHAR(64)   NOT NULL,
    secret_hash    VARCHAR(200)  NOT NULL,
    status         VARCHAR(20)   NOT NULL,
    expires_at     TIMESTAMP,
    last_used_at   TIMESTAMP,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_client_credential PRIMARY KEY (id),
    CONSTRAINT fk_client_cred_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT uk_client_cred_key UNIQUE (key_id),
    CONSTRAINT ck_client_cred_status CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX ix_client_cred_app ON client_credential (client_app_id);
--rollback DROP TABLE client_credential;

--changeset camtech:1.0.0-001-tenant-entitlement
CREATE TABLE tenant_entitlement (
    id             BIGINT          NOT NULL,
    tenant_id      BIGINT          NOT NULL,
    feature_type   VARCHAR(20)   NOT NULL,
    feature_code   VARCHAR(50)   NOT NULL,
    enabled        SMALLINT           DEFAULT 1 NOT NULL,
    quota_per_day  BIGINT,
    valid_until    DATE,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_tenant_entitlement PRIMARY KEY (id),
    CONSTRAINT fk_tenant_ent_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_tenant_ent UNIQUE (tenant_id, feature_type, feature_code),
    CONSTRAINT ck_tenant_ent_type CHECK (feature_type IN ('FLOW', 'DOCUMENT', 'FEATURE')),
    CONSTRAINT ck_tenant_ent_enabled CHECK (enabled IN (0, 1)),
    CONSTRAINT ck_tenant_ent_quota CHECK (quota_per_day IS NULL OR quota_per_day >= 0)
);
COMMENT ON COLUMN tenant_entitlement.quota_per_day IS 'NULL = unlimited';
--rollback DROP TABLE tenant_entitlement;

--changeset camtech:1.0.0-001-usage-counter
CREATE TABLE usage_counter (
    id             BIGINT          NOT NULL,
    tenant_id      BIGINT          NOT NULL,
    feature_code   VARCHAR(50)   NOT NULL,
    usage_date     DATE                NOT NULL,
    used_count     BIGINT          DEFAULT 0 NOT NULL,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_usage_counter PRIMARY KEY (id),
    CONSTRAINT fk_usage_counter_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_usage_counter UNIQUE (tenant_id, feature_code, usage_date)
);
--rollback DROP TABLE usage_counter;

--changeset camtech:1.0.0-001-client-app-permission
CREATE TABLE client_app_permission (
    id             BIGINT          NOT NULL,
    tenant_id      BIGINT          NOT NULL,
    client_app_id  BIGINT          NOT NULL,
    feature_code   VARCHAR(50)   NOT NULL,
    allowed        SMALLINT           DEFAULT 1 NOT NULL,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_client_app_permission PRIMARY KEY (id),
    CONSTRAINT fk_client_perm_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT uk_client_perm UNIQUE (client_app_id, feature_code),
    CONSTRAINT ck_client_perm_allowed CHECK (allowed IN (0, 1))
);
--rollback DROP TABLE client_app_permission;

--changeset camtech:1.0.0-001-device
CREATE TABLE device (
    id                  BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    client_app_id       BIGINT          NOT NULL,
    device_ref          VARCHAR(200)  NOT NULL,
    platform            VARCHAR(20),
    os_version          VARCHAR(50),
    app_version         VARCHAR(50),
    model               VARCHAR(100),
    attestation_status  VARCHAR(30)   NOT NULL,
    first_seen_at       TIMESTAMP           NOT NULL,
    last_seen_at        TIMESTAMP           NOT NULL,
    created_at          TIMESTAMP           NOT NULL,
    created_by          VARCHAR(100),
    updated_at          TIMESTAMP           NOT NULL,
    updated_by          VARCHAR(100),
    row_version         INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_device PRIMARY KEY (id),
    CONSTRAINT fk_device_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT uk_device_ref UNIQUE (client_app_id, device_ref)
);
--rollback DROP TABLE device;

--changeset camtech:1.0.0-001-config-param
CREATE TABLE config_param (
    id               BIGINT           NOT NULL,
    tenant_id        BIGINT           NOT NULL,
    flow_code        VARCHAR(50),
    channel          VARCHAR(20),
    client_app_code  VARCHAR(50),
    param_key        VARCHAR(100)   NOT NULL,
    param_value      VARCHAR(1000)  NOT NULL,
    description      VARCHAR(500),
    created_at       TIMESTAMP            NOT NULL,
    created_by       VARCHAR(100),
    updated_at       TIMESTAMP            NOT NULL,
    updated_by       VARCHAR(100),
    row_version      INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_config_param PRIMARY KEY (id),
    CONSTRAINT fk_config_param_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_config_param UNIQUE (tenant_id, flow_code, channel, client_app_code, param_key)
);
COMMENT ON TABLE config_param IS 'Settings. NULL scope columns = applies to all; the most specific matching row wins.';
--rollback DROP TABLE config_param;

--changeset camtech:1.0.0-001-audit-event
CREATE TABLE audit_event (
    id           BIGINT          NOT NULL,
    tenant_id    BIGINT          NOT NULL,
    actor_type   VARCHAR(20)   NOT NULL,
    actor        VARCHAR(100)  NOT NULL,
    action       VARCHAR(60)   NOT NULL,
    entity       VARCHAR(60),
    entity_id    VARCHAR(64),
    ip_address   VARCHAR(45),
    details      TEXT,
    occurred_at  TIMESTAMP           NOT NULL,
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_audit_event PRIMARY KEY (id),
    CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('CLIENT', 'ADMIN', 'SYSTEM'))
);
CREATE INDEX ix_audit_event_at ON audit_event (occurred_at);
CREATE INDEX ix_audit_event_entity ON audit_event (entity, entity_id);
--rollback DROP TABLE audit_event;

--changeset camtech:1.0.0-001-outbox-event
CREATE TABLE outbox_event (
    id              BIGINT          NOT NULL,
    tenant_id       BIGINT          NOT NULL,
    aggregate_type  VARCHAR(40)   NOT NULL,
    aggregate_id    VARCHAR(64)   NOT NULL,
    event_type      VARCHAR(40)   NOT NULL,
    payload         TEXT                NOT NULL,
    status          VARCHAR(20)   NOT NULL,
    processed_at    TIMESTAMP,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_outbox_event PRIMARY KEY (id),
    CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);
CREATE INDEX ix_outbox_status ON outbox_event (status, created_at);
CREATE INDEX ix_outbox_aggregate ON outbox_event (aggregate_type, aggregate_id);
--rollback DROP TABLE outbox_event;

--changeset camtech:1.0.0-001-webhook
CREATE TABLE webhook_subscription (
    id           BIGINT           NOT NULL,
    tenant_id    BIGINT           NOT NULL,
    url          VARCHAR(1000)  NOT NULL,
    events       VARCHAR(500)   NOT NULL,
    secret       VARCHAR(200)   NOT NULL,
    status       VARCHAR(20)    NOT NULL,
    created_at   TIMESTAMP            NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP            NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_webhook_subscription PRIMARY KEY (id),
    CONSTRAINT fk_webhook_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT ck_webhook_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
COMMENT ON COLUMN webhook_subscription.secret IS 'HMAC-SHA256 signing secret for the X-Camtech-Signature header';

CREATE TABLE webhook_delivery (
    id               BIGINT           NOT NULL,
    tenant_id        BIGINT           NOT NULL,
    subscription_id  BIGINT           NOT NULL,
    outbox_event_id  BIGINT,
    event_type       VARCHAR(40)    NOT NULL,
    attempt          INTEGER            DEFAULT 0 NOT NULL,
    http_status      INTEGER,
    status           VARCHAR(20)    NOT NULL,
    error_message    VARCHAR(1000),
    next_retry_at    TIMESTAMP,
    delivered_at     TIMESTAMP,
    created_at       TIMESTAMP            NOT NULL,
    created_by       VARCHAR(100),
    updated_at       TIMESTAMP            NOT NULL,
    updated_by       VARCHAR(100),
    row_version      INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_webhook_delivery PRIMARY KEY (id),
    CONSTRAINT fk_webhook_del_sub FOREIGN KEY (subscription_id) REFERENCES webhook_subscription (id),
    CONSTRAINT fk_webhook_del_event FOREIGN KEY (outbox_event_id) REFERENCES outbox_event (id),
    CONSTRAINT ck_webhook_del_status CHECK (status IN ('PENDING', 'DELIVERED', 'RETRYING', 'FAILED'))
);
CREATE INDEX ix_webhook_del_sub ON webhook_delivery (subscription_id, created_at);
CREATE INDEX ix_webhook_del_retry ON webhook_delivery (status, next_retry_at);
--rollback DROP TABLE webhook_delivery;
--rollback DROP TABLE webhook_subscription;

--changeset camtech:1.0.0-001-retention-policy
CREATE TABLE retention_policy (
    id              BIGINT          NOT NULL,
    tenant_id       BIGINT          NOT NULL,
    data_category   VARCHAR(40)   NOT NULL,
    retention_days  INTEGER           NOT NULL,
    description     VARCHAR(500),
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_retention_policy PRIMARY KEY (id),
    CONSTRAINT fk_retention_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_retention_policy UNIQUE (tenant_id, data_category),
    CONSTRAINT ck_retention_days CHECK (retention_days >= 1)
);
--rollback DROP TABLE retention_policy;

--changeset camtech:1.0.0-001-backoffice-user
CREATE TABLE backoffice_user (
    id                    BIGINT          NOT NULL,
    username              VARCHAR(100)  NOT NULL,
    display_name          VARCHAR(200)  NOT NULL,
    email                 VARCHAR(200),
    password_hash         VARCHAR(200)  NOT NULL,
    role                  VARCHAR(20)   NOT NULL,
    status                VARCHAR(20)   NOT NULL,
    must_change_password  SMALLINT           DEFAULT 0 NOT NULL,
    failed_logins         INTEGER           DEFAULT 0 NOT NULL,
    locked_until          TIMESTAMP,
    last_login_at         TIMESTAMP,
    created_at            TIMESTAMP           NOT NULL,
    created_by            VARCHAR(100),
    updated_at            TIMESTAMP           NOT NULL,
    updated_by            VARCHAR(100),
    row_version           INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_backoffice_user PRIMARY KEY (id),
    CONSTRAINT uk_backoffice_user UNIQUE (username),
    CONSTRAINT ck_backoffice_user_role CHECK (role IN ('ADMIN', 'REVIEWER', 'VIEWER')),
    CONSTRAINT ck_backoffice_user_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE backoffice_session (
    id            BIGINT          NOT NULL,
    user_id       BIGINT          NOT NULL,
    token_hash    VARCHAR(64)   NOT NULL,
    expires_at    TIMESTAMP           NOT NULL,
    last_seen_at  TIMESTAMP           NOT NULL,
    ip_address    VARCHAR(45),
    revoked       SMALLINT           DEFAULT 0 NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR(100),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR(100),
    row_version   INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_backoffice_session PRIMARY KEY (id),
    CONSTRAINT fk_bo_session_user FOREIGN KEY (user_id) REFERENCES backoffice_user (id),
    CONSTRAINT uk_bo_session_token UNIQUE (token_hash)
);
--rollback DROP TABLE backoffice_session;
--rollback DROP TABLE backoffice_user;
