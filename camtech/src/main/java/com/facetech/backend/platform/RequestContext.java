package com.facetech.backend.platform;

import com.facetech.backend.domain.BackofficeUser;
import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.TenantUser;
import com.facetech.backend.exception.FaceMatchException;
import lombok.Getter;
import lombok.Setter;
import org.springframework.http.HttpStatus;

/**
 * Per-request facts the services need: which tenant and app (or back-office
 * user) is calling, from where, and in which language. Set by the request
 * filters, cleared when the request ends.
 */
@Getter
@Setter
public final class RequestContext {

    private static final ThreadLocal<RequestContext> CURRENT = ThreadLocal.withInitial(RequestContext::new);

    private Long tenantId;
    private ClientApp clientApp;
    /** True when the app sent valid client credentials (not the default app). */
    private boolean credentialed;
    private BackofficeUser adminUser;
    private String ipAddress;
    private String userAgent;
    /** "en" or "ar", from Accept-Language. */
    private String lang = "en";
    /** "Authorization: Bearer ..." value for public calls (the session token). */
    private String bearerToken;
    /** Set when the call came with an SDK token (X-Sdk-Token) instead of client credentials. */
    private boolean sdkToken;
    /** subjectRef the SDK token is bound to, or null when the token allows any user. */
    private String sdkSubjectRef;
    /** Tenant code of a tenant portal call (/v2/tenant/**); null for every other call. */
    private String portalTenantCode;
    /** Signed-in tenant portal user of a /v2/tenant/** call. */
    private TenantUser tenantUser;

    /**
     * The subjectRef a public call may use. An SDK token bound to a user only allows that user;
     * otherwise the caller's value is used as is.
     */
    public String subjectRefFor(String requested) {
        if (sdkSubjectRef == null) {
            return requested;
        }
        if (requested != null && !requested.isBlank() && !requested.trim().equals(sdkSubjectRef)) {
            throw new FaceMatchException(HttpStatus.FORBIDDEN,
                    "SUBJECT_MISMATCH", "This SDK token was issued for another user");
        }
        return sdkSubjectRef;
    }

    public static RequestContext get() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }

    public String clientAppCode() {
        return clientApp != null ? clientApp.getCode() : null;
    }
}
