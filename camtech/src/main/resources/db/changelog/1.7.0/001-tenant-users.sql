--liquibase formatted sql

-- Tenant portal sign-in: each tenant has its own users (OWNER, DEVELOPER, REVIEWER, VIEWER) who sign in with a
-- username and password. camtech creates the first OWNER from the back-office; the owner adds the rest.
-- Usernames are unique across tenants, so sign-in needs no tenant code. Sessions are opaque bearer tokens, stored hashed.

--changeset camtech:1.7.0-001-tenant-user
CREATE TABLE tenant_user (
    id                    NUMBER(19)          NOT NULL,
    tenant_id             NUMBER(19)          NOT NULL,
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
    CONSTRAINT pk_tenant_user PRIMARY KEY (id),
    CONSTRAINT fk_tenant_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_tenant_user UNIQUE (username),
    CONSTRAINT ck_tenant_user_role CHECK (role IN ('OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER')),
    CONSTRAINT ck_tenant_user_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
CREATE INDEX ix_tenant_user_tenant ON tenant_user (tenant_id);

CREATE TABLE tenant_session (
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
    CONSTRAINT pk_tenant_session PRIMARY KEY (id),
    CONSTRAINT fk_tenant_session_user FOREIGN KEY (user_id) REFERENCES tenant_user (id),
    CONSTRAINT uk_tenant_session_token UNIQUE (token_hash)
);
--rollback DROP TABLE tenant_session;
--rollback DROP TABLE tenant_user;
