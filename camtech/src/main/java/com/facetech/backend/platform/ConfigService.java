package com.facetech.backend.platform;

import com.facetech.backend.domain.ConfigParam;
import com.facetech.backend.repository.ConfigParamRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads tenant settings from config_param. A row applies when each of its
 * scope columns is empty or equals the request's flow / channel / client
 * app; among the rows that apply, the most specific wins
 * (client app &gt; channel &gt; flow &gt; base). Rows are cached for 30 seconds and
 * the cache is dropped on every back-office change.
 */
@Service
@Slf4j
public class ConfigService {

    private static final long CACHE_MILLIS = 30_000;

    private final ConfigParamRepository repository;
    private final TenantService tenantService;
    private final Map<Long, Cached> cache = new ConcurrentHashMap<>();

    public ConfigService(ConfigParamRepository repository, TenantService tenantService) {
        this.repository = repository;
        this.tenantService = tenantService;
    }

    /** Where a setting is being read for. Any part may be null. */
    public record Scope(String flowCode, String channel, String clientAppCode) {
        public static final Scope BASE = new Scope(null, null, null);

        public static Scope of(String flowCode) {
            RequestContext ctx = RequestContext.get();
            return new Scope(flowCode,
                    ctx.getClientApp() != null ? ctx.getClientApp().getChannel().name() : null,
                    ctx.clientAppCode());
        }
    }

    /** The winning value, or the catalogue default (may be null for keys with no default). */
    public String get(ConfigKey key, Scope scope) {
        ConfigParam best = null;
        int bestScore = -1;
        for (ConfigParam p : rows(tenantService.currentTenantId())) {
            if (!p.getParamKey().equals(key.key())) {
                continue;
            }
            if (!matches(p.getFlowCode(), scope.flowCode())
                    || !matches(p.getChannel(), scope.channel())
                    || !matches(p.getClientAppCode(), scope.clientAppCode())) {
                continue;
            }
            int score = (p.getClientAppCode() != null ? 4 : 0) + (p.getChannel() != null ? 2 : 0)
                    + (p.getFlowCode() != null ? 1 : 0);
            if (score > bestScore) {
                best = p;
                bestScore = score;
            }
        }
        String value = best != null ? best.getParamValue() : key.defaultValue();
        log.debug("Config {} = {} (scope flow={} channel={} app={}; from {})", key.key(), value,
                scope.flowCode(), scope.channel(), scope.clientAppCode(), best != null ? "config_param" : "default");
        return value;
    }

    public double getDouble(ConfigKey key, Scope scope) {
        return Double.parseDouble(get(key, scope).trim());
    }

    public int getInt(ConfigKey key, Scope scope, int fallback) {
        String v = get(key, scope);
        return v == null || v.isBlank() ? fallback : Integer.parseInt(v.trim());
    }

    public boolean getBoolean(ConfigKey key, Scope scope) {
        return Boolean.parseBoolean(get(key, scope).trim());
    }

    /** Every config_param row of a tenant (cached like the lookups above). */
    public List<ConfigParam> tenantRows(Long tenantId) {
        return rows(tenantId);
    }

    public void evict() {
        cache.clear();
        log.info("Config cache cleared");
    }

    private List<ConfigParam> rows(Long tenantId) {
        Cached c = cache.get(tenantId);
        long now = System.currentTimeMillis();
        if (c == null || now - c.loadedAt > CACHE_MILLIS) {
            c = new Cached(List.copyOf(repository.findByTenantId(tenantId)), now);
            cache.put(tenantId, c);
            log.debug("Loaded {} config rows for tenant {}", c.rows.size(), tenantId);
        }
        return c.rows;
    }

    private static boolean matches(String rowValue, String requestValue) {
        return rowValue == null || rowValue.equals(requestValue);
    }

    private record Cached(List<ConfigParam> rows, long loadedAt) {
    }
}
