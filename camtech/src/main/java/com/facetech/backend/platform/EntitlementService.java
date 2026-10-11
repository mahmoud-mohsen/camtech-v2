package com.facetech.backend.platform;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.ClientAppPermission;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.TenantEntitlement;
import com.facetech.backend.domain.UsageCounter;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.repository.ClientAppPermissionRepository;
import com.facetech.backend.repository.TenantEntitlementRepository;
import com.facetech.backend.repository.UsageCounterRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * What a tenant may do (tenant_entitlement), what each client app inside it
 * may do (client_app_permission, which can only narrow the tenant), and the
 * daily quota (usage_counter, UTC days; a null quota is unlimited).
 */
@Service
@Slf4j
public class EntitlementService {

    private static final long CACHE_MILLIS = 30_000;

    private final TenantEntitlementRepository entitlementRepository;
    private final ClientAppPermissionRepository permissionRepository;
    private final UsageCounterRepository usageRepository;
    private final TenantService tenantService;
    private final Map<Long, CachedEntitlements> entitlementCache = new ConcurrentHashMap<>();
    private final Map<Long, CachedPermissions> permissionCache = new ConcurrentHashMap<>();

    public EntitlementService(TenantEntitlementRepository entitlementRepository,
                              ClientAppPermissionRepository permissionRepository,
                              UsageCounterRepository usageRepository,
                              TenantService tenantService) {
        this.entitlementRepository = entitlementRepository;
        this.permissionRepository = permissionRepository;
        this.usageRepository = usageRepository;
        this.tenantService = tenantService;
    }

    /** Throws 403 unless the tenant has the feature and the calling app is allowed to use it. */
    public void require(Codes.FeatureType type, String featureCode) {
        log.debug("Checking entitlement {} {} for app {}", type, featureCode, RequestContext.get().clientAppCode());
        if (!isEnabled(type, featureCode)) {
            throw new FaceMatchException(HttpStatus.FORBIDDEN, "FEATURE_NOT_ENABLED",
                    "This feature is not enabled: " + featureCode).with("feature", featureCode);
        }
        ClientApp app = RequestContext.get().getClientApp();
        if (app != null && !isAllowedForApp(app.getId(), featureCode)) {
            throw new FaceMatchException(HttpStatus.FORBIDDEN, "FEATURE_NOT_ALLOWED",
                    "This app is not allowed to use this feature: " + featureCode).with("feature", featureCode);
        }
    }

    public boolean isEnabled(Codes.FeatureType type, String featureCode) {
        return find(type, featureCode).map(this::isActive).orElse(false);
    }

    /** Enabled for the tenant and allowed for this app. */
    public boolean isAvailable(Long clientAppId, Codes.FeatureType type, String featureCode) {
        return isEnabled(type, featureCode) && (clientAppId == null || isAllowedForApp(clientAppId, featureCode));
    }

    /** No permission row means allowed: permissions only narrow what the tenant has. */
    public boolean isAllowedForApp(Long clientAppId, String featureCode) {
        return permissions(clientAppId).getOrDefault(featureCode, true);
    }

    public List<TenantEntitlement> entitlements() {
        return entitlements(tenantService.currentTenantId());
    }

    public Optional<TenantEntitlement> find(Codes.FeatureType type, String featureCode) {
        return entitlements().stream()
                .filter(e -> e.getFeatureType() == type && e.getFeatureCode().equals(featureCode))
                .findFirst();
    }

    /**
     * Counts one use of a quota-limited feature today. Runs in its own
     * transaction so the count stays even when the calling request fails.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void consume(Codes.FeatureType type, String featureCode) {
        Long tenantId = tenantService.currentTenantId();
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Long quota = find(type, featureCode).map(TenantEntitlement::getQuotaPerDay).orElse(null);
        if (quota != null) {
            // Check and count in one statement: two requests can no longer both pass at quota - 1.
            if (usageRepository.incrementBelow(tenantId, featureCode, today, quota) == 0) {
                boolean counted = false;
                if (quota > 0 && usageRepository.findByTenantIdAndFeatureCodeAndUsageDate(tenantId, featureCode, today).isEmpty()) {
                    counted = createCounter(tenantId, featureCode, today)
                            || usageRepository.incrementBelow(tenantId, featureCode, today, quota) == 1;
                }
                if (!counted) {
                    log.info("Daily quota exceeded: tenant {} feature {} quota {}", tenantId, featureCode, quota);
                    throw new FaceMatchException(HttpStatus.TOO_MANY_REQUESTS, "QUOTA_EXCEEDED",
                            "The daily limit for " + featureCode + " has been reached").with("feature", featureCode);
                }
            }
        } else if (usageRepository.increment(tenantId, featureCode, today) == 0
                && !createCounter(tenantId, featureCode, today)) {
            usageRepository.increment(tenantId, featureCode, today);
        }
        log.debug("Counted one use of {} for tenant {} on {} (quota {})", featureCode, tenantId, today,
                quota != null ? quota : "unlimited");
    }

    /** The day's counter row at 1; false when another request created it first. */
    private boolean createCounter(Long tenantId, String featureCode, LocalDate today) {
        try {
            UsageCounter counter = new UsageCounter();
            counter.setTenantId(tenantId);
            counter.setFeatureCode(featureCode);
            counter.setUsageDate(today);
            counter.setUsedCount(1);
            usageRepository.saveAndFlush(counter);
            return true;
        } catch (DataIntegrityViolationException raced) {
            return false;
        }
    }

    public long usedToday(String featureCode) {
        return usageRepository.findByTenantIdAndFeatureCodeAndUsageDate(
                        tenantService.currentTenantId(), featureCode, LocalDate.now(ZoneOffset.UTC))
                .map(UsageCounter::getUsedCount).orElse(0L);
    }

    public void evict() {
        entitlementCache.clear();
        permissionCache.clear();
        log.info("Entitlement and app permission caches cleared");
    }

    /** Enabled and not past its validity date. */
    public boolean isActive(TenantEntitlement e) {
        return e.isEnabled() && (e.getValidUntil() == null || !e.getValidUntil().isBefore(LocalDate.now(ZoneOffset.UTC)));
    }

    private List<TenantEntitlement> entitlements(Long tenantId) {
        CachedEntitlements c = entitlementCache.get(tenantId);
        long now = System.currentTimeMillis();
        if (c == null || now - c.loadedAt > CACHE_MILLIS) {
            c = new CachedEntitlements(
                    List.copyOf(entitlementRepository.findByTenantIdOrderByFeatureTypeAscFeatureCodeAsc(tenantId)), now);
            entitlementCache.put(tenantId, c);
            log.debug("Loaded {} entitlements for tenant {}", c.rows.size(), tenantId);
        }
        return c.rows;
    }

    private Map<String, Boolean> permissions(Long clientAppId) {
        CachedPermissions c = permissionCache.get(clientAppId);
        long now = System.currentTimeMillis();
        if (c == null || now - c.loadedAt > CACHE_MILLIS) {
            Map<String, Boolean> map = new ConcurrentHashMap<>();
            for (ClientAppPermission p : permissionRepository.findByClientAppId(clientAppId)) {
                map.put(p.getFeatureCode(), p.isAllowed());
            }
            c = new CachedPermissions(map, now);
            permissionCache.put(clientAppId, c);
        }
        return c.allowed;
    }

    private record CachedEntitlements(List<TenantEntitlement> rows, long loadedAt) {
    }

    private record CachedPermissions(Map<String, Boolean> allowed, long loadedAt) {
    }
}
