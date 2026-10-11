--liquibase formatted sql

-- The subject being verified: a person or an organization.

--changeset camtech:1.0.0-003-party
CREATE TABLE party (
    id            NUMBER(19)          NOT NULL,
    public_id     VARCHAR2(36 CHAR)   NOT NULL,
    tenant_id     NUMBER(19)          NOT NULL,
    party_type    VARCHAR2(10 CHAR)   NOT NULL,
    external_ref  VARCHAR2(200 CHAR),
    status        VARCHAR2(20 CHAR)   NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR2(100 CHAR),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR2(100 CHAR),
    row_version   NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party PRIMARY KEY (id),
    CONSTRAINT fk_party_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_party_public_id UNIQUE (public_id),
    CONSTRAINT ck_party_type CHECK (party_type IN ('PERSON', 'ORG')),
    CONSTRAINT ck_party_status CHECK (status IN ('ACTIVE', 'BLOCKED'))
);
CREATE INDEX ix_party_external_ref ON party (tenant_id, external_ref);
COMMENT ON COLUMN party.external_ref IS 'The calling app''s own reference for this subject (opaque to camtech)';

CREATE TABLE party_person (
    id             NUMBER(19)          NOT NULL,
    party_id       NUMBER(19)          NOT NULL,
    full_name_en   VARCHAR2(300 CHAR),
    full_name_ar   VARCHAR2(300 CHAR),
    date_of_birth  DATE,
    gender         VARCHAR2(10 CHAR),
    nationality    VARCHAR2(100 CHAR),
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party_person PRIMARY KEY (id),
    CONSTRAINT fk_party_person_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT uk_party_person UNIQUE (party_id)
);

CREATE TABLE party_organization (
    id             NUMBER(19)          NOT NULL,
    party_id       NUMBER(19)          NOT NULL,
    legal_name_en  VARCHAR2(300 CHAR),
    legal_name_ar  VARCHAR2(300 CHAR),
    legal_form     VARCHAR2(100 CHAR),
    issuer_code    VARCHAR2(60 CHAR),
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_party_organization PRIMARY KEY (id),
    CONSTRAINT fk_party_org_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT uk_party_org UNIQUE (party_id)
);

CREATE TABLE party_relation (
    id                  NUMBER(19)          NOT NULL,
    tenant_id           NUMBER(19)          NOT NULL,
    from_party_id       NUMBER(19)          NOT NULL,
    to_party_id         NUMBER(19)          NOT NULL,
    relation_type       VARCHAR2(30 CHAR)   NOT NULL,
    share_pct           NUMBER(5,2),
    source_document_id  NUMBER(19),
    created_at          TIMESTAMP           NOT NULL,
    created_by          VARCHAR2(100 CHAR),
    updated_at          TIMESTAMP           NOT NULL,
    updated_by          VARCHAR2(100 CHAR),
    row_version         NUMBER(10)          DEFAULT 0 NOT NULL,
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
