--liquibase formatted sql

-- The liveness mode a verification ran with (its last liveness attempt): PASSIVE or ACTIVE.

--changeset camtech:1.2.0-002-session-liveness-mode
ALTER TABLE verification_session ADD liveness_mode VARCHAR2(10 CHAR);
ALTER TABLE verification_session ADD CONSTRAINT ck_ver_session_liveness_mode CHECK (liveness_mode IN ('PASSIVE', 'ACTIVE'));
--rollback ALTER TABLE verification_session DROP CONSTRAINT ck_ver_session_liveness_mode;
--rollback ALTER TABLE verification_session DROP COLUMN liveness_mode;
