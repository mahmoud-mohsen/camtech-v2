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
    id            NUMBER(19)          NOT NULL,
    code          VARCHAR2(30 CHAR)   NOT NULL,
    name          VARCHAR2(200 CHAR)  NOT NULL,
    status        VARCHAR2(20 CHAR)   NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR2(100 CHAR),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR2(100 CHAR),
    row_version   NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_tenant PRIMARY KEY (id),
    CONSTRAINT uk_tenant_code UNIQUE (code),
    CONSTRAINT ck_tenant_status CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);
--rollback DROP TABLE tenant;

--changeset camtech:1.0.0-001-client-app
CREATE TABLE client_app (
    id              NUMBER(19)           NOT NULL,
    tenant_id       NUMBER(19)           NOT NULL,
    code            VARCHAR2(50 CHAR)    NOT NULL,
    name            VARCHAR2(200 CHAR)   NOT NULL,
    channel         VARCHAR2(20 CHAR)    NOT NULL,
    platform        VARCHAR2(20 CHAR),
    app_identifier  VARCHAR2(200 CHAR),
    allowed_origins VARCHAR2(2000 CHAR),
    status          VARCHAR2(20 CHAR)    NOT NULL,
    created_at      TIMESTAMP            NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP            NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_client_app PRIMARY KEY (id),
    CONSTRAINT fk_client_app_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_client_app_code UNIQUE (tenant_id, code),
    CONSTRAINT ck_client_app_channel CHECK (channel IN ('MOBILE', 'WEB', 'ADMIN')),
    CONSTRAINT ck_client_app_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
--rollback DROP TABLE client_app;

--changeset camtech:1.0.0-001-client-credential
CREATE TABLE client_credential (
    id             NUMBER(19)          NOT NULL,
    tenant_id      NUMBER(19)          NOT NULL,
    client_app_id  NUMBER(19)          NOT NULL,
    key_id         VARCHAR2(64 CHAR)   NOT NULL,
    secret_hash    VARCHAR2(200 CHAR)  NOT NULL,
    status         VARCHAR2(20 CHAR)   NOT NULL,
    expires_at     TIMESTAMP,
    last_used_at   TIMESTAMP,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_client_credential PRIMARY KEY (id),
    CONSTRAINT fk_client_cred_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT uk_client_cred_key UNIQUE (key_id),
    CONSTRAINT ck_client_cred_status CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX ix_client_cred_app ON client_credential (client_app_id);
--rollback DROP TABLE client_credential;

--changeset camtech:1.0.0-001-tenant-entitlement
CREATE TABLE tenant_entitlement (
    id             NUMBER(19)          NOT NULL,
    tenant_id      NUMBER(19)          NOT NULL,
    feature_type   VARCHAR2(20 CHAR)   NOT NULL,
    feature_code   VARCHAR2(50 CHAR)   NOT NULL,
    enabled        NUMBER(1)           DEFAULT 1 NOT NULL,
    quota_per_day  NUMBER(12),
    valid_until    DATE,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
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
    id             NUMBER(19)          NOT NULL,
    tenant_id      NUMBER(19)          NOT NULL,
    feature_code   VARCHAR2(50 CHAR)   NOT NULL,
    usage_date     DATE                NOT NULL,
    used_count     NUMBER(12)          DEFAULT 0 NOT NULL,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_usage_counter PRIMARY KEY (id),
    CONSTRAINT fk_usage_counter_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_usage_counter UNIQUE (tenant_id, feature_code, usage_date)
);
--rollback DROP TABLE usage_counter;

--changeset camtech:1.0.0-001-client-app-permission
CREATE TABLE client_app_permission (
    id             NUMBER(19)          NOT NULL,
    tenant_id      NUMBER(19)          NOT NULL,
    client_app_id  NUMBER(19)          NOT NULL,
    feature_code   VARCHAR2(50 CHAR)   NOT NULL,
    allowed        NUMBER(1)           DEFAULT 1 NOT NULL,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_client_app_permission PRIMARY KEY (id),
    CONSTRAINT fk_client_perm_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT uk_client_perm UNIQUE (client_app_id, feature_code),
    CONSTRAINT ck_client_perm_allowed CHECK (allowed IN (0, 1))
);
--rollback DROP TABLE client_app_permission;

--changeset camtech:1.0.0-001-device
CREATE TABLE device (
    id                  NUMBER(19)          NOT NULL,
    tenant_id           NUMBER(19)          NOT NULL,
    client_app_id       NUMBER(19)          NOT NULL,
    device_ref          VARCHAR2(200 CHAR)  NOT NULL,
    platform            VARCHAR2(20 CHAR),
    os_version          VARCHAR2(50 CHAR),
    app_version         VARCHAR2(50 CHAR),
    model               VARCHAR2(100 CHAR),
    attestation_status  VARCHAR2(30 CHAR)   NOT NULL,
    first_seen_at       TIMESTAMP           NOT NULL,
    last_seen_at        TIMESTAMP           NOT NULL,
    created_at          TIMESTAMP           NOT NULL,
    created_by          VARCHAR2(100 CHAR),
    updated_at          TIMESTAMP           NOT NULL,
    updated_by          VARCHAR2(100 CHAR),
    row_version         NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_device PRIMARY KEY (id),
    CONSTRAINT fk_device_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT uk_device_ref UNIQUE (client_app_id, device_ref)
);
--rollback DROP TABLE device;

--changeset camtech:1.0.0-001-config-param
CREATE TABLE config_param (
    id               NUMBER(19)           NOT NULL,
    tenant_id        NUMBER(19)           NOT NULL,
    flow_code        VARCHAR2(50 CHAR),
    channel          VARCHAR2(20 CHAR),
    client_app_code  VARCHAR2(50 CHAR),
    param_key        VARCHAR2(100 CHAR)   NOT NULL,
    param_value      VARCHAR2(1000 CHAR)  NOT NULL,
    description      VARCHAR2(500 CHAR),
    created_at       TIMESTAMP            NOT NULL,
    created_by       VARCHAR2(100 CHAR),
    updated_at       TIMESTAMP            NOT NULL,
    updated_by       VARCHAR2(100 CHAR),
    row_version      NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_config_param PRIMARY KEY (id),
    CONSTRAINT fk_config_param_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_config_param UNIQUE (tenant_id, flow_code, channel, client_app_code, param_key)
);
COMMENT ON TABLE config_param IS 'Settings. NULL scope columns = applies to all; the most specific matching row wins.';
--rollback DROP TABLE config_param;

--changeset camtech:1.0.0-001-audit-event
CREATE TABLE audit_event (
    id           NUMBER(19)          NOT NULL,
    tenant_id    NUMBER(19)          NOT NULL,
    actor_type   VARCHAR2(20 CHAR)   NOT NULL,
    actor        VARCHAR2(100 CHAR)  NOT NULL,
    action       VARCHAR2(60 CHAR)   NOT NULL,
    entity       VARCHAR2(60 CHAR),
    entity_id    VARCHAR2(64 CHAR),
    ip_address   VARCHAR2(45 CHAR),
    details      CLOB,
    occurred_at  TIMESTAMP           NOT NULL,
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_audit_event PRIMARY KEY (id),
    CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('CLIENT', 'ADMIN', 'SYSTEM'))
);
CREATE INDEX ix_audit_event_at ON audit_event (occurred_at);
CREATE INDEX ix_audit_event_entity ON audit_event (entity, entity_id);
--rollback DROP TABLE audit_event;

--changeset camtech:1.0.0-001-outbox-event
CREATE TABLE outbox_event (
    id              NUMBER(19)          NOT NULL,
    tenant_id       NUMBER(19)          NOT NULL,
    aggregate_type  VARCHAR2(40 CHAR)   NOT NULL,
    aggregate_id    VARCHAR2(64 CHAR)   NOT NULL,
    event_type      VARCHAR2(40 CHAR)   NOT NULL,
    payload         CLOB                NOT NULL,
    status          VARCHAR2(20 CHAR)   NOT NULL,
    processed_at    TIMESTAMP,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_outbox_event PRIMARY KEY (id),
    CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);
CREATE INDEX ix_outbox_status ON outbox_event (status, created_at);
CREATE INDEX ix_outbox_aggregate ON outbox_event (aggregate_type, aggregate_id);
--rollback DROP TABLE outbox_event;

--changeset camtech:1.0.0-001-webhook
CREATE TABLE webhook_subscription (
    id           NUMBER(19)           NOT NULL,
    tenant_id    NUMBER(19)           NOT NULL,
    url          VARCHAR2(1000 CHAR)  NOT NULL,
    events       VARCHAR2(500 CHAR)   NOT NULL,
    secret       VARCHAR2(200 CHAR)   NOT NULL,
    status       VARCHAR2(20 CHAR)    NOT NULL,
    created_at   TIMESTAMP            NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP            NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_webhook_subscription PRIMARY KEY (id),
    CONSTRAINT fk_webhook_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT ck_webhook_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
COMMENT ON COLUMN webhook_subscription.secret IS 'HMAC-SHA256 signing secret for the X-Camtech-Signature header';

CREATE TABLE webhook_delivery (
    id               NUMBER(19)           NOT NULL,
    tenant_id        NUMBER(19)           NOT NULL,
    subscription_id  NUMBER(19)           NOT NULL,
    outbox_event_id  NUMBER(19),
    event_type       VARCHAR2(40 CHAR)    NOT NULL,
    attempt          NUMBER(5)            DEFAULT 0 NOT NULL,
    http_status      NUMBER(5),
    status           VARCHAR2(20 CHAR)    NOT NULL,
    error_message    VARCHAR2(1000 CHAR),
    next_retry_at    TIMESTAMP,
    delivered_at     TIMESTAMP,
    created_at       TIMESTAMP            NOT NULL,
    created_by       VARCHAR2(100 CHAR),
    updated_at       TIMESTAMP            NOT NULL,
    updated_by       VARCHAR2(100 CHAR),
    row_version      NUMBER(10)           DEFAULT 0 NOT NULL,
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
    id              NUMBER(19)          NOT NULL,
    tenant_id       NUMBER(19)          NOT NULL,
    data_category   VARCHAR2(40 CHAR)   NOT NULL,
    retention_days  NUMBER(6)           NOT NULL,
    description     VARCHAR2(500 CHAR),
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_retention_policy PRIMARY KEY (id),
    CONSTRAINT fk_retention_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_retention_policy UNIQUE (tenant_id, data_category),
    CONSTRAINT ck_retention_days CHECK (retention_days >= 1)
);
--rollback DROP TABLE retention_policy;

--changeset camtech:1.0.0-001-backoffice-user
CREATE TABLE backoffice_user (
    id                    NUMBER(19)          NOT NULL,
    username              VARCHAR2(100 CHAR)  NOT NULL,
    display_name          VARCHAR2(200 CHAR)  NOT NULL,
    email                 VARCHAR2(200 CHAR),
    password_hash         VARCHAR2(200 CHAR)  NOT NULL,
    role                  VARCHAR2(20 CHAR)   NOT NULL,
    status                VARCHAR2(20 CHAR)   NOT NULL,
    must_change_password  NUMBER(1)           DEFAULT 0 NOT NULL,
    failed_logins         NUMBER(5)           DEFAULT 0 NOT NULL,
    locked_until          TIMESTAMP,
    last_login_at         TIMESTAMP,
    created_at            TIMESTAMP           NOT NULL,
    created_by            VARCHAR2(100 CHAR),
    updated_at            TIMESTAMP           NOT NULL,
    updated_by            VARCHAR2(100 CHAR),
    row_version           NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_backoffice_user PRIMARY KEY (id),
    CONSTRAINT uk_backoffice_user UNIQUE (username),
    CONSTRAINT ck_backoffice_user_role CHECK (role IN ('ADMIN', 'REVIEWER', 'VIEWER')),
    CONSTRAINT ck_backoffice_user_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE backoffice_session (
    id            NUMBER(19)          NOT NULL,
    user_id       NUMBER(19)          NOT NULL,
    token_hash    VARCHAR2(64 CHAR)   NOT NULL,
    expires_at    TIMESTAMP           NOT NULL,
    last_seen_at  TIMESTAMP           NOT NULL,
    ip_address    VARCHAR2(45 CHAR),
    revoked       NUMBER(1)           DEFAULT 0 NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR2(100 CHAR),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR2(100 CHAR),
    row_version   NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_backoffice_session PRIMARY KEY (id),
    CONSTRAINT fk_bo_session_user FOREIGN KEY (user_id) REFERENCES backoffice_user (id),
    CONSTRAINT uk_bo_session_token UNIQUE (token_hash)
);
--rollback DROP TABLE backoffice_session;
--rollback DROP TABLE backoffice_user;
