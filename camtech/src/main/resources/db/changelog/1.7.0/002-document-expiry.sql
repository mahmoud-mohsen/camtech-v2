--liquibase formatted sql

-- DOCUMENT_EXPIRING webhook: sent once per document when it enters the tenant's warning period
-- (document.expiry_warning_days before expiry). expiry_notified_at records that it was sent.

--changeset camtech:1.7.0-002-document-expiry-notified
ALTER TABLE identity_document ADD expiry_notified_at TIMESTAMP;
--rollback ALTER TABLE identity_document DROP COLUMN expiry_notified_at;
