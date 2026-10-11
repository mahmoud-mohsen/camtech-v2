package com.facetech.backend.platform;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.ConfigParam;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.repository.ConfigParamRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * When a server OCR scan is accepted on its own and when it waits for a person. Stored as config_param rows
 * of the DOCUMENT_SCAN flow, so the back-office can still override them per channel or app; the tenant
 * portal edits the tenant-wide rows.
 */
@Service
@Slf4j
public class DocumentOcrSettingsService {

    private static final List<ConfigKey> KEYS = List.of(ConfigKey.DOCUMENT_OCR_REVIEW_MODE,
            ConfigKey.DOCUMENT_OCR_AUTO_ACCEPT_CONFIDENCE, ConfigKey.DOCUMENT_OCR_FIELD_MIN_CONFIDENCE,
            ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS, ConfigKey.DOCUMENT_OCR_ACCEPT_EXPIRED);

    private final ConfigService config;
    private final ConfigParamRepository repository;

    public DocumentOcrSettingsService(ConfigService config, ConfigParamRepository repository) {
        this.config = config;
        this.repository = repository;
    }

    /**
     * @param reviewMode           AUTO, ALWAYS or NEVER
     * @param requiredFields       empty = each document's own required fields
     */
    public record OcrSettings(String reviewMode, double autoAcceptConfidence, double fieldMinConfidence,
                              List<String> requiredFields, boolean acceptExpired) {
    }

    /** Fields left null keep their saved value. */
    public record SettingsUpdate(String reviewMode, Double autoAcceptConfidence, Double fieldMinConfidence,
                                 List<String> requiredFields, Boolean acceptExpired) {
    }

    public record TenantOcrSettings(OcrSettings settings, OcrSettings defaults, boolean customized, Instant updatedAt,
                                    List<String> reviewModes) {
    }

    /** Settings for the current request (tenant, channel and app). */
    public OcrSettings effective() {
        ConfigService.Scope scope = ConfigService.Scope.of(Codes.FLOW_DOCUMENT_SCAN);
        return new OcrSettings(
                config.get(ConfigKey.DOCUMENT_OCR_REVIEW_MODE, scope).trim().toUpperCase(),
                config.getDouble(ConfigKey.DOCUMENT_OCR_AUTO_ACCEPT_CONFIDENCE, scope),
                config.getDouble(ConfigKey.DOCUMENT_OCR_FIELD_MIN_CONFIDENCE, scope),
                split(config.get(ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS, scope)),
                config.getBoolean(ConfigKey.DOCUMENT_OCR_ACCEPT_EXPIRED, scope));
    }

    public static OcrSettings defaults() {
        return new OcrSettings(ConfigKey.DOCUMENT_OCR_REVIEW_MODE.defaultValue(),
                Double.parseDouble(ConfigKey.DOCUMENT_OCR_AUTO_ACCEPT_CONFIDENCE.defaultValue()),
                Double.parseDouble(ConfigKey.DOCUMENT_OCR_FIELD_MIN_CONFIDENCE.defaultValue()),
                List.of(), Boolean.parseBoolean(ConfigKey.DOCUMENT_OCR_ACCEPT_EXPIRED.defaultValue()));
    }

    /** The tenant-wide settings (rows without channel or app), over the defaults. */
    @Transactional(readOnly = true)
    public TenantOcrSettings tenantView(Long tenantId) {
        Map<String, ConfigParam> rows = tenantRows(tenantId);
        OcrSettings d = defaults();
        Instant updatedAt = rows.values().stream().map(ConfigParam::getUpdatedAt)
                .filter(java.util.Objects::nonNull).max(Instant::compareTo).orElse(null);
        OcrSettings s = new OcrSettings(
                value(rows, ConfigKey.DOCUMENT_OCR_REVIEW_MODE, d.reviewMode()),
                number(rows, ConfigKey.DOCUMENT_OCR_AUTO_ACCEPT_CONFIDENCE, d.autoAcceptConfidence()),
                number(rows, ConfigKey.DOCUMENT_OCR_FIELD_MIN_CONFIDENCE, d.fieldMinConfidence()),
                rows.containsKey(ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS.key())
                        ? split(rows.get(ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS.key()).getParamValue()) : d.requiredFields(),
                rows.containsKey(ConfigKey.DOCUMENT_OCR_ACCEPT_EXPIRED.key())
                        ? Boolean.parseBoolean(rows.get(ConfigKey.DOCUMENT_OCR_ACCEPT_EXPIRED.key()).getParamValue().trim())
                        : d.acceptExpired());
        return new TenantOcrSettings(s, d, !rows.isEmpty(), updatedAt, ConfigKey.OCR_REVIEW_MODES);
    }

    /** Validates and saves the tenant-wide settings (400 VALIDATION_ERROR naming the field when one is wrong). */
    @Transactional
    public TenantOcrSettings saveTenant(Long tenantId, SettingsUpdate body) {
        if (body == null) {
            throw invalid("A body is required");
        }
        Map<ConfigKey, String> values = new LinkedHashMap<>();
        if (body.reviewMode() != null) {
            values.put(ConfigKey.DOCUMENT_OCR_REVIEW_MODE, body.reviewMode().trim().toUpperCase());
        }
        if (body.autoAcceptConfidence() != null) {
            values.put(ConfigKey.DOCUMENT_OCR_AUTO_ACCEPT_CONFIDENCE, String.valueOf(body.autoAcceptConfidence()));
        }
        if (body.fieldMinConfidence() != null) {
            values.put(ConfigKey.DOCUMENT_OCR_FIELD_MIN_CONFIDENCE, String.valueOf(body.fieldMinConfidence()));
        }
        if (body.acceptExpired() != null) {
            values.put(ConfigKey.DOCUMENT_OCR_ACCEPT_EXPIRED, String.valueOf(body.acceptExpired()));
        }
        boolean clearRequired = body.requiredFields() != null && body.requiredFields().stream().allMatch(f -> f == null || f.isBlank());
        if (body.requiredFields() != null && !clearRequired) {
            values.put(ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS, String.join(",", body.requiredFields().stream()
                    .filter(f -> f != null && !f.isBlank()).map(String::trim).distinct().toList()));
        }
        for (Map.Entry<ConfigKey, String> e : values.entrySet()) {
            String error = e.getKey().validate(e.getValue());
            if (error != null) {
                throw invalid(e.getKey().key() + ": " + error);
            }
        }
        Map<String, ConfigParam> rows = tenantRows(tenantId);
        values.forEach((key, value) -> {
            ConfigParam p = rows.get(key.key());
            if (p == null) {
                p = new ConfigParam();
                p.setTenantId(tenantId);
                p.setFlowCode(Codes.FLOW_DOCUMENT_SCAN);
                p.setParamKey(key.key());
                p.setDescription(key.description());
            }
            p.setParamValue(value);
            repository.save(p);
        });
        if (clearRequired && rows.containsKey(ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS.key())) {
            repository.delete(rows.get(ConfigKey.DOCUMENT_OCR_REQUIRED_FIELDS.key()));
        }
        repository.flush();
        config.evict();
        log.info("Document OCR settings saved: tenantId={} values={}", tenantId, values);
        return tenantView(tenantId);
    }

    /** Deletes the tenant-wide settings, so the defaults apply again. */
    @Transactional
    public TenantOcrSettings resetTenant(Long tenantId) {
        tenantRows(tenantId).values().forEach(repository::delete);
        repository.flush();
        config.evict();
        log.info("Document OCR settings reset to defaults: tenantId={}", tenantId);
        return tenantView(tenantId);
    }

    private Map<String, ConfigParam> tenantRows(Long tenantId) {
        Map<String, ConfigParam> rows = new LinkedHashMap<>();
        List<String> keys = KEYS.stream().map(ConfigKey::key).toList();
        for (ConfigParam p : repository.findByTenantId(tenantId)) {
            if (keys.contains(p.getParamKey()) && Codes.FLOW_DOCUMENT_SCAN.equals(p.getFlowCode())
                    && p.getChannel() == null && p.getClientAppCode() == null) {
                rows.put(p.getParamKey(), p);
            }
        }
        return rows;
    }

    private static String value(Map<String, ConfigParam> rows, ConfigKey key, String fallback) {
        ConfigParam p = rows.get(key.key());
        return p != null && p.getParamValue() != null ? p.getParamValue().trim() : fallback;
    }

    private static double number(Map<String, ConfigParam> rows, ConfigKey key, double fallback) {
        try {
            String v = value(rows, key, null);
            return v == null ? fallback : Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    static List<String> split(String csv) {
        return csv == null || csv.isBlank() ? List.of()
                : Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }
}
