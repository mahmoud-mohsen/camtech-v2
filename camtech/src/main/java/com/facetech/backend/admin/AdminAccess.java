package com.facetech.backend.admin;

import com.facetech.backend.domain.Codes;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Lowest back-office role allowed to call an admin endpoint. Without the
 * annotation, GET needs VIEWER and every other method needs ADMIN.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface AdminAccess {
    Codes.AdminRole value();
}
