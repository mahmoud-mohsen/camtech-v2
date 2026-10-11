--liquibase formatted sql

-- The NOQODI tenant: every flow, document type and feature enabled, no daily quota (NULL = unlimited).

--changeset camtech:1.0.0-101-tenant
INSERT INTO tenant (id, code, name, status, created_at, updated_at) VALUES (1, 'NOQODI', 'Noqodi', 'ACTIVE', ${now}, ${now});
--rollback DELETE FROM tenant WHERE id = 1;

--changeset camtech:1.0.0-101-client-app
INSERT INTO client_app (id, tenant_id, code, name, channel, platform, app_identifier, allowed_origins, status, created_at, updated_at) VALUES (10, 1, 'MOBILE_APP', 'Mobile app (iOS and Android)', 'MOBILE', NULL, NULL, NULL, 'ACTIVE', ${now}, ${now});
INSERT INTO client_app (id, tenant_id, code, name, channel, platform, app_identifier, allowed_origins, status, created_at, updated_at) VALUES (11, 1, 'WEB_APP', 'Web app', 'WEB', 'BROWSER', NULL, NULL, 'ACTIVE', ${now}, ${now});
INSERT INTO client_app (id, tenant_id, code, name, channel, platform, app_identifier, allowed_origins, status, created_at, updated_at) VALUES (12, 1, 'BACKOFFICE', 'Back-office', 'ADMIN', 'BROWSER', NULL, NULL, 'ACTIVE', ${now}, ${now});
--rollback DELETE FROM client_app WHERE id < 1000;

--changeset camtech:1.0.0-101-entitlement
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (1, 1, 'FLOW', 'SELFIE_ID_VERIFICATION', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (2, 1, 'FLOW', 'FACE_AUTHENTICATION', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (3, 1, 'FLOW', 'ONBOARDING', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (4, 1, 'FLOW', 'DOCUMENT_SCAN', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (5, 1, 'FLOW', 'FACE_IDENTIFICATION', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (10, 1, 'DOCUMENT', 'EMIRATES_ID', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (11, 1, 'DOCUMENT', 'PASSPORT', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (12, 1, 'DOCUMENT', 'TRADE_LICENCE', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (20, 1, 'FEATURE', 'DEDUP_SEARCH', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (21, 1, 'FEATURE', 'MANUAL_REVIEW', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (22, 1, 'FEATURE', 'WEBHOOKS', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (23, 1, 'FEATURE', 'FACE_COMPARE', 1, NULL, NULL, ${now}, ${now});
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) VALUES (24, 1, 'FEATURE', 'SERVER_OCR', 1, NULL, NULL, ${now}, ${now});
--rollback DELETE FROM tenant_entitlement WHERE id < 1000;

--changeset camtech:1.0.0-101-config-param
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (1, 1, 'session.ttl_minutes', '15', 'Minutes a verification stays open', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (2, 1, 'face.doc_match_similarity', '0.40', 'Selfie vs document photo: cosine similarity at or above this is a match', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (3, 1, 'face.review_similarity', '0.28', 'Selfie vs document photo: at or above this (and below the match value) needs a review', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (4, 1, 'face.excellent_similarity', '0.70', 'Similarity that maps to the top of the 0-100 score', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (5, 1, 'face.template_match_similarity', '0.50', 'Face authentication: selfie vs enrolled face, at or above this is a match', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (6, 1, 'liveness.min_same_person_similarity', '0.5', 'Normal vs closer selfie must be at least this similar', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (7, 1, 'liveness.min_closer_area_gain', '1.1', 'The face must grow by at least this factor (area) in the closer selfie', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (8, 1, 'liveness.min_device_antispoof', '0.3', 'Minimum anti-spoof score reported by the device (0-1)', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (9, 1, 'liveness.keep_failed_media', 'true', 'Keep the selfies of failed liveness attempts for audit and fraud analysis', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (10, 1, 'dedup.enabled', 'true', 'Search the new face against every other enrolled person after a match', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (11, 1, 'dedup.similarity', '0.55', 'Selfie vs another person''s enrolled selfie: at or above this is flagged as a duplicate identity', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (12, 1, 'document.file_upload_allowed', 'true', 'Whether the app may let the user upload a document photo from the gallery instead of the camera', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, param_key, param_value, description, created_at, updated_at) VALUES (13, 1, 'face.legacy_distance_threshold', '0.95', 'Legacy /face/verify and /face/identify: Euclidean distance at or below this is a match', ${now}, ${now});
INSERT INTO config_param (id, tenant_id, channel, param_key, param_value, description, created_at, updated_at) VALUES (14, 1, 'WEB', 'document.file_upload_allowed', 'false', 'Web: camera capture only', ${now}, ${now});
--rollback DELETE FROM config_param WHERE id < 1000;

--changeset camtech:1.0.0-101-retention-policy
INSERT INTO retention_policy (id, tenant_id, data_category, retention_days, description, created_at, updated_at) VALUES (1, 1, 'FAILED_ATTEMPT_MEDIA', 30, 'Selfies and document images from failed attempts', ${now}, ${now});
INSERT INTO retention_policy (id, tenant_id, data_category, retention_days, description, created_at, updated_at) VALUES (2, 1, 'VERIFIED_MEDIA', 365, 'Images used in a decision (selfies, document photos)', ${now}, ${now});
INSERT INTO retention_policy (id, tenant_id, data_category, retention_days, description, created_at, updated_at) VALUES (3, 1, 'SCAN_ONLY_MEDIA', 7, 'Images from OCR-only document scans', ${now}, ${now});
INSERT INTO retention_policy (id, tenant_id, data_category, retention_days, description, created_at, updated_at) VALUES (4, 1, 'AUDIT_EVENTS', 730, 'Audit log entries', ${now}, ${now});
--rollback DELETE FROM retention_policy WHERE id < 1000;
