--liquibase formatted sql

-- Document scans whose extracted values fail a check (bad check digit, front and back disagree, expired card,
-- low confidence) wait for a person: NEEDS_REVIEW, then COMPLETED or REJECTED. Each field keeps where it was read
-- and, after review, the value the reviewer confirmed; the OCR value stays in raw_value so corrections can be measured.

--changeset camtech:1.3.0-001-scan-review-status
ALTER TABLE document_scan DROP CONSTRAINT ck_doc_scan_status;
ALTER TABLE document_scan ADD CONSTRAINT ck_doc_scan_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'REJECTED', 'FAILED'));
--rollback ALTER TABLE document_scan DROP CONSTRAINT ck_doc_scan_status;
--rollback ALTER TABLE document_scan ADD CONSTRAINT ck_doc_scan_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));

--changeset camtech:1.3.0-001-scan-review-columns
ALTER TABLE document_scan ADD COLUMN issues VARCHAR(500);
ALTER TABLE document_scan ADD COLUMN review_reasons VARCHAR(4000);
ALTER TABLE document_scan ADD COLUMN reviewed_by VARCHAR(100);
ALTER TABLE document_scan ADD COLUMN reviewed_at TIMESTAMP;
ALTER TABLE document_scan ADD COLUMN review_note VARCHAR(1000);
ALTER TABLE scan_field_result ADD COLUMN extraction_source VARCHAR(30);
ALTER TABLE scan_field_result ADD COLUMN reviewed_value TEXT;
CREATE INDEX ix_doc_scan_status ON document_scan (tenant_id, status);
--rollback DROP INDEX ix_doc_scan_status;
--rollback ALTER TABLE scan_field_result DROP COLUMN reviewed_value;
--rollback ALTER TABLE scan_field_result DROP COLUMN extraction_source;
--rollback ALTER TABLE document_scan DROP COLUMN review_note;
--rollback ALTER TABLE document_scan DROP COLUMN reviewed_at;
--rollback ALTER TABLE document_scan DROP COLUMN reviewed_by;
--rollback ALTER TABLE document_scan DROP COLUMN review_reasons;
--rollback ALTER TABLE document_scan DROP COLUMN issues;
