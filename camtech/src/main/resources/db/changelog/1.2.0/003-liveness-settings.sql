--liquibase formatted sql

-- Liveness settings per flow. liveness.active_required is replaced by the flow's mode (tenant setting,
-- ACTIVE by default) plus liveness.allow_without_challenge, which keeps released mobile apps without
-- challenge support working: their uploads are accepted without a challenge, but the passive
-- anti-spoof check is then required.

--changeset camtech:1.2.0-003-reason-codes
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (73, 'FACE_NOT_VISIBLE', 'LIVENESS', 422, 'We lost sight of your face during the check. Keep your face in the frame and try again.', 'فقدنا رؤية وجهك أثناء التحقق. أبقِ وجهك داخل الإطار وحاول مرة أخرى.', ${now}, ${now});
--rollback DELETE FROM ref_reason_code WHERE id = 73;

--changeset camtech:1.2.0-003-allow-without-challenge
INSERT INTO config_param (id, tenant_id, channel, param_key, param_value, description, created_at, updated_at) SELECT ${nextId}, id, 'MOBILE', 'liveness.allow_without_challenge', 'true', 'Released mobile apps without active-liveness support: accept uploads without a challenge (passive check required)', ${now}, ${now} FROM tenant;
--rollback DELETE FROM config_param WHERE param_key = 'liveness.allow_without_challenge';

--changeset camtech:1.2.0-003-drop-active-required
DELETE FROM config_param WHERE param_key = 'liveness.active_required';
--rollback INSERT INTO config_param (id, tenant_id, channel, param_key, param_value, description, created_at, updated_at) SELECT 15, id, 'WEB', 'liveness.active_required', 'true', 'Web: the web SDK always performs an active-liveness challenge', ${now}, ${now} FROM tenant WHERE id = 1;
--rollback INSERT INTO config_param (id, tenant_id, channel, param_key, param_value, description, created_at, updated_at) SELECT ${nextId}, id, 'WEB', 'liveness.active_required', 'true', 'Web: the web SDK always performs an active-liveness challenge', ${now}, ${now} FROM tenant WHERE id <> 1;
