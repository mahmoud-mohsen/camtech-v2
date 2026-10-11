--liquibase formatted sql

-- Stored images and identity documents. One model for every document type:
-- common columns on identity_document, type-specific values in document_field.

--changeset camtech:1.0.0-004-media-file
CREATE TABLE media_file (
    id             BIGINT           NOT NULL,
    tenant_id      BIGINT           NOT NULL,
    sha256         VARCHAR(64)    NOT NULL,
    mime_type      VARCHAR(100)   NOT NULL,
    byte_count     BIGINT           NOT NULL,
    width          INTEGER,
    height         INTEGER,
    storage_uri    VARCHAR(1000)  NOT NULL,
    data_category  VARCHAR(40)    NOT NULL,
    purge_after    TIMESTAMP,
    purged_at      TIMESTAMP,
    created_at     TIMESTAMP            NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP            NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_media_file PRIMARY KEY (id),
    CONSTRAINT ck_media_category CHECK (data_category IN ('FAILED_ATTEMPT_MEDIA', 'VERIFIED_MEDIA', 'SCAN_ONLY_MEDIA'))
);
CREATE INDEX ix_media_sha256 ON media_file (sha256);
CREATE INDEX ix_media_purge ON media_file (purge_after, purged_at);
--rollback DROP TABLE media_file;

--changeset camtech:1.0.0-004-identity-document
CREATE TABLE identity_document (
    id               BIGINT          NOT NULL,
    tenant_id        BIGINT          NOT NULL,
    public_id        VARCHAR(36)   NOT NULL,
    party_id         BIGINT,
    doc_type_id      BIGINT          NOT NULL,
    issuer_id        BIGINT,
    document_number  VARCHAR(100)  NOT NULL,
    issuing_country  VARCHAR(3),
    issue_date       DATE,
    expiry_date      DATE,
    status           VARCHAR(20)   NOT NULL,
    created_at       TIMESTAMP           NOT NULL,
    created_by       VARCHAR(100),
    updated_at       TIMESTAMP           NOT NULL,
    updated_by       VARCHAR(100),
    row_version      INTEGER          DEFAULT 0 NOT NULL,
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
    id                    BIGINT           NOT NULL,
    tenant_id             BIGINT           NOT NULL,
    public_id             VARCHAR(36)    NOT NULL,
    document_id           BIGINT,
    session_id            BIGINT,
    client_app_id         BIGINT,
    doc_type_code         VARCHAR(30)    NOT NULL,
    trade_licence_format  VARCHAR(60),
    subject_ref           VARCHAR(200),
    status                VARCHAR(20)    NOT NULL,
    confidence            NUMERIC(5,4),
    processing_ms         INTEGER,
    raw_text              TEXT,
    error_message         VARCHAR(1000),
    ip_address            VARCHAR(45),
    user_agent            VARCHAR(500),
    created_at            TIMESTAMP            NOT NULL,
    created_by            VARCHAR(100),
    updated_at            TIMESTAMP            NOT NULL,
    updated_by            VARCHAR(100),
    row_version           INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_document_scan PRIMARY KEY (id),
    CONSTRAINT fk_doc_scan_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT uk_doc_scan_public_id UNIQUE (public_id),
    CONSTRAINT ck_doc_scan_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
);
CREATE INDEX ix_doc_scan_document ON document_scan (document_id);
CREATE INDEX ix_doc_scan_subject ON document_scan (tenant_id, subject_ref);
CREATE INDEX ix_doc_scan_created ON document_scan (created_at);

CREATE TABLE scan_field_result (
    id                  BIGINT           NOT NULL,
    tenant_id           BIGINT           NOT NULL,
    scan_id             BIGINT           NOT NULL,
    field_code          VARCHAR(100)   NOT NULL,
    lang                VARCHAR(5),
    raw_value           TEXT,
    confidence          NUMERIC(5,4),
    validation_status   VARCHAR(20),
    validation_message  VARCHAR(500),
    created_at          TIMESTAMP            NOT NULL,
    created_by          VARCHAR(100),
    updated_at          TIMESTAMP            NOT NULL,
    updated_by          VARCHAR(100),
    row_version         INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_scan_field_result PRIMARY KEY (id),
    CONSTRAINT fk_scan_field_scan FOREIGN KEY (scan_id) REFERENCES document_scan (id)
);
CREATE INDEX ix_scan_field_scan ON scan_field_result (scan_id);

CREATE TABLE ocr_call (
    id             BIGINT           NOT NULL,
    tenant_id      BIGINT           NOT NULL,
    scan_id        BIGINT           NOT NULL,
    provider       VARCHAR(50)    NOT NULL,
    status         VARCHAR(20)    NOT NULL,
    duration_ms    INTEGER,
    error_message  VARCHAR(2000),
    created_at     TIMESTAMP            NOT NULL,
    created_by     VARCHAR(100),
    updated_at     TIMESTAMP            NOT NULL,
    updated_by     VARCHAR(100),
    row_version    INTEGER           DEFAULT 0 NOT NULL,
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
    id              BIGINT           NOT NULL,
    tenant_id       BIGINT           NOT NULL,
    document_id     BIGINT           NOT NULL,
    field_code      VARCHAR(60)    NOT NULL,
    lang            VARCHAR(5),
    value_text      VARCHAR(2000),
    value_date      DATE,
    value_num       NUMERIC(18,4),
    group_code      VARCHAR(40),
    group_idx       INTEGER,
    source          VARCHAR(20)    NOT NULL,
    confidence      NUMERIC(5,4),
    source_scan_id  BIGINT,
    source_step_id  BIGINT,
    created_at      TIMESTAMP            NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP            NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_document_field PRIMARY KEY (id),
    CONSTRAINT fk_doc_field_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT ck_doc_field_source CHECK (source IN ('CLIENT_OCR', 'SERVER_OCR', 'MRZ', 'MANUAL'))
);
CREATE INDEX ix_doc_field_document ON document_field (document_id);
COMMENT ON COLUMN document_field.source IS 'Where the value came from: the calling app''s OCR, camtech OCR, the passport MRZ or a reviewer';
--rollback DROP TABLE document_field;

--changeset camtech:1.0.0-004-document-media
CREATE TABLE document_media (
    id           BIGINT          NOT NULL,
    tenant_id    BIGINT          NOT NULL,
    document_id  BIGINT,
    scan_id      BIGINT,
    media_id     BIGINT          NOT NULL,
    role         VARCHAR(20)   NOT NULL,
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_document_media PRIMARY KEY (id),
    CONSTRAINT fk_doc_media_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT fk_doc_media_scan FOREIGN KEY (scan_id) REFERENCES document_scan (id),
    CONSTRAINT fk_doc_media_media FOREIGN KEY (media_id) REFERENCES media_file (id),
    CONSTRAINT ck_doc_media_owner CHECK (document_id IS NOT NULL OR scan_id IS NOT NULL)
);
CREATE INDEX ix_doc_media_document ON document_media (document_id);
CREATE INDEX ix_doc_media_scan ON document_media (scan_id);
--rollback DROP TABLE document_media;
