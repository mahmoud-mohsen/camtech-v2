--liquibase formatted sql

-- Liveness limits per tenant and flow, set by the back-office: which modes (PASSIVE, ACTIVE) and
-- challenges the tenant may choose, and how many challenges each user does. The tenant's own
-- choice inside these limits is stored in config_param (flow-scoped rows, see 003).
-- Selfie ID verification (onboarding) is always ACTIVE: PASSIVE is never allowed for it.

--changeset camtech:1.2.0-001-flow-liveness-policy
CREATE TABLE flow_liveness_policy (
    id                    NUMBER(19)          NOT NULL,
    tenant_id             NUMBER(19)          NOT NULL,
    flow_code             VARCHAR2(50 CHAR)   NOT NULL,
    allowed_modes         VARCHAR2(50 CHAR)   NOT NULL,
    allowed_actions       VARCHAR2(200 CHAR)  NOT NULL,
    min_actions           NUMBER(2)           NOT NULL,
    max_actions           NUMBER(2)           NOT NULL,
    require_spare_action  NUMBER(1)           DEFAULT 1 NOT NULL,
    created_at            TIMESTAMP           NOT NULL,
    created_by            VARCHAR2(100 CHAR),
    updated_at            TIMESTAMP           NOT NULL,
    updated_by            VARCHAR2(100 CHAR),
    row_version           NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_flow_liveness_policy PRIMARY KEY (id),
    CONSTRAINT fk_flow_liveness_policy_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT uk_flow_liveness_policy UNIQUE (tenant_id, flow_code),
    CONSTRAINT ck_flow_liveness_policy_flow CHECK (flow_code IN ('SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION')),
    CONSTRAINT ck_flow_liveness_policy_min CHECK (min_actions BETWEEN 1 AND 6),
    CONSTRAINT ck_flow_liveness_policy_max CHECK (max_actions BETWEEN min_actions AND 6),
    CONSTRAINT ck_flow_liveness_policy_spare CHECK (require_spare_action IN (0, 1)),
    CONSTRAINT ck_flow_liveness_policy_active CHECK (NOT (flow_code = 'SELFIE_ID_VERIFICATION' AND allowed_modes LIKE '%PASSIVE%'))
);
COMMENT ON TABLE flow_liveness_policy IS 'Liveness limits per tenant and flow (back-office). Lists are comma-separated.';
--rollback DROP TABLE flow_liveness_policy;

--changeset camtech:1.2.0-001-flow-liveness-policy-seed
-- Starting values for every existing tenant and both liveness flows (new tenants get them from the API).
INSERT INTO flow_liveness_policy (id, tenant_id, flow_code, allowed_modes, allowed_actions, min_actions, max_actions, require_spare_action, created_at, updated_at) SELECT ${nextId}, id, 'SELFIE_ID_VERIFICATION', 'ACTIVE', 'TURN_LEFT,TURN_RIGHT,BLINK', 2, 4, 1, ${now}, ${now} FROM tenant;
INSERT INTO flow_liveness_policy (id, tenant_id, flow_code, allowed_modes, allowed_actions, min_actions, max_actions, require_spare_action, created_at, updated_at) SELECT ${nextId}, id, 'FACE_AUTHENTICATION', 'ACTIVE', 'TURN_LEFT,TURN_RIGHT,BLINK', 2, 4, 1, ${now}, ${now} FROM tenant;
--rollback DELETE FROM flow_liveness_policy;
