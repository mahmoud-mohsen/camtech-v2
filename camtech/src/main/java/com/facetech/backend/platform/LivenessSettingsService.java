package com.facetech.backend.platform;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.ConfigParam;
import com.facetech.backend.domain.FlowLivenessPolicy;
import com.facetech.backend.domain.RefFlowDef;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.repository.ConfigParamRepository;
import com.facetech.backend.repository.FlowLivenessPolicyRepository;
import com.facetech.backend.repository.RefFlowDefRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Liveness settings per flow. The back-office sets LIMITS per tenant and flow (flow_liveness_policy);
 * the tenant picks its SETTINGS inside them (mode, challenges, challenges per user), stored as
 * config_param rows scoped to the flow only (channel and client app empty). A tenant that saved
 * nothing gets the defaults of its policy; a tenant without a policy row gets the starting values.
 * Selfie ID verification (onboarding) is always ACTIVE.
 */
@Service
@Slf4j
public class LivenessSettingsService {

    /** Flows with a liveness step whose mode and challenges are configurable. */
    public static final List<String> LIVENESS_FLOWS = List.of(Codes.FLOW_SELFIE_ID, Codes.FLOW_FACE_AUTH,
            Codes.FLOW_LIVENESS_CHECK, Codes.FLOW_FACE_ENROLLMENT);
    /** Flows that are always ACTIVE: the ones that register a face (no passive-only registration). */
    public static final Set<String> ACTIVE_ONLY_FLOWS = Set.of(Codes.FLOW_SELFIE_ID, Codes.FLOW_FACE_ENROLLMENT);

    /**
     * Flows that run PASSIVE unless the tenant picks ACTIVE: they register nothing, so the anti-spoof model
     * alone is enough by default and the user sees no challenge.
     */
    public static final Set<String> PASSIVE_DEFAULT_FLOWS = Set.of(Codes.FLOW_FACE_AUTH, Codes.FLOW_LIVENESS_CHECK);

    /** Starting policy of the flows that register a face (ACTIVE only). */
    public static final LivenessPolicy STARTING_POLICY = new LivenessPolicy(List.of("ACTIVE"),
            ConfigKey.CHALLENGE_ACTIONS, 2, 4, true);
    /** Starting policy of {@link #PASSIVE_DEFAULT_FLOWS}: both modes, so the tenant can choose. */
    public static final LivenessPolicy STARTING_POLICY_BOTH_MODES = new LivenessPolicy(List.of("ACTIVE", "PASSIVE"),
            ConfigKey.CHALLENGE_ACTIONS, 2, 4, true);

    /** Starting policy for a tenant and liveness flow. */
    public static LivenessPolicy startingPolicy(String flowCode) {
        return PASSIVE_DEFAULT_FLOWS.contains(flowCode) ? STARTING_POLICY_BOTH_MODES : STARTING_POLICY;
    }

    private static final int MAX_ACTIONS = 7;
    /** The tenant setting keys (flow-scoped config_param rows). */
    private static final List<String> SETTING_KEYS = List.of(ConfigKey.LIVENESS_MODE.key(),
            ConfigKey.LIVENESS_CHALLENGE_ACTIONS.key(), ConfigKey.LIVENESS_CHALLENGE_STEPS.key());

    private final FlowLivenessPolicyRepository policyRepository;
    private final ConfigParamRepository configRepository;
    private final RefFlowDefRepository flowRepository;
    private final ConfigService config;

    public LivenessSettingsService(FlowLivenessPolicyRepository policyRepository, ConfigParamRepository configRepository,
                                   RefFlowDefRepository flowRepository, ConfigService config) {
        this.policyRepository = policyRepository;
        this.configRepository = configRepository;
        this.flowRepository = flowRepository;
        this.config = config;
    }

    /** Back-office limits for one tenant and flow. */
    public record LivenessPolicy(List<String> allowedModes, List<String> allowedActions, int minActions, int maxActions,
                                 boolean requireSpareAction) {
    }

    /** A tenant's settings for one flow. */
    public record LivenessSettings(String mode, List<String> actions, int challengeCount) {
        public boolean passive() {
            return "PASSIVE".equals(mode);
        }
    }

    /** PUT body of the tenant portal; null fields are refused. */
    public record SettingsUpdate(String mode, List<String> actions, Integer challengeCount) {
    }

    /** PUT body of the back-office. {@code resetTenant} deletes the tenant's settings for the flow. */
    public record PolicyUpdate(List<String> allowedModes, List<String> allowedActions, Integer minActions,
                               Integer maxActions, Boolean requireSpareAction, Boolean resetTenant) {
    }

    /** The first rule some settings break: {@code code} is the API error code. */
    public record Issue(String code, String message) {
    }

    public record TenantFlowLiveness(String flowCode, String flowName, String mode, List<String> actions,
                                     int challengeCount, LivenessPolicy policy, boolean customized, Instant updatedAt) {
    }

    public record AdminFlowLiveness(Long tenantId, String flowCode, String flowName, LivenessPolicy policy,
                                    LivenessSettings settings, boolean customized, Instant updatedAt) {
    }

    /** What the tenant saved for a flow (null fields = not saved). */
    private record Stored(String mode, List<String> actions, Integer challengeCount, String rawCount,
                          Instant updatedAt, List<ConfigParam> rows) {
        boolean customized() {
            return !rows.isEmpty();
        }
    }

    public static boolean isLivenessFlow(String flowCode) {
        return flowCode != null && LIVENESS_FLOWS.contains(flowCode);
    }

    // ================================================================ reading

    public LivenessPolicy policy(Long tenantId, String flowCode) {
        return policyRepository.findByTenantIdAndFlowCode(tenantId, flowCode).map(LivenessSettingsService::toPolicy)
                .orElse(startingPolicy(flowCode));
    }

    /**
     * The settings a verification of this flow runs with: the tenant's saved settings, with the policy
     * defaults for anything not saved. Saved settings the policy no longer allows (e.g. a row edited by
     * hand) are ignored with a warning, so a session never runs outside the limits.
     */
    public LivenessSettings effective(Long tenantId, String flowCode) {
        LivenessPolicy policy = policy(tenantId, flowCode);
        Stored stored = stored(tenantId, flowCode);
        LivenessSettings defaults = defaults(flowCode, policy);
        if (!stored.customized()) {
            return defaults;
        }
        LivenessSettings merged = merge(stored, defaults);
        Issue issue = merged == null ? new Issue("VALIDATION_ERROR", "unreadable value " + stored.rawCount())
                : validate(flowCode, merged, policy);
        if (issue != null) {
            log.warn("Liveness settings of tenant {} flow {} break the policy ({}: {}): policy defaults used",
                    tenantId, flowCode, issue.code(), issue.message());
            return defaults;
        }
        return merged;
    }

    public TenantFlowLiveness tenantView(Long tenantId, String flowCode) {
        LivenessPolicy policy = policy(tenantId, flowCode);
        Stored stored = stored(tenantId, flowCode);
        LivenessSettings s = effective(tenantId, flowCode);
        return new TenantFlowLiveness(flowCode, flowName(flowCode), s.mode(), s.actions(), s.challengeCount(), policy,
                stored.customized(), stored.updatedAt());
    }

    public AdminFlowLiveness adminView(Long tenantId, String flowCode) {
        Stored stored = stored(tenantId, flowCode);
        // updatedAt: when the tenant last changed its settings (null = never), as in the tenant view.
        return new AdminFlowLiveness(tenantId, flowCode, flowName(flowCode), policy(tenantId, flowCode),
                effective(tenantId, flowCode), stored.customized(), stored.updatedAt());
    }

    /**
     * Settings of a tenant that saved nothing: PASSIVE for {@link #PASSIVE_DEFAULT_FLOWS} when allowed, otherwise
     * ACTIVE (when allowed); every allowed challenge, the minimum count.
     */
    public static LivenessSettings defaults(String flowCode, LivenessPolicy policy) {
        String mode;
        if (ACTIVE_ONLY_FLOWS.contains(flowCode)) {
            mode = "ACTIVE";
        } else if (PASSIVE_DEFAULT_FLOWS.contains(flowCode) && policy.allowedModes().contains("PASSIVE")) {
            mode = "PASSIVE";
        } else {
            mode = policy.allowedModes().contains("ACTIVE") ? "ACTIVE" : policy.allowedModes().get(0);
        }
        return new LivenessSettings(mode, sortActions(policy.allowedActions()), policy.minActions());
    }

    // ================================================================ validation

    /**
     * First rule the settings break, or null. Same order and codes as the portal's inline check.
     * In PASSIVE mode no challenge is done, so the count rules do not apply.
     */
    public static Issue validate(String flowCode, LivenessSettings s, LivenessPolicy p) {
        if (!p.allowedModes().contains(s.mode()) || ("PASSIVE".equals(s.mode()) && ACTIVE_ONLY_FLOWS.contains(flowCode))) {
            return new Issue("MODE_NOT_ALLOWED", "Mode " + s.mode() + " is not allowed for this flow");
        }
        if (new HashSet<>(s.actions()).size() != s.actions().size()) {
            return new Issue("DUPLICATE_ACTION", "Each challenge can be selected only once");
        }
        String notAllowed = s.actions().stream().filter(a -> !p.allowedActions().contains(a)).findFirst().orElse(null);
        if (notAllowed != null) {
            return new Issue("ACTION_NOT_ALLOWED", "Challenge " + notAllowed + " is not allowed for this flow");
        }
        if (s.passive()) {
            return null;
        }
        if (s.challengeCount() < p.minActions() || s.challengeCount() > p.maxActions()) {
            return new Issue("COUNT_OUT_OF_RANGE",
                    "Challenges per user must be between " + p.minActions() + " and " + p.maxActions());
        }
        if (s.challengeCount() > s.actions().size()) {
            return new Issue("COUNT_EXCEEDS_SELECTION", "Challenges per user (" + s.challengeCount()
                    + ") cannot be more than the selected challenges (" + s.actions().size() + ")");
        }
        if (p.requireSpareAction() && s.actions().size() < s.challengeCount() + 1) {
            return new Issue("SPARE_ACTION_REQUIRED", "Select at least " + (s.challengeCount() + 1)
                    + " challenges: one more than each user does");
        }
        return null;
    }

    /** The tenant's body as settings, or 400 VALIDATION_ERROR for missing or unknown values. */
    static LivenessSettings parse(SettingsUpdate body) {
        if (body == null || body.mode() == null || body.actions() == null || body.challengeCount() == null) {
            throw invalid("mode, actions and challengeCount are required");
        }
        String mode = body.mode().trim().toUpperCase();
        if (!ConfigKey.LIVENESS_MODES.contains(mode)) {
            throw invalid("mode must be " + String.join(" or ", ConfigKey.LIVENESS_MODES));
        }
        List<String> actions = new ArrayList<>();
        for (String a : body.actions()) {
            String v = a == null ? "" : a.trim().toUpperCase();
            if (!ConfigKey.CHALLENGE_ACTIONS.contains(v)) {
                throw invalid("Unknown challenge '" + a + "': use " + String.join(", ", ConfigKey.CHALLENGE_ACTIONS));
            }
            actions.add(v);
        }
        return new LivenessSettings(mode, actions, body.challengeCount());
    }

    /** The back-office body as a policy, or 400 VALIDATION_ERROR / MODE_NOT_ALLOWED. */
    public static LivenessPolicy checkPolicy(String flowCode, PolicyUpdate body) {
        if (body == null) {
            throw invalid("A body is required");
        }
        if (body.allowedModes() == null || body.allowedModes().isEmpty()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "MODE_NOT_ALLOWED", "Allow at least one mode");
        }
        List<String> modes = new ArrayList<>();
        for (String m : body.allowedModes()) {
            String v = m == null ? "" : m.trim().toUpperCase();
            if (!ConfigKey.LIVENESS_MODES.contains(v)) {
                throw invalid("Unknown mode '" + m + "': use " + String.join(" or ", ConfigKey.LIVENESS_MODES));
            }
            if (!modes.contains(v)) {
                modes.add(v);
            }
        }
        if (modes.contains("PASSIVE") && ACTIVE_ONLY_FLOWS.contains(flowCode)) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "MODE_NOT_ALLOWED",
                    "Selfie ID verification always uses active liveness: PASSIVE cannot be allowed");
        }
        if (body.allowedActions() == null || body.allowedActions().isEmpty()) {
            throw invalid("Allow at least one challenge");
        }
        List<String> actions = new ArrayList<>();
        for (String a : body.allowedActions()) {
            String v = a == null ? "" : a.trim().toUpperCase();
            if (!ConfigKey.CHALLENGE_ACTIONS.contains(v)) {
                throw invalid("Unknown challenge '" + a + "': use " + String.join(", ", ConfigKey.CHALLENGE_ACTIONS));
            }
            if (actions.contains(v)) {
                throw invalid("Challenge " + v + " is listed twice");
            }
            actions.add(v);
        }
        if (body.minActions() == null || body.maxActions() == null) {
            throw invalid("minActions and maxActions are required");
        }
        int min = body.minActions();
        int max = body.maxActions();
        if (min < 1 || min > MAX_ACTIONS) {
            throw invalid("minActions must be between 1 and " + MAX_ACTIONS);
        }
        if (max < min || max > MAX_ACTIONS) {
            throw invalid("maxActions must be between minActions (" + min + ") and " + MAX_ACTIONS);
        }
        boolean spare = body.requireSpareAction() == null || body.requireSpareAction();
        int needed = min + (spare ? 1 : 0);
        if (actions.size() < needed) {
            throw invalid("Allow at least " + needed + " challenges" + (spare ? " (minActions plus a spare one)" : ""));
        }
        return new LivenessPolicy(sortModes(modes), sortActions(actions), min, max, spare);
    }

    // ================================================================ writing

    /** Saves the tenant's settings for a flow (400 with the rule's code when the policy does not allow them). */
    @Transactional
    public LivenessSettings saveTenant(Long tenantId, String flowCode, SettingsUpdate body) {
        LivenessSettings s = parse(body);
        LivenessPolicy policy = policy(tenantId, flowCode);
        Issue issue = validate(flowCode, s, policy);
        if (issue != null) {
            log.debug("Liveness settings of tenant {} flow {} refused: {} ({})", tenantId, flowCode, issue.code(),
                    issue.message());
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, issue.code(), issue.message());
        }
        LivenessSettings saved = new LivenessSettings(s.mode(), sortActions(s.actions()), s.challengeCount());
        Map<String, ConfigParam> existing = new LinkedHashMap<>();
        stored(tenantId, flowCode, true).rows().forEach(p -> existing.put(p.getParamKey(), p));
        upsert(existing, tenantId, flowCode, ConfigKey.LIVENESS_MODE, saved.mode());
        upsert(existing, tenantId, flowCode, ConfigKey.LIVENESS_CHALLENGE_ACTIONS, String.join(",", saved.actions()));
        upsert(existing, tenantId, flowCode, ConfigKey.LIVENESS_CHALLENGE_STEPS, String.valueOf(saved.challengeCount()));
        configRepository.flush();
        config.evict();
        log.info("Liveness settings saved: tenantId={} flow={} mode={} actions={} challengeCount={}", tenantId, flowCode,
                saved.mode(), saved.actions(), saved.challengeCount());
        return saved;
    }

    /**
     * Saves the back-office limits. When the tenant's saved settings would break them: 409
     * TENANT_SETTINGS_CONFLICT, unless {@code resetTenant} (which always deletes the tenant's settings
     * for the flow, so the new policy's defaults apply).
     */
    @Transactional
    public FlowLivenessPolicy savePolicy(Long tenantId, String flowCode, PolicyUpdate body) {
        LivenessPolicy policy = checkPolicy(flowCode, body);
        boolean reset = Boolean.TRUE.equals(body.resetTenant());
        Stored stored = stored(tenantId, flowCode, true);
        if (reset) {
            resetTenant(tenantId, flowCode);
        } else if (stored.customized()) {
            LivenessSettings merged = merge(stored, defaults(flowCode, policy));
            Issue issue = merged == null ? new Issue("VALIDATION_ERROR", "unreadable saved value")
                    : validate(flowCode, merged, policy);
            if (issue != null) {
                throw new FaceMatchException(HttpStatus.CONFLICT, "TENANT_SETTINGS_CONFLICT",
                        "The tenant's saved settings would break the new limits (" + issue.message()
                                + "). Send resetTenant=true to reset them to the defaults.")
                        .with("reason", issue.code());
            }
        }
        FlowLivenessPolicy row = policyRepository.findByTenantIdAndFlowCode(tenantId, flowCode).orElseGet(() -> {
            FlowLivenessPolicy p = new FlowLivenessPolicy();
            p.setTenantId(tenantId);
            p.setFlowCode(flowCode);
            return p;
        });
        apply(row, policy);
        policyRepository.saveAndFlush(row);
        log.info("Liveness policy saved: tenantId={} flow={} allowedModes={} allowedActions={} actions {}..{} "
                        + "requireSpareAction={} resetTenant={}", tenantId, flowCode, policy.allowedModes(),
                policy.allowedActions(), policy.minActions(), policy.maxActions(), policy.requireSpareAction(), reset);
        return row;
    }

    /** Deletes the tenant's settings for a flow (the policy defaults apply again). */
    @Transactional
    public int resetTenant(Long tenantId, String flowCode) {
        List<ConfigParam> rows = stored(tenantId, flowCode, true).rows();
        configRepository.deleteAll(rows);
        configRepository.flush();
        config.evict();
        log.info("Liveness settings reset: tenantId={} flow={} rowsDeleted={}", tenantId, flowCode, rows.size());
        return rows.size();
    }

    /**
     * Policy rows of a new tenant: a copy of the template tenant's (so settings copied from the template stay
     * valid), and the starting values for any liveness flow the template has no row for.
     */
    @Transactional
    public void provision(Long tenantId, Long templateTenantId) {
        Map<String, FlowLivenessPolicy> template = new LinkedHashMap<>();
        if (templateTenantId != null) {
            policyRepository.findByTenantId(templateTenantId).forEach(p -> template.put(p.getFlowCode(), p));
        }
        for (String flow : LIVENESS_FLOWS) {
            FlowLivenessPolicy src = template.get(flow);
            FlowLivenessPolicy row = new FlowLivenessPolicy();
            row.setTenantId(tenantId);
            row.setFlowCode(flow);
            apply(row, src != null ? toPolicy(src) : startingPolicy(flow));
            policyRepository.save(row);
        }
        log.debug("Liveness policies created for tenant {} (template tenant {} had {})", tenantId, templateTenantId,
                template.keySet());
    }

    // ================================================================ helpers

    private Stored stored(Long tenantId, String flowCode) {
        return stored(tenantId, flowCode, false);
    }

    /** {@code fresh}: read the rows from the database (before changing them) instead of the config cache. */
    private Stored stored(Long tenantId, String flowCode, boolean fresh) {
        List<ConfigParam> all = fresh ? configRepository.findByTenantId(tenantId) : config.tenantRows(tenantId);
        List<ConfigParam> rows = all.stream()
                .filter(p -> flowCode.equals(p.getFlowCode()) && p.getChannel() == null && p.getClientAppCode() == null
                        && SETTING_KEYS.contains(p.getParamKey()))
                .toList();
        String mode = null;
        List<String> actions = null;
        Integer count = null;
        String rawCount = null;
        Instant updatedAt = null;
        for (ConfigParam p : rows) {
            String v = p.getParamValue() == null ? "" : p.getParamValue().trim();
            if (p.getParamKey().equals(ConfigKey.LIVENESS_MODE.key())) {
                mode = v.toUpperCase();
            } else if (p.getParamKey().equals(ConfigKey.LIVENESS_CHALLENGE_ACTIONS.key())) {
                actions = v.isEmpty() ? List.of() : Arrays.stream(v.split(",")).map(String::trim)
                        .map(String::toUpperCase).toList();
            } else {
                rawCount = v;
                try {
                    count = Integer.parseInt(v);
                } catch (NumberFormatException e) {
                    count = null;
                }
            }
            if (p.getUpdatedAt() != null && (updatedAt == null || p.getUpdatedAt().isAfter(updatedAt))) {
                updatedAt = p.getUpdatedAt();
            }
        }
        return new Stored(mode, actions, count, rawCount, updatedAt, rows);
    }

    /** Saved values over the defaults; null when a saved count cannot be read. */
    private static LivenessSettings merge(Stored stored, LivenessSettings defaults) {
        if (stored.rawCount() != null && stored.challengeCount() == null) {
            return null;
        }
        return new LivenessSettings(
                stored.mode() != null ? stored.mode() : defaults.mode(),
                stored.actions() != null ? stored.actions() : defaults.actions(),
                stored.challengeCount() != null ? stored.challengeCount() : defaults.challengeCount());
    }

    private void upsert(Map<String, ConfigParam> existing, Long tenantId, String flowCode, ConfigKey key, String value) {
        ConfigParam p = existing.get(key.key());
        if (p == null) {
            p = new ConfigParam();
            p.setTenantId(tenantId);
            p.setFlowCode(flowCode);
            p.setParamKey(key.key());
            p.setDescription(key.description());
        }
        p.setParamValue(value);
        configRepository.save(p);
    }

    private String flowName(String flowCode) {
        return flowRepository.findByCode(flowCode).map(RefFlowDef::getName).orElse(flowCode);
    }

    private static void apply(FlowLivenessPolicy row, LivenessPolicy p) {
        row.setAllowedModes(String.join(",", p.allowedModes()));
        row.setAllowedActions(String.join(",", p.allowedActions()));
        row.setMinActions(p.minActions());
        row.setMaxActions(p.maxActions());
        row.setRequireSpareAction(p.requireSpareAction());
    }

    private static LivenessPolicy toPolicy(FlowLivenessPolicy row) {
        return new LivenessPolicy(split(row.getAllowedModes()), split(row.getAllowedActions()), row.getMinActions(),
                row.getMaxActions(), row.isRequireSpareAction());
    }

    private static List<String> split(String csv) {
        return csv == null || csv.isBlank() ? List.of()
                : Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    /** Actions in display order (the order of {@link ConfigKey#CHALLENGE_ACTIONS}), duplicates removed. */
    static List<String> sortActions(List<String> actions) {
        return actions.stream().filter(Objects::nonNull).distinct()
                .sorted(Comparator.comparingInt(a -> {
                    int i = ConfigKey.CHALLENGE_ACTIONS.indexOf(a);
                    return i < 0 ? Integer.MAX_VALUE : i;
                })).toList();
    }

    private static List<String> sortModes(List<String> modes) {
        return List.of("ACTIVE", "PASSIVE").stream().filter(modes::contains).toList();
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }
}
