--liquibase formatted sql

-- Changes made from the tenant portal are audited with actor_type TENANT.

--changeset camtech:1.1.0-002-audit-tenant-actor
ALTER TABLE audit_event DROP CONSTRAINT ck_audit_actor_type;
ALTER TABLE audit_event ADD CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('CLIENT', 'ADMIN', 'SYSTEM', 'TENANT'));
--rollback DELETE FROM audit_event WHERE actor_type = 'TENANT';
--rollback ALTER TABLE audit_event DROP CONSTRAINT ck_audit_actor_type;
--rollback ALTER TABLE audit_event ADD CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('CLIENT', 'ADMIN', 'SYSTEM'));
