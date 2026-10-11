--liquibase formatted sql

--changeset camtech:1.0.0-005-face-template
CREATE TABLE face_template (
    id               NUMBER(19)          NOT NULL,
    tenant_id        NUMBER(19)          NOT NULL,
    party_id         NUMBER(19),
    session_id       NUMBER(19),
    source_media_id  NUMBER(19),
    role             VARCHAR2(20 CHAR)   NOT NULL,
    pose             VARCHAR2(20 CHAR),
    model_version    VARCHAR2(64 CHAR)   NOT NULL,
    dimension        NUMBER(5)           NOT NULL,
    vector           BLOB                NOT NULL,
    quality_score    NUMBER(8,6),
    status           VARCHAR2(20 CHAR)   NOT NULL,
    created_at       TIMESTAMP           NOT NULL,
    created_by       VARCHAR2(100 CHAR),
    updated_at       TIMESTAMP           NOT NULL,
    updated_by       VARCHAR2(100 CHAR),
    row_version      NUMBER(10)          DEFAULT 0 NOT NULL,
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
