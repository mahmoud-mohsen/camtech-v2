--liquibase formatted sql

--changeset camtech:1.0.0-005-face-template
CREATE TABLE face_template (
    id               BIGINT          NOT NULL,
    tenant_id        BIGINT          NOT NULL,
    party_id         BIGINT,
    session_id       BIGINT,
    source_media_id  BIGINT,
    role             VARCHAR(20)   NOT NULL,
    pose             VARCHAR(20),
    model_version    VARCHAR(64)   NOT NULL,
    dimension        INTEGER           NOT NULL,
    vector           BYTEA                NOT NULL,
    quality_score    NUMERIC(8,6),
    status           VARCHAR(20)   NOT NULL,
    created_at       TIMESTAMP           NOT NULL,
    created_by       VARCHAR(100),
    updated_at       TIMESTAMP           NOT NULL,
    updated_by       VARCHAR(100),
    row_version      INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_face_template PRIMARY KEY (id),
    CONSTRAINT fk_face_tpl_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT fk_face_tpl_media FOREIGN KEY (source_media_id) REFERENCES media_file (id),
    CONSTRAINT ck_face_tpl_role CHECK (role IN ('SELFIE', 'DOCUMENT')),
    CONSTRAINT ck_face_tpl_status CHECK (status IN ('SESSION', 'ENROLLED', 'REVOKED'))
);
CREATE INDEX ix_face_tpl_party ON face_template (party_id, status);
CREATE INDEX ix_face_tpl_session ON face_template (session_id);
CREATE INDEX ix_face_tpl_enrolled ON face_template (status, role, model_version);
COMMENT ON COLUMN face_template.vector IS 'Embedding as little-endian float32 values (dimension x 4 bytes)';
COMMENT ON COLUMN face_template.status IS 'SESSION = usable only inside its session; ENROLLED = reusable for re-verification and 1:N search';
--rollback DROP TABLE face_template;
