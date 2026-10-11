package com.facetech.backend.platform;

import com.facetech.backend.domain.Tenant;
import com.facetech.backend.repository.TenantRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Resolves tenants. Requests carry their tenant in {@link RequestContext} (from the client app,
 * or the tenant portal); background work without one uses the default tenant
 * ({@code camtech.tenant-code}).
 */
@Service
@Slf4j
public class TenantService {

    private static final long STATUS_CACHE_MILLIS = 60_000;

    private final TenantRepository tenantRepository;
    private final CamtechProperties properties;

    private final Map<Long, String> codes = new ConcurrentHashMap<>();
    private final Map<Long, CachedStatus> statuses = new ConcurrentHashMap<>();
    private volatile Long defaultTenantId;

    public TenantService(TenantRepository tenantRepository, CamtechProperties properties) {
        this.tenantRepository = tenantRepository;
        this.properties = properties;
    }

    public Long defaultTenantId() {
        Long id = defaultTenantId;
        if (id == null) {
            id = tenant().getId();
            defaultTenantId = id;
            log.info("Default tenant {} resolved to id {}", properties.getTenantCode(), id);
        }
        return id;
    }

    /** The default tenant. */
    public Tenant tenant() {
        return tenantRepository.findByCode(properties.getTenantCode())
                .orElseThrow(() -> new IllegalStateException(
                        "Tenant " + properties.getTenantCode() + " is missing: run the Liquibase changelog"));
    }

    /** The tenant of the current request. */
    public Tenant currentTenant() {
        return tenantRepository.findById(currentTenantId()).orElseThrow();
    }

    public Optional<Tenant> findById(Long id) {
        return id == null ? Optional.empty() : tenantRepository.findById(id);
    }

    public Optional<Tenant> findByCode(String code) {
        return code == null || code.isBlank() ? Optional.empty()
                : tenantRepository.findByCode(code.trim().toUpperCase(Locale.ROOT));
    }

    /** Tenant code by id (codes never change, so they are cached). */
    public String code(Long tenantId) {
        return codes.computeIfAbsent(tenantId, id -> tenantRepository.findById(id).map(Tenant::getCode).orElse(null));
    }

    /** False once the tenant is suspended (re-read at most once a minute). */
    public boolean isActive(Long tenantId) {
        long now = System.currentTimeMillis();
        CachedStatus c = statuses.get(tenantId);
        if (c == null || now - c.at() > STATUS_CACHE_MILLIS) {
            c = new CachedStatus(tenantRepository.findById(tenantId).map(t -> "ACTIVE".equals(t.getStatus())).orElse(false), now);
            statuses.put(tenantId, c);
            log.debug("Tenant {} status refreshed: active={}", tenantId, c.active());
        }
        return c.active();
    }

    /** Forgets cached statuses, e.g. after a tenant is suspended or reactivated. */
    public void evictStatus() {
        statuses.clear();
        log.info("Tenant status cache cleared");
    }

    private record CachedStatus(boolean active, long at) {
    }

    /** The tenant of the current request, or the default tenant for background work. */
    public Long currentTenantId() {
        Long id = RequestContext.get().getTenantId();
        return id != null ? id : defaultTenantId();
    }
}
