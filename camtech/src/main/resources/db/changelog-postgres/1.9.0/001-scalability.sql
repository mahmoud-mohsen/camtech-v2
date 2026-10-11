--liquibase formatted sql

-- Scheduled jobs (session expiry, webhook relay, retention, document expiry) take a lock row here so only one
-- replica runs each job at a time (ShedLock, JdbcTemplateLockProvider with database time).
--changeset camtech:1.9.0-001-shedlock
CREATE TABLE shedlock (
    name        VARCHAR(64)   NOT NULL,
    lock_until  TIMESTAMP(3)        NOT NULL,
    locked_at   TIMESTAMP(3)        NOT NULL,
    locked_by   VARCHAR(255)  NOT NULL,
    CONSTRAINT pk_shedlock PRIMARY KEY (name)
);
--rollback DROP TABLE shedlock;

-- Indexes for the per-tenant queries that otherwise scan growing tables: the 1:N face gallery, audit history of
-- a record, audit retention, the review queue and the operations dashboard.
--changeset camtech:1.9.0-001-indexes
CREATE INDEX ix_face_tpl_tenant_enrolled ON face_template (tenant_id, status, role);
CREATE INDEX ix_audit_event_tenant_entity ON audit_event (tenant_id, entity_id);
CREATE INDEX ix_audit_event_tenant_at ON audit_event (tenant_id, occurred_at);
CREATE INDEX ix_review_case_tenant ON review_case (tenant_id, status, created_at);
CREATE INDEX ix_ver_step_tenant ON verification_step (tenant_id, status, created_at);
CREATE INDEX ix_ver_check_tenant ON verification_check (tenant_id, check_code, outcome, created_at);
--rollback DROP INDEX ix_ver_check_tenant;
--rollback DROP INDEX ix_ver_step_tenant;
--rollback DROP INDEX ix_review_case_tenant;
--rollback DROP INDEX ix_audit_event_tenant_at;
--rollback DROP INDEX ix_audit_event_tenant_entity;
--rollback DROP INDEX ix_face_tpl_tenant_enrolled;
