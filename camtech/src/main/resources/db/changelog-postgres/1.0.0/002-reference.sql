--liquibase formatted sql

-- Reference data. Adding a document type, issuer, field, flow, step or reason code is an INSERT, not DDL.

--changeset camtech:1.0.0-002-ref-country
CREATE TABLE ref_country (
    id           BIGINT          NOT NULL,
    code         VARCHAR(3)    NOT NULL,
    iso2         VARCHAR(2)    NOT NULL,
    name_en      VARCHAR(100)  NOT NULL,
    name_ar      VARCHAR(100),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_country PRIMARY KEY (id),
    CONSTRAINT uk_ref_country UNIQUE (code)
);
--rollback DROP TABLE ref_country;

--changeset camtech:1.0.0-002-ref-document-type
CREATE TABLE ref_document_type (
    id              BIGINT          NOT NULL,
    code            VARCHAR(30)   NOT NULL,
    name            VARCHAR(100)  NOT NULL,
    sides           SMALLINT           NOT NULL,
    has_mrz         SMALLINT           DEFAULT 0 NOT NULL,
    has_face_photo  SMALLINT           DEFAULT 0 NOT NULL,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_document_type PRIMARY KEY (id),
    CONSTRAINT uk_ref_document_type UNIQUE (code)
);
--rollback DROP TABLE ref_document_type;

--changeset camtech:1.0.0-002-ref-issuer
CREATE TABLE ref_issuer (
    id            BIGINT          NOT NULL,
    code          VARCHAR(60)   NOT NULL,
    doc_type_id   BIGINT          NOT NULL,
    country_code  VARCHAR(3)    NOT NULL,
    emirate       VARCHAR(10),
    name_en       VARCHAR(200)  NOT NULL,
    name_ar       VARCHAR(200),
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR(100),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR(100),
    row_version   INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_issuer PRIMARY KEY (id),
    CONSTRAINT fk_ref_issuer_doc_type FOREIGN KEY (doc_type_id) REFERENCES ref_document_type (id),
    CONSTRAINT uk_ref_issuer UNIQUE (code)
);
--rollback DROP TABLE ref_issuer;

--changeset camtech:1.0.0-002-ref-field-def
CREATE TABLE ref_field_def (
    id           BIGINT          NOT NULL,
    doc_type_id  BIGINT          NOT NULL,
    field_code   VARCHAR(60)   NOT NULL,
    data_type    VARCHAR(20)   NOT NULL,
    is_pii       SMALLINT           DEFAULT 0 NOT NULL,
    repeatable   SMALLINT           DEFAULT 0 NOT NULL,
    group_code   VARCHAR(40),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_field_def PRIMARY KEY (id),
    CONSTRAINT fk_ref_field_doc_type FOREIGN KEY (doc_type_id) REFERENCES ref_document_type (id),
    CONSTRAINT uk_ref_field_def UNIQUE (doc_type_id, field_code),
    CONSTRAINT ck_ref_field_data_type CHECK (data_type IN ('TEXT', 'DATE', 'NUMBER'))
);
--rollback DROP TABLE ref_field_def;

--changeset camtech:1.0.0-002-ref-flow
CREATE TABLE ref_flow_def (
    id           BIGINT          NOT NULL,
    code         VARCHAR(50)   NOT NULL,
    name         VARCHAR(100)  NOT NULL,
    description  VARCHAR(500),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_flow_def PRIMARY KEY (id),
    CONSTRAINT uk_ref_flow_def UNIQUE (code)
);

CREATE TABLE ref_flow_step_def (
    id            BIGINT          NOT NULL,
    flow_id       BIGINT          NOT NULL,
    seq           SMALLINT           NOT NULL,
    step_code     VARCHAR(40)   NOT NULL,
    mandatory     SMALLINT           DEFAULT 1 NOT NULL,
    max_attempts  SMALLINT           NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR(100),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR(100),
    row_version   INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_flow_step_def PRIMARY KEY (id),
    CONSTRAINT fk_ref_flow_step_flow FOREIGN KEY (flow_id) REFERENCES ref_flow_def (id),
    CONSTRAINT uk_ref_flow_step UNIQUE (flow_id, step_code),
    CONSTRAINT ck_ref_flow_step_attempts CHECK (max_attempts >= 1)
);
--rollback DROP TABLE ref_flow_step_def;
--rollback DROP TABLE ref_flow_def;

--changeset camtech:1.0.0-002-ref-reason-code
CREATE TABLE ref_reason_code (
    id           BIGINT          NOT NULL,
    code         VARCHAR(48)   NOT NULL,
    category     VARCHAR(20)   NOT NULL,
    http_status  SMALLINT           NOT NULL,
    message_en   VARCHAR(500)  NOT NULL,
    message_ar   VARCHAR(500),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_reason_code PRIMARY KEY (id),
    CONSTRAINT uk_ref_reason_code UNIQUE (code),
    CONSTRAINT ck_ref_reason_category CHECK (category IN ('LIVENESS', 'DOCUMENT', 'MATCH', 'SESSION', 'ACCESS', 'SYSTEM'))
);
--rollback DROP TABLE ref_reason_code;
