--liquibase formatted sql

-- Reference data. Adding a document type, issuer, field, flow, step or reason code is an INSERT, not DDL.

--changeset camtech:1.0.0-002-ref-country
CREATE TABLE ref_country (
    id           NUMBER(19)          NOT NULL,
    code         VARCHAR2(3 CHAR)    NOT NULL,
    iso2         VARCHAR2(2 CHAR)    NOT NULL,
    name_en      VARCHAR2(100 CHAR)  NOT NULL,
    name_ar      VARCHAR2(100 CHAR),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_country PRIMARY KEY (id),
    CONSTRAINT uk_ref_country UNIQUE (code)
);
--rollback DROP TABLE ref_country;

--changeset camtech:1.0.0-002-ref-document-type
CREATE TABLE ref_document_type (
    id              NUMBER(19)          NOT NULL,
    code            VARCHAR2(30 CHAR)   NOT NULL,
    name            VARCHAR2(100 CHAR)  NOT NULL,
    sides           NUMBER(1)           NOT NULL,
    has_mrz         NUMBER(1)           DEFAULT 0 NOT NULL,
    has_face_photo  NUMBER(1)           DEFAULT 0 NOT NULL,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_document_type PRIMARY KEY (id),
    CONSTRAINT uk_ref_document_type UNIQUE (code)
);
--rollback DROP TABLE ref_document_type;

--changeset camtech:1.0.0-002-ref-issuer
CREATE TABLE ref_issuer (
    id            NUMBER(19)          NOT NULL,
    code          VARCHAR2(60 CHAR)   NOT NULL,
    doc_type_id   NUMBER(19)          NOT NULL,
    country_code  VARCHAR2(3 CHAR)    NOT NULL,
    emirate       VARCHAR2(10 CHAR),
    name_en       VARCHAR2(200 CHAR)  NOT NULL,
    name_ar       VARCHAR2(200 CHAR),
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR2(100 CHAR),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR2(100 CHAR),
    row_version   NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_issuer PRIMARY KEY (id),
    CONSTRAINT fk_ref_issuer_doc_type FOREIGN KEY (doc_type_id) REFERENCES ref_document_type (id),
    CONSTRAINT uk_ref_issuer UNIQUE (code)
);
--rollback DROP TABLE ref_issuer;

--changeset camtech:1.0.0-002-ref-field-def
CREATE TABLE ref_field_def (
    id           NUMBER(19)          NOT NULL,
    doc_type_id  NUMBER(19)          NOT NULL,
    field_code   VARCHAR2(60 CHAR)   NOT NULL,
    data_type    VARCHAR2(20 CHAR)   NOT NULL,
    is_pii       NUMBER(1)           DEFAULT 0 NOT NULL,
    repeatable   NUMBER(1)           DEFAULT 0 NOT NULL,
    group_code   VARCHAR2(40 CHAR),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_field_def PRIMARY KEY (id),
    CONSTRAINT fk_ref_field_doc_type FOREIGN KEY (doc_type_id) REFERENCES ref_document_type (id),
    CONSTRAINT uk_ref_field_def UNIQUE (doc_type_id, field_code),
    CONSTRAINT ck_ref_field_data_type CHECK (data_type IN ('TEXT', 'DATE', 'NUMBER'))
);
--rollback DROP TABLE ref_field_def;

--changeset camtech:1.0.0-002-ref-flow
CREATE TABLE ref_flow_def (
    id           NUMBER(19)          NOT NULL,
    code         VARCHAR2(50 CHAR)   NOT NULL,
    name         VARCHAR2(100 CHAR)  NOT NULL,
    description  VARCHAR2(500 CHAR),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_flow_def PRIMARY KEY (id),
    CONSTRAINT uk_ref_flow_def UNIQUE (code)
);

CREATE TABLE ref_flow_step_def (
    id            NUMBER(19)          NOT NULL,
    flow_id       NUMBER(19)          NOT NULL,
    seq           NUMBER(3)           NOT NULL,
    step_code     VARCHAR2(40 CHAR)   NOT NULL,
    mandatory     NUMBER(1)           DEFAULT 1 NOT NULL,
    max_attempts  NUMBER(3)           NOT NULL,
    created_at    TIMESTAMP           NOT NULL,
    created_by    VARCHAR2(100 CHAR),
    updated_at    TIMESTAMP           NOT NULL,
    updated_by    VARCHAR2(100 CHAR),
    row_version   NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_flow_step_def PRIMARY KEY (id),
    CONSTRAINT fk_ref_flow_step_flow FOREIGN KEY (flow_id) REFERENCES ref_flow_def (id),
    CONSTRAINT uk_ref_flow_step UNIQUE (flow_id, step_code),
    CONSTRAINT ck_ref_flow_step_attempts CHECK (max_attempts >= 1)
);
--rollback DROP TABLE ref_flow_step_def;
--rollback DROP TABLE ref_flow_def;

--changeset camtech:1.0.0-002-ref-reason-code
CREATE TABLE ref_reason_code (
    id           NUMBER(19)          NOT NULL,
    code         VARCHAR2(48 CHAR)   NOT NULL,
    category     VARCHAR2(20 CHAR)   NOT NULL,
    http_status  NUMBER(3)           NOT NULL,
    message_en   VARCHAR2(500 CHAR)  NOT NULL,
    message_ar   VARCHAR2(500 CHAR),
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ref_reason_code PRIMARY KEY (id),
    CONSTRAINT uk_ref_reason_code UNIQUE (code),
    CONSTRAINT ck_ref_reason_category CHECK (category IN ('LIVENESS', 'DOCUMENT', 'MATCH', 'SESSION', 'ACCESS', 'SYSTEM'))
);
--rollback DROP TABLE ref_reason_code;
