--liquibase formatted sql

-- Face authentication and the liveness check (LIVENESS_CHECK, renamed from "Selfie verification") register
-- nothing, so they now run PASSIVE by default and the tenant can switch to ACTIVE in the portal. Policies
-- still on the starting value (ACTIVE only) allow both modes; a tenant that saved a mode keeps it, a tenant
-- that saved nothing gets PASSIVE (LivenessSettingsService.defaults).

--changeset camtech:1.8.0-001-liveness-policy-both-modes
UPDATE flow_liveness_policy SET allowed_modes = 'ACTIVE,PASSIVE', updated_at = ${now} WHERE flow_code IN ('FACE_AUTHENTICATION', 'LIVENESS_CHECK') AND allowed_modes = 'ACTIVE';
--rollback UPDATE flow_liveness_policy SET allowed_modes = 'ACTIVE' WHERE flow_code IN ('FACE_AUTHENTICATION', 'LIVENESS_CHECK') AND allowed_modes = 'ACTIVE,PASSIVE';

--changeset camtech:1.8.0-001-flow-names
UPDATE ref_flow_def SET name = 'Liveness check', description = 'Proves a real, live person is in front of the camera (no photo, screen or mask). No document, no face match, nothing registered.', updated_at = ${now} WHERE code = 'LIVENESS_CHECK';
UPDATE ref_flow_def SET description = 'Face login for a returning user: liveness, then a match against the face registered for the user (face registration or a selfie ID verification).', updated_at = ${now} WHERE code = 'FACE_AUTHENTICATION';
--rollback UPDATE ref_flow_def SET name = 'Selfie verification', description = 'Liveness selfies only: proves a real person is in front of the camera. No document, no face registered.' WHERE code = 'LIVENESS_CHECK';
--rollback UPDATE ref_flow_def SET description = 'Liveness selfies matched against the face enrolled by an earlier selfie ID verification.' WHERE code = 'FACE_AUTHENTICATION';
