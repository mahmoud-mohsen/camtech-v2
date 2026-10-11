--liquibase formatted sql

-- PostgreSQL only. Before CamtechPostgreSQLDialect, Hibernate wrote the @Lob text columns as large objects and
-- stored the object id in the column. Put the content back in the column and remove the large objects.
-- face_template.vector (BYTEA) never held an id: those inserts failed.

--changeset camtech:1.5.0-001-inline-lobs dbms:postgresql
UPDATE audit_event SET details = convert_from(lo_get(details::oid), 'UTF8') WHERE details IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE outbox_event SET payload = convert_from(lo_get(payload::oid), 'UTF8') WHERE payload IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE verification_check SET details = convert_from(lo_get(details::oid), 'UTF8') WHERE details IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE document_scan SET raw_text = convert_from(lo_get(raw_text::oid), 'UTF8') WHERE raw_text IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE scan_field_result SET raw_value = convert_from(lo_get(raw_value::oid), 'UTF8') WHERE raw_value IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE scan_field_result SET reviewed_value = convert_from(lo_get(reviewed_value::oid), 'UTF8') WHERE reviewed_value IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE tenant_branding SET logo_data_url = convert_from(lo_get(logo_data_url::oid), 'UTF8') WHERE logo_data_url IN (SELECT oid::text FROM pg_largeobject_metadata);
UPDATE tenant_branding SET texts = convert_from(lo_get(texts::oid), 'UTF8') WHERE texts IN (SELECT oid::text FROM pg_largeobject_metadata);
SELECT lo_unlink(oid) FROM pg_largeobject_metadata;
--rollback SELECT 1;
