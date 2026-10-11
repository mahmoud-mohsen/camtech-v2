package com.facetech.backend.exception;

import org.springframework.http.HttpStatus;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Failure with a stable machine-readable {@code code} (e.g. NO_FACE, BLURRY,
 * SESSION_EXPIRED) so clients can show a specific, actionable message
 * instead of a generic error. {@link #with} adds fields to the v2 error body
 * (for example attemptsRemaining or nextStep).
 */
public class FaceMatchException extends RuntimeException {

    private final String code;
    private final HttpStatus status;
    private final Map<String, Object> extra = new LinkedHashMap<>();

    public FaceMatchException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public FaceMatchException(HttpStatus status, String code, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
    }

    public FaceMatchException with(String key, Object value) {
        if (value != null) {
            extra.put(key, value);
        }
        return this;
    }

    public String getCode() {
        return code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public Map<String, Object> getExtra() {
        return Collections.unmodifiableMap(extra);
    }
}
