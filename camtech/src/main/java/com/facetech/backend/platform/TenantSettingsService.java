package com.facetech.backend.platform;

import com.facetech.backend.domain.ConfigParam;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.repository.ConfigParamRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Tenant-wide settings kept in config_param (rows without flow, channel or app): who reviews verifications,
 * how early documents are flagged before they expire.
 */
@Slf4j
@Service
public class TenantSettingsService {

    public static final String REVIEW_OWNER_TENANT = "TENANT";
    public static final String REVIEW_OWNER_CAMTECH = "CAMTECH";

    private final ConfigParamRepository repository;
    private final ConfigService config;
    private final TenantService tenantService;

    public TenantSettingsService(ConfigParamRepository repository, ConfigService config, TenantService tenantService) {
        this.repository = repository;
        this.config = config;
        this.tenantService = tenantService;
    }

    /** The tenant-wide value, or the catalogue default. */
    public String get(Long tenantId, ConfigKey key) {
        return config.tenantRows(tenantId).stream().filter(p -> isTenantWide(p, key)).findFirst()
                .map(p -> p.getParamValue().trim()).orElse(key.defaultValue());
    }

    @Transactional
    public String set(Long tenantId, ConfigKey key, String value) {
        String v = value == null ? null : value.trim();
        String error = key.validate(v);
        if (error != null) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", key.key() + ": " + error);
        }
        ConfigParam p = repository.findByTenantId(tenantId).stream().filter(x -> isTenantWide(x, key)).findFirst()
                .orElseGet(() -> {
                    ConfigParam n = new ConfigParam();
                    n.setTenantId(tenantId);
                    n.setParamKey(key.key());
                    n.setDescription(key.description());
                    return n;
                });
        p.setParamValue(v);
        repository.saveAndFlush(p);
        config.evict();
        log.info("Tenant setting saved: tenantId={} {}={}", tenantId, key.key(), v);
        return v;
    }

    /** TENANT or CAMTECH. camtech's own (default) tenant is always reviewed by camtech operators too. */
    public String reviewOwner(Long tenantId) {
        return get(tenantId, ConfigKey.REVIEW_OWNER).toUpperCase();
    }

    public boolean tenantReviews(Long tenantId) {
        return REVIEW_OWNER_TENANT.equals(reviewOwner(tenantId));
    }

    /** Tenants whose review cases camtech operators decide: the default tenant and those that chose CAMTECH. */
    public Set<Long> camtechReviewedTenants() {
        Set<Long> ids = new LinkedHashSet<>();
        ids.add(tenantService.defaultTenantId());
        if (REVIEW_OWNER_CAMTECH.equals(ConfigKey.REVIEW_OWNER.defaultValue())) {
            throw new IllegalStateException("review.owner defaults to CAMTECH: list every tenant instead");
        }
        repository.findByParamKeyAndParamValue(ConfigKey.REVIEW_OWNER.key(), REVIEW_OWNER_CAMTECH).stream()
                .filter(p -> isTenantWide(p, ConfigKey.REVIEW_OWNER)).forEach(p -> ids.add(p.getTenantId()));
        return ids;
    }

    public boolean camtechReviews(Long tenantId) {
        return tenantId.equals(tenantService.defaultTenantId()) || !tenantReviews(tenantId);
    }

    public int expiryWarningDays(Long tenantId) {
        return Integer.parseInt(get(tenantId, ConfigKey.DOCUMENT_EXPIRY_WARNING_DAYS));
    }

    private static boolean isTenantWide(ConfigParam p, ConfigKey key) {
        return key.key().equals(p.getParamKey()) && p.getFlowCode() == null && p.getChannel() == null
                && p.getClientAppCode() == null && p.getParamValue() != null;
    }
}
