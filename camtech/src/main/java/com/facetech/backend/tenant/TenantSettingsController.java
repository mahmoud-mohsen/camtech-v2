package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminConfigController;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.TenantSettingsService;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Document settings the tenant manages, and its data retention (read-only: camtech sets it). */
@RestController
@RequestMapping("/v2/tenant")
public class TenantSettingsController {

    private final TenantSettingsService settings;
    private final AdminConfigController config;
    private final AuditService audit;

    public TenantSettingsController(TenantSettingsService settings, AdminConfigController config, AuditService audit) {
        this.settings = settings;
        this.config = config;
        this.audit = audit;
    }

    /** expiryWarningDays: days before expiry when DOCUMENT_EXPIRING is sent and the portal flags a document. */
    public record DocumentSettings(int expiryWarningDays, int defaultExpiryWarningDays, int min, int max) {
    }

    public record DocumentSettingsUpdate(Integer expiryWarningDays) {
    }

    @GetMapping("/document-settings")
    public DocumentSettings documentSettings() {
        ConfigKey key = ConfigKey.DOCUMENT_EXPIRY_WARNING_DAYS;
        return new DocumentSettings(settings.expiryWarningDays(tenantId()), Integer.parseInt(key.defaultValue()),
                key.min().intValue(), key.max().intValue());
    }

    @PutMapping("/document-settings")
    @Transactional
    public DocumentSettings saveDocumentSettings(@RequestBody DocumentSettingsUpdate body) {
        String value = body == null || body.expiryWarningDays() == null ? null : String.valueOf(body.expiryWarningDays());
        settings.set(tenantId(), ConfigKey.DOCUMENT_EXPIRY_WARNING_DAYS, value);
        audit.record("DOCUMENT_SETTINGS_UPDATED", "tenant", RequestContext.get().getPortalTenantCode(),
                Map.of("expiryWarningDays", value));
        return documentSettings();
    }

    @GetMapping("/retention-policies")
    public List<AdminConfigController.RetentionView> retentionPolicies() {
        return config.retentionPolicies();
    }

    private static Long tenantId() {
        return RequestContext.get().getTenantId();
    }
}
