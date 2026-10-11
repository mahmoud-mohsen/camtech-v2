--liquibase formatted sql

-- Tenant portal sign-in: each tenant has its own users (OWNER, DEVELOPER, REVIEWER, VIEWER) who sign in with a
-- username and password. camtech creates the first OWNER from the back-office; the owner adds the rest.
-- Usernames are unique across tenants, so sign-in needs no tenant code. Sessions are opaque bearer tokens, stored hashed.

--changeset camtech:1.7.0-001-tenant-user
CREATE TABLE tenant_user (
    id                    BIGINT              NOT NULL,
    tenant_id             BIGINT              NOT NULL,
    username              VARCHAR(100)  NOT NULL,
    display_name          VARCHAR(200)  NOT NULL,
    email                 VARCHAR(200),
    password_hash         VARCHAR(200)  NOT NULL,
    role                  VARCHAR(20)   NOT NULL,
    status                VARCHAR(20)   NOT NULL,
    must_change_password  SMALLINT            DEFAULT 0 NOT NULL,
    failed_logins         INTEGER             DEFAULT 0 NOT NULL,
    locked_until          TIMESTAMP,
    last_login_at         TIMESTAMP,
    created_at            TIMESTAMP           NOT NULL,
    created_by            VARCHAR(100),
    updated_at            TIMESTAMP           NOT NULL,
    updated_by            VARCHAR(100),
    row_version           INTEGER             DEFAULT 0 NOT NULL,
    CONSTRAINT pk_tenant_user PRIMARY KEY (id),
    CONSTRAINT fk_tenant_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_tenant_user UNIQUE (username),
    CONSTRAINT ck_tenant_user_role CHECK (role IN ('OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER')),
    CONSTRAINT ck_tenant_user_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
CREATE INDEX ix_tenant_user_tenant ON tenant_user (tenant_id);

CREATE TABLE tenant_session (
    id            BIGINT              NOT NULL,
    user_id       BIGINT              NOT NULL,
    token_hash    VARCHAR(64)   NOT NULL,
    expires_at    TIMESTAMP           NOT NULL,
    last_seen_at  TIMESTAMP           NOT NULL,
    ip_address    VARCHAR(45),
    revoked       SMALLINT            DEFAULT 0 NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR(100),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR(100),
    row_version   INTEGER             DEFAULT 0 NOT NULL,
    CONSTRAINT pk_tenant_session PRIMARY KEY (id),
    CONSTRAINT fk_tenant_session_user FOREIGN KEY (user_id) REFERENCES tenant_user (id),
    CONSTRAINT uk_tenant_session_token UNIQUE (token_hash)
);
--rollback DROP TABLE tenant_session;
--rollback DROP TABLE tenant_user;
