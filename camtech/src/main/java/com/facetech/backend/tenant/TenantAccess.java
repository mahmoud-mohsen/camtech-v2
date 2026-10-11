package com.facetech.backend.tenant;

import com.facetech.backend.domain.Codes;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Tenant portal roles allowed to call a /v2/tenant endpoint, besides OWNER (always allowed). Without the
 * annotation, GET is open to every role and every other method needs DEVELOPER.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface TenantAccess {
    Codes.TenantRole[] value();
}
