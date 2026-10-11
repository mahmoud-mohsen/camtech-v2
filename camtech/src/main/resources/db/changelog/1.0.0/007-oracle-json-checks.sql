--liquibase formatted sql

-- JSON validity checks use Oracle's IS JSON condition (12c+), so they only run on Oracle.

--changeset camtech:1.0.0-007-json-checks dbms:oracle
ALTER TABLE audit_event ADD CONSTRAINT ck_audit_details_json CHECK (details IS JSON);
ALTER TABLE outbox_event ADD CONSTRAINT ck_outbox_payload_json CHECK (payload IS JSON);
ALTER TABLE verification_check ADD CONSTRAINT ck_ver_check_details_json CHECK (details IS JSON);
--rollback ALTER TABLE verification_check DROP CONSTRAINT ck_ver_check_details_json;
--rollback ALTER TABLE outbox_event DROP CONSTRAINT ck_outbox_payload_json;
--rollback ALTER TABLE audit_event DROP CONSTRAINT ck_audit_details_json;
