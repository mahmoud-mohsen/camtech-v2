--liquibase formatted sql

-- Verification journeys. One session per journey, one step row per attempt,
-- one check row per individual check. Nothing is overwritten.

--changeset camtech:1.0.0-006-verification-session
CREATE TABLE verification_session (
    id                 BIGINT          NOT NULL,
    tenant_id          BIGINT          NOT NULL,
    public_id          VARCHAR(36)   NOT NULL,
    flow_code          VARCHAR(50)   NOT NULL,
    party_id           BIGINT,
    parent_session_id  BIGINT,
    client_app_id      BIGINT          NOT NULL,
    device_id          BIGINT,
    channel            VARCHAR(20)   NOT NULL,
    subject_ref        VARCHAR(200),
    token_hash         VARCHAR(64),
    status             VARCHAR(20)   NOT NULL,
    stage              VARCHAR(30)   NOT NULL,
    decision           VARCHAR(20),
    document_type      VARCHAR(30),
    document_id        BIGINT,
    selfie_grayscale   SMALLINT           DEFAULT 0 NOT NULL,
    ip_address         VARCHAR(45),
    user_agent         VARCHAR(500),
    expires_at         TIMESTAMP           NOT NULL,
    completed_at       TIMESTAMP,
    created_at         TIMESTAMP           NOT NULL,
    created_by         VARCHAR(100),
    updated_at         TIMESTAMP           NOT NULL,
    updated_by         VARCHAR(100),
    row_version        INTEGER          DEFAULT 0 NOT NULL,
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
    id              BIGINT          NOT NULL,
    tenant_id       BIGINT          NOT NULL,
    session_id      BIGINT          NOT NULL,
    step_code       VARCHAR(40)   NOT NULL,
    attempt_no      SMALLINT           NOT NULL,
    status          VARCHAR(20)   NOT NULL,
    reason_code     VARCHAR(48),
    reason_message  VARCHAR(500),
    started_at      TIMESTAMP,
    ended_at        TIMESTAMP,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_step PRIMARY KEY (id),
    CONSTRAINT fk_ver_step_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT ck_ver_step_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'REVIEW', 'SKIPPED'))
);
CREATE INDEX ix_ver_step_session ON verification_step (session_id, step_code);
CREATE INDEX ix_ver_step_reason ON verification_step (reason_code, created_at);

CREATE TABLE verification_check (
    id              BIGINT          NOT NULL,
    tenant_id       BIGINT          NOT NULL,
    step_id         BIGINT          NOT NULL,
    check_code      VARCHAR(48)   NOT NULL,
    score           NUMERIC(12,6),
    threshold_used  VARCHAR(50),
    outcome         VARCHAR(10)   NOT NULL,
    details         TEXT,
    created_at      TIMESTAMP           NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP           NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_check PRIMARY KEY (id),
    CONSTRAINT fk_ver_check_step FOREIGN KEY (step_id) REFERENCES verification_step (id),
    CONSTRAINT ck_ver_check_outcome CHECK (outcome IN ('PASS', 'REVIEW', 'FAIL', 'SKIPPED'))
);
CREATE INDEX ix_ver_check_step ON verification_check (step_id);

CREATE TABLE step_media (
    id           BIGINT          NOT NULL,
    tenant_id    BIGINT          NOT NULL,
    step_id      BIGINT          NOT NULL,
    media_id     BIGINT          NOT NULL,
    role         VARCHAR(20)   NOT NULL,
    created_at   TIMESTAMP           NOT NULL,
    created_by   VARCHAR(100),
    updated_at   TIMESTAMP           NOT NULL,
    updated_by   VARCHAR(100),
    row_version  INTEGER          DEFAULT 0 NOT NULL,
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
    id                BIGINT           NOT NULL,
    tenant_id         BIGINT           NOT NULL,
    session_id        BIGINT           NOT NULL,
    decision          VARCHAR(20)    NOT NULL,
    decided_by        VARCHAR(10)    NOT NULL,
    decided_by_user   VARCHAR(100),
    reason            VARCHAR(1000),
    final_similarity  NUMERIC(12,6),
    result_token_jti  VARCHAR(64),
    decided_at        TIMESTAMP            NOT NULL,
    created_at        TIMESTAMP            NOT NULL,
    created_by        VARCHAR(100),
    updated_at        TIMESTAMP            NOT NULL,
    updated_by        VARCHAR(100),
    row_version       INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_verification_decision PRIMARY KEY (id),
    CONSTRAINT fk_ver_decision_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT uk_ver_decision_session UNIQUE (session_id),
    CONSTRAINT ck_ver_decision CHECK (decision IN ('APPROVED', 'REVIEW', 'REJECTED')),
    CONSTRAINT ck_ver_decided_by CHECK (decided_by IN ('SYSTEM', 'USER'))
);
--rollback DROP TABLE verification_decision;

--changeset camtech:1.0.0-006-review
CREATE TABLE review_case (
    id                BIGINT          NOT NULL,
    tenant_id         BIGINT          NOT NULL,
    session_id        BIGINT          NOT NULL,
    status            VARCHAR(20)   NOT NULL,
    reason            VARCHAR(200)  NOT NULL,
    final_similarity  NUMERIC(12,6),
    assigned_to       VARCHAR(100),
    decided_at        TIMESTAMP,
    created_at        TIMESTAMP           NOT NULL,
    created_by        VARCHAR(100),
    updated_at        TIMESTAMP           NOT NULL,
    updated_by        VARCHAR(100),
    row_version       INTEGER          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_review_case PRIMARY KEY (id),
    CONSTRAINT fk_review_case_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT uk_review_case_session UNIQUE (session_id),
    CONSTRAINT ck_review_case_status CHECK (status IN ('OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED'))
);
CREATE INDEX ix_review_case_status ON review_case (status, created_at);

CREATE TABLE review_action (
    id              BIGINT           NOT NULL,
    tenant_id       BIGINT           NOT NULL,
    review_case_id  BIGINT           NOT NULL,
    action          VARCHAR(20)    NOT NULL,
    actor           VARCHAR(100)   NOT NULL,
    note            VARCHAR(2000),
    created_at      TIMESTAMP            NOT NULL,
    created_by      VARCHAR(100),
    updated_at      TIMESTAMP            NOT NULL,
    updated_by      VARCHAR(100),
    row_version     INTEGER           DEFAULT 0 NOT NULL,
    CONSTRAINT pk_review_action PRIMARY KEY (id),
    CONSTRAINT fk_review_action_case FOREIGN KEY (review_case_id) REFERENCES review_case (id),
    CONSTRAINT ck_review_action CHECK (action IN ('OPENED', 'ASSIGNED', 'COMMENTED', 'APPROVED', 'REJECTED'))
);
CREATE INDEX ix_review_action_case ON review_action (review_case_id);
--rollback DROP TABLE review_action;
--rollback DROP TABLE review_case;
