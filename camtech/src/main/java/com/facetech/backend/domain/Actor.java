package com.facetech.backend.domain;

/**
 * Who is acting on the current thread: a client app code, a back-office
 * username or "system". Filled by the request filters and background jobs,
 * read by {@link BaseEntity} for created_by / updated_by.
 */
public final class Actor {

    public static final String SYSTEM = "system";

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private Actor() {
    }

    public static String current() {
        String actor = CURRENT.get();
        return actor != null ? actor : SYSTEM;
    }

    public static void set(String actor) {
        CURRENT.set(actor);
    }

    public static void clear() {
        CURRENT.remove();
    }
}
