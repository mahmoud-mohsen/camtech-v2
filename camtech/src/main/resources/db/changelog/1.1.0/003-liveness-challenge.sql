--liquibase formatted sql

-- Active liveness: a random challenge (turn left, turn right, blink) issued by camtech before the
-- selfies are taken. It can be used once, before it expires, by the app (and session or user) it
-- was issued for. The frames the user records while doing it are checked on the server.

--changeset camtech:1.1.0-003-liveness-challenge
CREATE TABLE liveness_challenge (
    id             NUMBER(19)          NOT NULL,
    tenant_id      NUMBER(19)          NOT NULL,
    public_id      VARCHAR2(36 CHAR)   NOT NULL,
    client_app_id  NUMBER(19)          NOT NULL,
    session_id     NUMBER(19),
    subject_ref    VARCHAR2(200 CHAR),
    actions        VARCHAR2(100 CHAR)  NOT NULL,
    status         VARCHAR2(20 CHAR)   NOT NULL,
    expires_at     TIMESTAMP           NOT NULL,
    used_at        TIMESTAMP,
    created_at     TIMESTAMP           NOT NULL,
    created_by     VARCHAR2(100 CHAR),
    updated_at     TIMESTAMP           NOT NULL,
    updated_by     VARCHAR2(100 CHAR),
    row_version    NUMBER(10)          DEFAULT 0 NOT NULL,
    CONSTRAINT pk_liveness_challenge PRIMARY KEY (id),
    CONSTRAINT uk_liveness_challenge_public UNIQUE (public_id),
    CONSTRAINT fk_liveness_challenge_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id),
    CONSTRAINT fk_liveness_challenge_app FOREIGN KEY (client_app_id) REFERENCES client_app (id),
    CONSTRAINT fk_liveness_challenge_session FOREIGN KEY (session_id) REFERENCES verification_session (id),
    CONSTRAINT ck_liveness_challenge_status CHECK (status IN ('ISSUED', 'USED'))
);
CREATE INDEX ix_liveness_challenge_session ON liveness_challenge (session_id);
CREATE INDEX ix_liveness_challenge_expires ON liveness_challenge (expires_at);
COMMENT ON TABLE liveness_challenge IS 'Active-liveness challenges: random actions, single use, short-lived.';
--rollback DROP TABLE liveness_challenge;

--changeset camtech:1.1.0-003-reason-codes
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (68, 'CHALLENGE_REQUIRED', 'LIVENESS', 400, 'Please update the app and try again.', 'يرجى تحديث التطبيق والمحاولة مرة أخرى.', ${now}, ${now});
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (69, 'CHALLENGE_INVALID', 'LIVENESS', 409, 'This liveness check is no longer valid. Please try again.', 'لم يعد التحقق من الحيوية هذا صالحاً. يرجى المحاولة مرة أخرى.', ${now}, ${now});
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (70, 'CHALLENGE_EXPIRED', 'LIVENESS', 409, 'You took too long to complete the check. Please try again.', 'استغرق إكمال التحقق وقتاً طويلاً. يرجى المحاولة مرة أخرى.', ${now}, ${now});
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (71, 'CHALLENGE_FAILED', 'LIVENESS', 422, 'We could not see you follow the instructions. Please try again and follow each step on the screen.', 'لم نتمكن من رؤيتك تتبع التعليمات. يرجى المحاولة مرة أخرى واتباع كل خطوة على الشاشة.', ${now}, ${now});
INSERT INTO ref_reason_code (id, code, category, http_status, message_en, message_ar, created_at, updated_at) VALUES (72, 'LIVENESS_UNAVAILABLE', 'SYSTEM', 503, 'The liveness check is temporarily unavailable. Please try again in a few minutes.', 'التحقق من الحيوية غير متاح مؤقتاً. يرجى المحاولة بعد بضع دقائق.', ${now}, ${now});
--rollback DELETE FROM ref_reason_code WHERE id BETWEEN 68 AND 72;

--changeset camtech:1.1.0-003-config
-- The web SDK always performs a challenge, so it is required on the web channel from the start.
-- Mobile apps keep working unchanged until they add challenges (then turn it on for MOBILE too).
INSERT INTO config_param (id, tenant_id, channel, param_key, param_value, description, created_at, updated_at) VALUES (15, 1, 'WEB', 'liveness.active_required', 'true', 'Web: the web SDK always performs an active-liveness challenge', ${now}, ${now});
--rollback DELETE FROM config_param WHERE id = 15;
