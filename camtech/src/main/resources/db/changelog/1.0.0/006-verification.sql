--liquibase formatted sql

-- Verification journeys. One session per journey, one step row per attempt,
-- one check row per individual check. Nothing is overwritten.

--changeset camtech:1.0.0-006-verification-session
CREATE TABLE verification_session (
    id                 NUMBER(19)          NOT NULL,
    tenant_id          NUMBER(19)          NOT NULL,
    public_id          VARCHAR2(36 CHAR)   NOT NULL,
    flow_code          VARCHAR2(50 CHAR)   NOT NULL,
    party_id           NUMBER(19),
    parent_session_id  NUMBER(19),
    client_app_id      NUMBER(19)          NOT NULL,
    device_id          NUMBER(19),
    channel            VARCHAR2(20 CHAR)   NOT NULL,
    subject_ref        VARCHAR2(200 CHAR),
    token_hash         VARCHAR2(64 CHAR),
    status             VARCHAR2(20 CHAR)   NOT NULL,
    stage              VARCHAR2(30 CHAR)   NOT NULL,
    decision           VARCHAR2(20 CHAR),
    document_type      VARCHAR2(30 CHAR),
    document_id        NUMBER(19),
    selfie_grayscale   NUMBER(1)           DEFAULT 0 NOT NULL,
    ip_address         VARCHAR2(45 CHAR),
    user_agent         VARCHAR2(500 CHAR),
    expires_at         TIMESTAMP           NOT NULL,
    completed_at       TIMESTAMP,
    created_at         TIMESTAMP           NOT NULL,
    created_by         VARCHAR2(100 CHAR),
    updated_at         TIMESTAMP           NOT NULL,
    updated_by         VARCHAR2(100 CHAR),
    row_version        NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_session PRIMARY KEY (id),
    CONSTRAINT fk_ver_session_party FOREIGN KEY (party_id) REFERENCES party (id),
    CONSTRAINT fk_ver_session_parent FOREIGN KEY (parent_session_id) REFERENCES verification_session (id),
    CONSTRAINT fk_ver_session_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT fk_ver_session_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT fk_ver_session_document FOREIGN KEY (document_id) REFERENCES identity_document (id),
    CONSTRAINT uk_ver_session_public_id UNIQUE (public_id),
    CONSTRAINT ck_ver_session_status CHECK (status IN ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED')),
    CONSTRAINT ck_ver_session_decision CHECK (decision IS NULL OR decision IN ('APPROVED', 'REVIEW', 'REJECTED'))
);
CREATE INDEX ix_ver_session_created ON verification_session (tenant_id, created_at);
CREATE INDEX ix_ver_session_party ON verification_session (party_id);
CREATE INDEX ix_ver_session_status ON verification_session (status, expires_at);
CREATE INDEX ix_ver_session_subject ON verification_session (tenant_id, subject_ref);
COMMENT ON COLUMN verification_session.stage IS 'Fine-grained flow position, e.g. LIVENESS_PASSED; drives the legacy Face Tech status';
--rollback DROP TABLE verification_session;

--changeset camtech:1.0.0-006-verification-step
CREATE TABLE verification_step (
    id              NUMBER(19)          NOT NULL,
    tenant_id       NUMBER(19)          NOT NULL,
    session_id      NUMBER(19)          NOT NULL,
    step_code       VARCHAR2(40 CHAR)   NOT NULL,
    attempt_no      NUMBER(3)           NOT NULL,
    status          VARCHAR2(20 CHAR)   NOT NULL,
    reason_code     VARCHAR2(48 CHAR),
    reason_message  VARCHAR2(500 CHAR),
    started_at      TIMESTAMP,
    ended_at        TIMESTAMP,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_step PRIMARY KEY (id),
    CONSTRAINT fk_ver_step_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT ck_ver_step_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'REVIEW', 'SKIPPED'))
);
CREATE INDEX ix_ver_step_session ON verification_step (session_id, step_code);
CREATE INDEX ix_ver_step_reason ON verification_step (reason_code, created_at);

CREATE TABLE verification_check (
    id              NUMBER(19)          NOT NULL,
    tenant_id       NUMBER(19)          NOT NULL,
    step_id         NUMBER(19)          NOT NULL,
    check_code      VARCHAR2(48 CHAR)   NOT NULL,
    score           NUMBER(12,6),
    threshold_used  VARCHAR2(50 CHAR),
    outcome         VARCHAR2(10 CHAR)   NOT NULL,
    details         CLOB,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_check PRIMARY KEY (id),
    CONSTRAINT fk_ver_check_step FOREIGN KEY (step_id) REFERENCES verification_step (id),
    CONSTRAINT ck_ver_check_outcome CHECK (outcome IN ('PASS', 'REVIEW', 'FAIL', 'SKIPPED'))
);
CREATE INDEX ix_ver_check_step ON verification_check (step_id);

CREATE TABLE step_media (
    id           NUMBER(19)          NOT NULL,
    tenant_id    NUMBER(19)          NOT NULL,
    step_id      NUMBER(19)          NOT NULL,
    media_id     NUMBER(19)          NOT NULL,
    role         VARCHAR2(20 CHAR)   NOT NULL,
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR2(100 CHAR),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR2(100 CHAR),
    row_version  NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_step_media PRIMARY KEY (id),
    CONSTRAINT fk_step_media_step FOREIGN KEY (step_id) REFERENCES verification_step (id),
    CONSTRAINT fk_step_media_media FOREIGN KEY (media_id) REFERENCES media_file (id)
);
CREATE INDEX ix_step_media_step ON step_media (step_id);
--rollback DROP TABLE step_media;
--rollback DROP TABLE verification_check;
--rollback DROP TABLE verification_step;

--changeset camtech:1.0.0-006-verification-decision
CREATE TABLE verification_decision (
    id                NUMBER(19)           NOT NULL,
    tenant_id         NUMBER(19)           NOT NULL,
    session_id        NUMBER(19)           NOT NULL,
    decision          VARCHAR2(20 CHAR)    NOT NULL,
    decided_by        VARCHAR2(10 CHAR)    NOT NULL,
    decided_by_user   VARCHAR2(100 CHAR),
    reason            VARCHAR2(1000 CHAR),
    final_similarity  NUMBER(12,6),
    result_token_jti  VARCHAR2(64 CHAR),
    decided_at        TIMESTAMP            NOT NULL,
    created_at        TIMESTAMP            NOT NULL,
    created_by        VARCHAR2(100 CHAR),
    updated_at        TIMESTAMP            NOT NULL,
    updated_by        VARCHAR2(100 CHAR),
    row_version       NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_decision PRIMARY KEY (id),
    CONSTRAINT fk_ver_decision_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT uk_ver_decision_session UNIQUE (session_id),
    CONSTRAINT ck_ver_decision CHECK (decision IN ('APPROVED', 'REVIEW', 'REJECTED')),
    CONSTRAINT ck_ver_decided_by CHECK (decided_by IN ('SYSTEM', 'USER'))
);
--rollback DROP TABLE verification_decision;

--changeset camtech:1.0.0-006-review
CREATE TABLE review_case (
    id                NUMBER(19)          NOT NULL,
    tenant_id         NUMBER(19)          NOT NULL,
    session_id        NUMBER(19)          NOT NULL,
    status            VARCHAR2(20 CHAR)   NOT NULL,
    reason            VARCHAR2(200 CHAR)  NOT NULL,
    final_similarity  NUMBER(12,6),
    assigned_to       VARCHAR2(100 CHAR),
    decided_at        TIMESTAMP,
    created_at        TIMESTAMP           NOT NULL,
    created_by        VARCHAR2(100 CHAR),
    updated_at        TIMESTAMP           NOT NULL,
    updated_by        VARCHAR2(100 CHAR),
    row_version       NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_review_case PRIMARY KEY (id),
    CONSTRAINT fk_review_case_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT uk_review_case_session UNIQUE (session_id),
    CONSTRAINT ck_review_case_status CHECK (status IN ('OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED'))
);
CREATE INDEX ix_review_case_status ON review_case (status, created_at);

CREATE TABLE review_action (
    id              NUMBER(19)           NOT NULL,
    tenant_id       NUMBER(19)           NOT NULL,
    review_case_id  NUMBER(19)           NOT NULL,
    action          VARCHAR2(20 CHAR)    NOT NULL,
    actor           VARCHAR2(100 CHAR)   NOT NULL,
    note            VARCHAR2(2000 CHAR),
    created_at      TIMESTAMP            NOT NULL,
    created_by      VARCHAR2(100 CHAR),
    updated_at      TIMESTAMP            NOT NULL,
    updated_by      VARCHAR2(100 CHAR),
    row_version     NUMBER(10)           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_review_action PRIMARY KEY (id),
    CONSTRAINT fk_review_action_case FOREIGN KEY (review_case_id) REFERENCES review_case (id),
    CONSTRAINT ck_review_action CHECK (action IN ('OPENED', 'ASSIGNED', 'COMMENTED', 'APPROVED', 'REJECTED'))
);
CREATE INDEX ix_review_action_case ON review_action (review_case_id);
--rollback DROP TABLE review_action;
--rollback DROP TABLE review_case;
