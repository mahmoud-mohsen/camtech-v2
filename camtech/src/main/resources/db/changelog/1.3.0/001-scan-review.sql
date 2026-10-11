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
ALTER TABLE document_scan ADD issues VARCHAR2(500 CHAR);
ALTER TABLE document_scan ADD review_reasons VARCHAR2(4000 CHAR);
ALTER TABLE document_scan ADD reviewed_by VARCHAR2(100 CHAR);
ALTER TABLE document_scan ADD reviewed_at TIMESTAMP;
ALTER TABLE document_scan ADD review_note VARCHAR2(1000 CHAR);
ALTER TABLE scan_field_result ADD extraction_source VARCHAR2(30 CHAR);
ALTER TABLE scan_field_result ADD reviewed_value CLOB;
CREATE INDEX ix_doc_scan_status ON document_scan (tenant_id, status);
--rollback DROP INDEX ix_doc_scan_status;
--rollback ALTER TABLE scan_field_result DROP COLUMN reviewed_value;
--rollback ALTER TABLE scan_field_result DROP COLUMN extraction_source;
--rollback ALTER TABLE document_scan DROP COLUMN review_note;
--rollback ALTER TABLE document_scan DROP COLUMN reviewed_at;
--rollback ALTER TABLE document_scan DROP COLUMN reviewed_by;
--rollback ALTER TABLE document_scan DROP COLUMN review_reasons;
--rollback ALTER TABLE document_scan DROP COLUMN issues;
