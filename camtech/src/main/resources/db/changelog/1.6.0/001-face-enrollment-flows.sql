--liquibase formatted sql

-- Two new flows and a face-registration choice on the selfie ID verification:
--   LIVENESS_CHECK   selfie liveness only (no document, nothing enrolled)
--   FACE_ENROLLMENT  selfie liveness, then the face is registered for the subjectRef (no document)
--   SELFIE_ID_VERIFICATION + enroll_face  registers the face only when asked for and allowed
-- The FACE_ENROLLMENT entitlement is what allows a tenant to register faces, standalone or as part of an
-- ID verification. Tenants that have SELFIE_ID_VERIFICATION get it enabled, so they keep today's behaviour
-- (every approved verification registers the face, which face authentication relies on).

--changeset camtech:1.6.0-001-flow-defs
INSERT INTO ref_flow_def (id, code, name, description, created_at, updated_at) VALUES (4, 'LIVENESS_CHECK', 'Selfie verification', 'Liveness selfies only: proves a real person is in front of the camera. No document, no face registered.', ${now}, ${now});
INSERT INTO ref_flow_def (id, code, name, description, created_at, updated_at) VALUES (5, 'FACE_ENROLLMENT', 'Face registration', 'Liveness selfies, then the face is registered for the user (no document). Face authentication can then recognise the user.', ${now}, ${now});
INSERT INTO ref_flow_step_def (id, flow_id, seq, step_code, mandatory, max_attempts, created_at, updated_at) VALUES (8, 4, 1, 'LIVENESS', 1, 1, ${now}, ${now});
INSERT INTO ref_flow_step_def (id, flow_id, seq, step_code, mandatory, max_attempts, created_at, updated_at) VALUES (9, 5, 1, 'LIVENESS', 1, 1, ${now}, ${now});
INSERT INTO ref_flow_step_def (id, flow_id, seq, step_code, mandatory, max_attempts, created_at, updated_at) VALUES (10, 5, 2, 'DEDUP_SEARCH', 0, 1, ${now}, ${now});
--rollback DELETE FROM ref_flow_step_def WHERE id IN (8, 9, 10);
--rollback DELETE FROM ref_flow_def WHERE id IN (4, 5);

--changeset camtech:1.6.0-001-entitlements
-- Selfie verification starts disabled; face registration follows SELFIE_ID_VERIFICATION (see above).
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) SELECT ${nextId}, t.id, 'FLOW', 'LIVENESS_CHECK', 0, NULL, NULL, ${now}, ${now} FROM tenant t WHERE NOT EXISTS (SELECT 1 FROM tenant_entitlement e WHERE e.tenant_id = t.id AND e.feature_type = 'FLOW' AND e.feature_code = 'LIVENESS_CHECK');
INSERT INTO tenant_entitlement (id, tenant_id, feature_type, feature_code, enabled, quota_per_day, valid_until, created_at, updated_at) SELECT ${nextId}, t.id, 'FLOW', 'FACE_ENROLLMENT', CASE WHEN EXISTS (SELECT 1 FROM tenant_entitlement s WHERE s.tenant_id = t.id AND s.feature_type = 'FLOW' AND s.feature_code = 'SELFIE_ID_VERIFICATION' AND s.enabled = 1) THEN 1 ELSE 0 END, NULL, NULL, ${now}, ${now} FROM tenant t WHERE NOT EXISTS (SELECT 1 FROM tenant_entitlement e WHERE e.tenant_id = t.id AND e.feature_type = 'FLOW' AND e.feature_code = 'FACE_ENROLLMENT');
-- The NOQODI house tenant has every flow.
UPDATE tenant_entitlement SET enabled = 1 WHERE tenant_id = 1 AND feature_type = 'FLOW' AND feature_code IN ('LIVENESS_CHECK', 'FACE_ENROLLMENT');
--rollback DELETE FROM tenant_entitlement WHERE feature_type = 'FLOW' AND feature_code IN ('LIVENESS_CHECK', 'FACE_ENROLLMENT');

--changeset camtech:1.6.0-001-liveness-policy
-- Face registration without a document is always ACTIVE (a challenge is required); the selfie verification
-- may also run PASSIVE when the back-office allows it.
ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_flow;
ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_active;
ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_flow CHECK (flow_code IN ('SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'));
ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_active CHECK (NOT (flow_code IN ('SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT') AND allowed_modes LIKE '%PASSIVE%'));
INSERT INTO flow_liveness_policy (id, tenant_id, flow_code, allowed_modes, allowed_actions, min_actions, max_actions, require_spare_action, created_at, updated_at) SELECT ${nextId}, id, 'LIVENESS_CHECK', 'ACTIVE', 'TURN_LEFT,TURN_RIGHT,BLINK,LOOK_UP,LOOK_DOWN,SMILE,MOVE_CLOSER', 2, 4, 1, ${now}, ${now} FROM tenant;
INSERT INTO flow_liveness_policy (id, tenant_id, flow_code, allowed_modes, allowed_actions, min_actions, max_actions, require_spare_action, created_at, updated_at) SELECT ${nextId}, id, 'FACE_ENROLLMENT', 'ACTIVE', 'TURN_LEFT,TURN_RIGHT,BLINK,LOOK_UP,LOOK_DOWN,SMILE,MOVE_CLOSER', 2, 4, 1, ${now}, ${now} FROM tenant;
--rollback DELETE FROM flow_liveness_policy WHERE flow_code IN ('LIVENESS_CHECK', 'FACE_ENROLLMENT');
--rollback ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_flow;
--rollback ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_active;
--rollback ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_flow CHECK (flow_code IN ('SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION'));
--rollback ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_active CHECK (NOT (flow_code = 'SELFIE_ID_VERIFICATION' AND allowed_modes LIKE '%PASSIVE%'));

--changeset camtech:1.6.0-001-session-enroll-face
-- 1 = an APPROVED decision (automatic or by a reviewer) registers the session's face for the person.
ALTER TABLE verification_session ADD enroll_face NUMBER(1) DEFAULT 0 NOT NULL;
ALTER TABLE verification_session ADD CONSTRAINT ck_ver_session_enroll_face CHECK (enroll_face IN (0, 1));
-- Sessions started before this release keep the old behaviour.
UPDATE verification_session SET enroll_face = 1 WHERE flow_code = 'SELFIE_ID_VERIFICATION';
--rollback ALTER TABLE verification_session DROP CONSTRAINT ck_ver_session_enroll_face;
--rollback ALTER TABLE verification_session DROP COLUMN enroll_face;

--changeset camtech:1.6.0-001-challenge-flow
-- The flow a challenge was issued for, so a challenge of one flow cannot be used in another.
-- NULL on older rows: those were issued for SELFIE_ID_VERIFICATION (session_id set) or FACE_AUTHENTICATION.
ALTER TABLE liveness_challenge ADD flow_code VARCHAR2(50 CHAR);
--rollback ALTER TABLE liveness_challenge DROP COLUMN flow_code;

--changeset camtech:1.6.0-001-reason-codes
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (74, 'FACE_ALREADY_ENROLLED', 'MATCH', 409, 'A face is already registered for this person.', 'يوجد وجه مسجّل بالفعل لهذا الشخص.', ${now}, ${now});
UPDATE ref_reason_code SET message_en = 'No registered face was found for this person. Register the face first.', message_ar = 'لم يتم العثور على وجه مسجّل لهذا الشخص. سجّل الوجه أولًا.' WHERE code = 'NO_ENROLLED_FACE';
--rollback DELETE FROM ref_reason_code WHERE id = 74;
--rollback UPDATE ref_reason_code SET message_en = 'No enrolled face was found for this person. Complete a selfie ID verification first.', message_ar = 'لم يتم العثور على وجه مسجّل لهذا الشخص. أكمل التحقق بالصورة الشخصية والهوية أولًا.' WHERE code = 'NO_ENROLLED_FACE';
