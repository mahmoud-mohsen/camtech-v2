package com.facetech.backend.platform;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.RefFlowDef;
import com.facetech.backend.domain.RefFlowStepDef;
import com.facetech.backend.domain.TenantEntitlement;
import com.facetech.backend.repository.RefFlowDefRepository;
import com.facetech.backend.repository.RefFlowStepDefRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What a client app may use right now: the tenant's entitlements narrowed by
 * the app's permissions, plus the settings its screens need. The same
 * resolver backs GET /v2/capabilities and the back-office preview, so the
 * app's view and the server's checks cannot disagree. Thresholds are never
 * included.
 */
@Service
@Slf4j
public class CapabilitiesService {

    /** Document types each flow accepts. */
    private static final Map<String, List<String>> FLOW_DOCUMENTS = Map.of(
            Codes.FLOW_SELFIE_ID, List.of("EMIRATES_ID", "PASSPORT"),
            Codes.FLOW_ONBOARDING, List.of("EMIRATES_ID", "PASSPORT"),
            Codes.FLOW_DOCUMENT_SCAN, List.of("EMIRATES_ID", "PASSPORT", "TRADE_LICENCE"));

    private final EntitlementService entitlements;
    private final ConfigService config;
    private final TenantService tenantService;
    private final RefFlowDefRepository flowRepository;
    private final RefFlowStepDefRepository stepRepository;
    private final LivenessSettingsService livenessSettings;

    public CapabilitiesService(EntitlementService entitlements, ConfigService config, TenantService tenantService,
                               RefFlowDefRepository flowRepository, RefFlowStepDefRepository stepRepository,
                               LivenessSettingsService livenessSettings) {
        this.entitlements = entitlements;
        this.config = config;
        this.tenantService = tenantService;
        this.flowRepository = flowRepository;
        this.stepRepository = stepRepository;
        this.livenessSettings = livenessSettings;
    }

    public Map<String, Object> forApp(ClientApp app) {
        List<TenantEntitlement> all = entitlements.entitlements();
        List<String> documents = new ArrayList<>();
        List<String> features = new ArrayList<>();
        for (TenantEntitlement e : all) {
            if (!entitlements.isAvailable(app.getId(), e.getFeatureType(), e.getFeatureCode())) {
                continue;
            }
            if (e.getFeatureType() == Codes.FeatureType.DOCUMENT) {
                documents.add(e.getFeatureCode());
            } else if (e.getFeatureType() == Codes.FeatureType.FEATURE) {
                features.add(e.getFeatureCode());
            }
        }

        List<Map<String, Object>> flows = new ArrayList<>();
        for (TenantEntitlement e : all) {
            if (e.getFeatureType() != Codes.FeatureType.FLOW
                    || !entitlements.isAvailable(app.getId(), Codes.FeatureType.FLOW, e.getFeatureCode())) {
                continue;
            }
            String flow = e.getFeatureCode();
            ConfigService.Scope scope = new ConfigService.Scope(flow, app.getChannel().name(), app.getCode());
            Map<String, Object> f = new LinkedHashMap<>();
            f.put("code", flow);
            f.put("documents", FLOW_DOCUMENTS.getOrDefault(flow, List.of()).stream().filter(documents::contains).toList());
            List<RefFlowStepDef> steps = flowRepository.findByCode(flow).map(RefFlowDef::getId)
                    .map(stepRepository::findByFlowIdOrderBySeqAsc).orElse(List.of());
            boolean dedup = duplicateSearchActive(app.getId(), scope);
            f.put("steps", steps.stream().map(RefFlowStepDef::getStepCode)
                    .filter(code -> dedup || !Codes.DEDUP_SEARCH.equals(code)).toList());

            Map<String, Object> settings = new LinkedHashMap<>();
            settings.put("livenessMaxAttempts", config.getInt(ConfigKey.LIVENESS_MAX_ATTEMPTS, scope, stepMax(steps, Codes.LIVENESS)));
            settings.put("documentMaxAttempts", config.getInt(ConfigKey.DOCUMENT_MAX_ATTEMPTS, scope, stepMax(steps, Codes.DOC_CAPTURE)));
            settings.put("sessionTtlMinutes", config.getInt(ConfigKey.SESSION_TTL_MINUTES, scope, 15));
            settings.put("deviceAntispoofRequired", config.getBoolean(ConfigKey.LIVENESS_DEVICE_ANTISPOOF_REQUIRED, scope));
            settings.put("fileUploadAllowed", config.getBoolean(ConfigKey.DOCUMENT_FILE_UPLOAD_ALLOWED, scope));
            if (Codes.FLOW_SELFIE_ID.equals(flow)) {
                // Whether this app may register the face during the verification (enrollFace).
                settings.put("faceEnrollmentAvailable",
                        entitlements.isAvailable(app.getId(), Codes.FeatureType.FLOW, Codes.FLOW_FACE_ENROLLMENT));
            }
            if (LivenessSettingsService.isLivenessFlow(flow)) {
                // Older apps read livenessChallengeRequired; it is false when they may still upload without a challenge.
                LivenessSettingsService.LivenessSettings liveness = livenessSettings.effective(app.getTenantId(), flow);
                settings.put("livenessChallengeRequired", !liveness.passive()
                        && !config.getBoolean(ConfigKey.LIVENESS_ALLOW_WITHOUT_CHALLENGE, scope));
                settings.put("livenessMode", liveness.mode());
                settings.put("challengeActions", liveness.actions());
                settings.put("challengeCount", liveness.challengeCount());
            } else {
                settings.put("livenessChallengeRequired", false);
            }
            f.put("settings", settings);

            Map<String, Object> quota = new LinkedHashMap<>();
            quota.put("perDay", e.getQuotaPerDay());
            quota.put("remainingToday", e.getQuotaPerDay() == null ? null
                    : Math.max(0, e.getQuotaPerDay() - entitlements.usedToday(flow)));
            f.put("quota", quota);
            flows.add(f);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tenant", tenantService.code(app.getTenantId()));
        out.put("clientApp", app.getCode());
        out.put("channel", app.getChannel().name());
        out.put("flows", flows);
        out.put("features", features);
        out.put("locales", List.of("en", "ar"));
        log.debug("Capabilities for app {} ({}): flows={} documents={} features={}", app.getCode(),
                app.getChannel(), flows.stream().map(f -> f.get("code")).toList(), documents, features);
        return out;
    }

    /**
     * Whether a flow's DEDUP_SEARCH step runs for this app: the feature is in the tenant's plan and allowed for the app
     * ({@code clientAppId} null = any app), and dedup.enabled is on for the scope.
     */
    public boolean duplicateSearchActive(Long clientAppId, ConfigService.Scope scope) {
        return entitlements.isAvailable(clientAppId, Codes.FeatureType.FEATURE, Codes.FEATURE_DEDUP)
                && config.getBoolean(ConfigKey.DEDUP_ENABLED, scope);
    }

    /** Short fingerprint for ETag / If-None-Match. */
    public String etag(Map<String, Object> capabilities) {
        return "\"" + Secrets.sha256Hex(String.valueOf(capabilities)).substring(0, 16) + "\"";
    }

    private static int stepMax(List<RefFlowStepDef> steps, String stepCode) {
        return steps.stream().filter(s -> s.getStepCode().equals(stepCode)).map(RefFlowStepDef::getMaxAttempts)
                .findFirst().orElse(1);
    }
}
