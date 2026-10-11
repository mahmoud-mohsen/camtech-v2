--liquibase formatted sql

-- "Move closer" becomes the 7th challenge (MOVE_CLOSER), so a policy can ask for up to 7 challenges per user.
-- Policies still on the original starting values allow every challenge from now on (the new starting values);
-- tenant settings rows are left alone. No check constraint lists challenge names.

--changeset camtech:1.4.0-001-policy-action-bound
ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_min;
ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_max;
ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_min CHECK (min_actions BETWEEN 1 AND 7);
ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_max CHECK (max_actions BETWEEN min_actions AND 7);
--rollback UPDATE flow_liveness_policy SET max_actions = 6 WHERE max_actions > 6;
--rollback UPDATE flow_liveness_policy SET min_actions = 6 WHERE min_actions > 6;
--rollback ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_min;
--rollback ALTER TABLE flow_liveness_policy DROP CONSTRAINT ck_flow_liveness_policy_max;
--rollback ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_min CHECK (min_actions BETWEEN 1 AND 6);
--rollback ALTER TABLE flow_liveness_policy ADD CONSTRAINT ck_flow_liveness_policy_max CHECK (max_actions BETWEEN min_actions AND 6);

--changeset camtech:1.4.0-001-all-actions-allowed
UPDATE flow_liveness_policy SET allowed_actions = 'TURN_LEFT,TURN_RIGHT,BLINK,LOOK_UP,LOOK_DOWN,SMILE,MOVE_CLOSER' WHERE allowed_actions = 'TURN_LEFT,TURN_RIGHT,BLINK';
--rollback UPDATE flow_liveness_policy SET allowed_actions = 'TURN_LEFT,TURN_RIGHT,BLINK' WHERE allowed_actions = 'TURN_LEFT,TURN_RIGHT,BLINK,LOOK_UP,LOOK_DOWN,SMILE,MOVE_CLOSER';
