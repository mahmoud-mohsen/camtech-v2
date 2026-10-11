--liquibase formatted sql

-- Stored images and identity documents. One model for every document type:
-- common columns on identity_document, type-specific values in document_field.

--changeset camtech:1.0.0-004-media-file
CREATE TABLE media_file (
    id             NUMBER(19)           NOT NULL,
    tenant_id      NUMBER(19)           NOT NULL,
    sha256         VARCHAR2(64 CHAR)    NOT NULL,
    mime_type      VARCHAR2(100 CHAR)   NOT NULL,
    byte_count     NUMBER(12)           NOT NULL,
    width          NUMBER(6),
    height         NUMBER(6),
    storage_uri    VARCHAR2(1000 CHAR)  NOT NULL,
    data_category  VARCHAR2(40 CHAR)    NOT NULL,
    purge_after    TIMESTAMP,
    purged_at      TIMESTAMP,
    created_at     TIMESTAMP            NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP            NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_media_file PRIMARY KEY (id),
    CONSTRAINT ck_media_category CHECK (data_category IN ('FAILED_ATTEMPT_MEDIA', 'VERIFIED_MEDIA', 'SCAN_ONLY_MEDIA'))
);
CREATE INDEX ix_media_sha256 ON media_file (sha256);
CREATE INDEX ix_media_purge ON media_file (purge_after, purged_at);
--rollback DROP TABLE media_file;

--changeset camtech:1.0.0-004-identity-document
CREATE TABLE identity_document (
    id               NUMBER(19)          NOT NULL,
    tenant_id        NUMBER(19)          NOT NULL,
    public_id        VARCHAR2(36 CHAR)   NOT NULL,
    party_id         NUMBER(19),
    doc_type_id      NUMBER(19)          NOT NULL,
    issuer_id        NUMBER(19),
    document_number  VARCHAR2(100 CHAR)  NOT NULL,
    issuing_country  VARCHAR2(3 CHAR),
    issue_date       DATE,
    expiry_date      DATE,
    status           VARCHAR2(20 CHAR)   NOT NULL,
    created_at       TIMESTAMP           NOT NULL,
    created_by       VARCHAR2(100 CHAR),
    updated_at       TIMESTAMP           NOT NULL,
    updated_by       VARCHAR2(100 CHAR),
    row_version      NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_identity_document PRIMARY KEY (id),
    CONSTRAINT fk_id_doc_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT fk_id_doc_type FOREIGN KEY (doc_type_id) REFERENCES ref_document_type (id),
    CONSTRAINT fk_id_doc_issuer FOREIGN KEY (issuer_id) REFERENCES ref_issuer (id),
    CONSTRAINT uk_id_doc_public_id UNIQUE (public_id),
    CONSTRAINT uk_id_doc_number UNIQUE (tenant_id, doc_type_id, issuing_country, document_number),
    CONSTRAINT ck_id_doc_status CHECK (status IN ('CAPTURED', 'VERIFIED', 'EXPIRED', 'REJECTED'))
);
CREATE INDEX ix_id_doc_party ON identity_document (party_id);
CREATE INDEX ix_id_doc_expiry ON identity_document (expiry_date);
--rollback DROP TABLE identity_document;

--changeset camtech:1.0.0-004-document-scan
CREATE TABLE document_scan (
    id                    NUMBER(19)           NOT NULL,
    tenant_id             NUMBER(19)           NOT NULL,
    public_id             VARCHAR2(36 CHAR)    NOT NULL,
    document_id           NUMBER(19),
    session_id            NUMBER(19),
    client_app_id         NUMBER(19),
    doc_type_code         VARCHAR2(30 CHAR)    NOT NULL,
    trade_licence_format  VARCHAR2(60 CHAR),
    subject_ref           VARCHAR2(200 CHAR),
    status                VARCHAR2(20 CHAR)    NOT NULL,
    confidence            NUMBER(5,4),
    processing_ms         NUMBER(10),
    raw_text              CLOB,
    error_message         VARCHAR2(1000 CHAR),
    ip_address            VARCHAR2(45 CHAR),
    user_agent            VARCHAR2(500 CHAR),
    created_at            TIMESTAMP            NOT NULL,
    created_by            VARCHAR2(100 CHAR),
    updated_at            TIMESTAMP            NOT NULL,
    updated_by            VARCHAR2(100 CHAR),
    row_version           NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_document_scan PRIMARY KEY (id),
    CONSTRAINT fk_doc_scan_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT uk_doc_scan_public_id UNIQUE (public_id),
    CONSTRAINT ck_doc_scan_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
);
CREATE INDEX ix_doc_scan_document ON document_scan (document_id);
CREATE INDEX ix_doc_scan_subject ON document_scan (tenant_id, subject_ref);
CREATE INDEX ix_doc_scan_created ON document_scan (created_at);

CREATE TABLE scan_field_result (
    id                  NUMBER(19)           NOT NULL,
    tenant_id           NUMBER(19)           NOT NULL,
    scan_id             NUMBER(19)           NOT NULL,
    field_code          VARCHAR2(100 CHAR)   NOT NULL,
    lang                VARCHAR2(5 CHAR),
    raw_value           CLOB,
    confidence          NUMBER(5,4),
    validation_status   VARCHAR2(20 CHAR),
    validation_message  VARCHAR2(500 CHAR),
    created_at          TIMESTAMP            NOT NULL,
    created_by          VARCHAR2(100 CHAR),
    updated_at          TIMESTAMP            NOT NULL,
    updated_by          VARCHAR2(100 CHAR),
    row_version         NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_scan_field_result PRIMARY KEY (id),
    CONSTRAINT fk_scan_field_scan FOREIGN KEY (scan_id) REFERENCES document_scan (id)
);
CREATE INDEX ix_scan_field_scan ON scan_field_result (scan_id);

CREATE TABLE ocr_call (
    id             NUMBER(19)           NOT NULL,
    tenant_id      NUMBER(19)           NOT NULL,
    scan_id        NUMBER(19)           NOT NULL,
    provider       VARCHAR2(50 CHAR)    NOT NULL,
    status         VARCHAR2(20 CHAR)    NOT NULL,
    duration_ms    NUMBER(10),
    error_message  VARCHAR2(2000 CHAR),
    created_at     TIMESTAMP            NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP            NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_ocr_call PRIMARY KEY (id),
    CONSTRAINT fk_ocr_call_scan FOREIGN KEY (scan_id) REFERENCES document_scan (id),
    CONSTRAINT ck_ocr_call_status CHECK (status IN ('SUCCESS', 'FAILED'))
);
CREATE INDEX ix_ocr_call_scan ON ocr_call (scan_id);
--rollback DROP TABLE ocr_call;
--rollback DROP TABLE scan_field_result;
--rollback DROP TABLE document_scan;

--changeset camtech:1.0.0-004-document-field
CREATE TABLE document_field (
    id              NUMBER(19)           NOT NULL,
    tenant_id       NUMBER(19)           NOT NULL,
    document_id     NUMBER(19)           NOT NULL,
    field_code      VARCHAR2(60 CHAR)    NOT NULL,
    lang            VARCHAR2(5 CHAR),
    value_text      VARCHAR2(2000 CHAR),
    value_date      DATE,
    value_num       NUMBER(18,4),
    group_code      VARCHAR2(40 CHAR),
    group_idx       NUMBER(5),
    source          VARCHAR2(20 CHAR)    NOT NULL,
    confidence      NUMBER(5,4),
    source_scan_id  NUMBER(19),
    source_step_id  NUMBER(19),
    created_at      TIMESTAMP            NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP            NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_document_field PRIMARY KEY (id),
    CONSTRAINT fk_doc_field_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT ck_doc_field_source CHECK (source IN ('CLIENT_OCR', 'SERVER_OCR', 'MRZ', 'MANUAL'))
);
CREATE INDEX ix_doc_field_document ON document_field (document_id);
COMMENT ON COLUMN document_field.source IS 'Where the value came from: the calling app''s OCR, camtech OCR, the passport MRZ or a reviewer';
--rollback DROP TABLE document_field;

--changeset camtech:1.0.0-004-document-media
CREATE TABLE document_media (
    id           NUMBER(19)          NOT NULL,
    tenant_id    NUMBER(19)          NOT NULL,
    document_id  NUMBER(19),
    scan_id      NUMBER(19),
    media_id     NUMBER(19)          NOT NULL,
    role         VARCHAR2(20 CHAR)   NOT NULL,
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_document_media PRIMARY KEY (id),
    CONSTRAINT fk_doc_media_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT fk_doc_media_scan FOREIGN KEY (scan_id) REFERENCES document_scan (id),
    CONSTRAINT fk_doc_media_media FOREIGN KEY (media_id) REFERENCES media_file (id),
    CONSTRAINT ck_doc_media_owner CHECK (document_id IS NOT NULL OR scan_id IS NOT NULL)
);
CREATE INDEX ix_doc_media_document ON document_media (document_id);
CREATE INDEX ix_doc_media_scan ON document_media (scan_id);
--rollback DROP TABLE document_media;
