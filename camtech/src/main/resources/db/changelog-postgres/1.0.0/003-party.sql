--liquibase formatted sql

-- The subject being verified: a person or an organization.

--changeset camtech:1.0.0-003-party
CREATE TABLE party (
    id            BIGINT          NOT NULL,
    public_id     VARCHAR(36)   NOT NULL,
    tenant_id     BIGINT          NOT NULL,
    party_type    VARCHAR(10)   NOT NULL,
    external_ref  VARCHAR(200),
    status        VARCHAR(20)   NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR(100),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR(100),
    row_version   INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party PRIMARY KEY (id),
    CONSTRAINT fk_party_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_party_public_id UNIQUE (public_id),
    CONSTRAINT ck_party_type CHECK (party_type IN ('PERSON', 'ORG')),
    CONSTRAINT ck_party_status CHECK (status IN ('ACTIVE', 'BLOCKED'))
);
CREATE INDEX ix_party_external_ref ON party (tenant_id, external_ref);
COMMENT ON COLUMN party.external_ref IS 'The calling app''s own reference for this subject (opaque to camtech)';

CREATE TABLE party_person (
    id             BIGINT          NOT NULL,
    party_id       BIGINT          NOT NULL,
    full_name_en   VARCHAR(300),
    full_name_ar   VARCHAR(300),
    date_of_birth  DATE,
    gender         VARCHAR(10),
    nationality    VARCHAR(100),
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party_person PRIMARY KEY (id),
    CONSTRAINT fk_party_person_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT uk_party_person UNIQUE (party_id)
);

CREATE TABLE party_organization (
    id             BIGINT          NOT NULL,
    party_id       BIGINT          NOT NULL,
    legal_name_en  VARCHAR(300),
    legal_name_ar  VARCHAR(300),
    legal_form     VARCHAR(100),
    issuer_code    VARCHAR(60),
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party_organization PRIMARY KEY (id),
    CONSTRAINT fk_party_org_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT uk_party_org UNIQUE (party_id)
);

CREATE TABLE party_relation (
    id                  BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    from_party_id       BIGINT          NOT NULL,
    to_party_id         BIGINT          NOT NULL,
    relation_type       VARCHAR(30)   NOT NULL,
    share_pct           NUMERIC(5,2),
    source_document_id  BIGINT,
    created_at          TIMESTAMP           NOT NULL,
    created_by          VARCHAR(100),
    updated_at          TIMESTAMP           NOT NULL,
    updated_by          VARCHAR(100),
    row_version         INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party_relation PRIMARY KEY (id),
    CONSTRAINT fk_party_rel_from FOREIGN KEY (from_party_id) REFERENCES party (id),
    CONSTRAINT fk_party_rel_to FOREIGN KEY (to_party_id) REFERENCES party (id)
);
CREATE INDEX ix_party_rel_from ON party_relation (from_party_id);
CREATE INDEX ix_party_rel_to ON party_relation (to_party_id);
--rollback DROP TABLE party_relation;
--rollback DROP TABLE party_organization;
--rollback DROP TABLE party_person;
--rollback DROP TABLE party;
