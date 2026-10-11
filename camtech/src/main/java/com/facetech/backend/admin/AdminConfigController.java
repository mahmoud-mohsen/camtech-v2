package com.facetech.backend.admin;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.ClientAppPermission;
import com.facetech.backend.domain.ClientCredential;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.ConfigParam;
import com.facetech.backend.domain.RefDocumentType;
import com.facetech.backend.domain.RefFlowDef;
import com.facetech.backend.domain.RefFlowStepDef;
import com.facetech.backend.domain.RefIssuer;
import com.facetech.backend.domain.RefReasonCode;
import com.facetech.backend.domain.RetentionPolicy;
import com.facetech.backend.domain.Tenant;
import com.facetech.backend.domain.TenantEntitlement;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.CapabilitiesService;
import com.facetech.backend.platform.ClientAuthService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.ReasonCatalog;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.repository.ClientAppPermissionRepository;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.ClientCredentialRepository;
import com.facetech.backend.repository.ConfigParamRepository;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.repository.RefFlowDefRepository;
import com.facetech.backend.repository.RefFlowStepDefRepository;
import com.facetech.backend.repository.RefIssuerRepository;
import com.facetech.backend.repository.RefReasonCodeRepository;
import com.facetech.backend.repository.RetentionPolicyRepository;
import com.facetech.backend.repository.TenantEntitlementRepository;
import com.facetech.backend.verification.SessionSupport;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Tenant, entitlements, client apps, settings, flows, messages and data retention. */
@Slf4j
@RestController
@RequestMapping("/v2/admin")
public class AdminConfigController {

    private final TenantService tenantService;
    private final TenantEntitlementRepository entitlementRepository;
    private final ClientAppRepository clientAppRepository;
    private final ClientAppPermissionRepository permissionRepository;
    private final ClientCredentialRepository credentialRepository;
    private final ConfigParamRepository configRepository;
    private final RefFlowDefRepository flowRepository;
    private final RefFlowStepDefRepository stepRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final RefIssuerRepository issuerRepository;
    private final RefReasonCodeRepository reasonRepository;
    private final RetentionPolicyRepository retentionRepository;
    private final EntitlementService entitlements;
    private final ConfigService config;
    private final CapabilitiesService capabilities;
    private final ClientAuthService clientAuth;
    private final ReasonCatalog reasonCatalog;
    private final AuditService audit;

    public AdminConfigController(TenantService tenantService, TenantEntitlementRepository entitlementRepository,
                                 ClientAppRepository clientAppRepository, ClientAppPermissionRepository permissionRepository,
                                 ClientCredentialRepository credentialRepository, ConfigParamRepository configRepository,
                                 RefFlowDefRepository flowRepository, RefFlowStepDefRepository stepRepository,
                                 RefDocumentTypeRepository docTypeRepository, RefIssuerRepository issuerRepository,
                                 RefReasonCodeRepository reasonRepository, RetentionPolicyRepository retentionRepository,
                                 EntitlementService entitlements, ConfigService config, CapabilitiesService capabilities,
                                 ClientAuthService clientAuth, ReasonCatalog reasonCatalog, AuditService audit) {
        this.tenantService = tenantService;
        this.entitlementRepository = entitlementRepository;
        this.clientAppRepository = clientAppRepository;
        this.permissionRepository = permissionRepository;
        this.credentialRepository = credentialRepository;
        this.configRepository = configRepository;
        this.flowRepository = flowRepository;
        this.stepRepository = stepRepository;
        this.docTypeRepository = docTypeRepository;
        this.issuerRepository = issuerRepository;
        this.reasonRepository = reasonRepository;
        this.retentionRepository = retentionRepository;
        this.entitlements = entitlements;
        this.config = config;
        this.capabilities = capabilities;
        this.clientAuth = clientAuth;
        this.reasonCatalog = reasonCatalog;
        this.audit = audit;
    }

    // ================================================================ tenant and entitlements

    public record TenantView(Long id, String code, String name, String status, Instant createdAt) {
    }

    public record EntitlementView(Long id, String featureType, String featureCode, boolean enabled, Long quotaPerDay,
                                  long usedToday, LocalDate validUntil) {
    }

    public record EntitlementUpdate(Boolean enabled, Long quotaPerDay, String validUntil) {
    }

    @GetMapping("/tenant")
    public TenantView tenant() {
        Tenant t = tenantService.tenant();
        return new TenantView(t.getId(), t.getCode(), t.getName(), t.getStatus(), t.getCreatedAt());
    }

    @GetMapping("/entitlements")
    @Transactional(readOnly = true)
    public List<EntitlementView> entitlements() {
        return entitlementRepository.findByTenantIdOrderByFeatureTypeAscFeatureCodeAsc(tenantId()).stream()
                .map(this::entitlement).toList();
    }

    @PutMapping("/entitlements/{id}")
    @Transactional
    public EntitlementView updateEntitlement(@PathVariable Long id, @RequestBody EntitlementUpdate body) {
        TenantEntitlement e = entitlementRepository.findById(id).filter(x -> x.getTenantId().equals(tenantId()))
                .orElseThrow(() -> notFound("Entitlement"));
        if (body.quotaPerDay() != null && body.quotaPerDay() < 0) {
            throw invalid("The daily quota cannot be negative");
        }
        boolean oldEnabled = e.isEnabled();
        Long oldQuota = e.getQuotaPerDay();
        LocalDate oldValidUntil = e.getValidUntil();
        if (body.enabled() != null) {
            e.setEnabled(body.enabled());
        }
        e.setQuotaPerDay(body.quotaPerDay());
        e.setValidUntil(AdminParams.date(body.validUntil()));
        entitlementRepository.saveAndFlush(e);
        entitlements.evict();
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("feature", e.getFeatureCode());
        details.put("enabled", e.isEnabled());
        details.put("quotaPerDay", e.getQuotaPerDay() == null ? "unlimited" : e.getQuotaPerDay());
        audit.record("ENTITLEMENT_UPDATED", "tenant_entitlement", e.getId(), details);
        log.info("Entitlement updated by {}: tenantId={} entitlementId={} feature={} enabled {}->{} "
                        + "quotaPerDay {}->{} validUntil {}->{}", actor(), tenantId(), e.getId(), e.getFeatureCode(),
                oldEnabled, e.isEnabled(), oldQuota, e.getQuotaPerDay(), oldValidUntil, e.getValidUntil());
        return entitlement(e);
    }

    private EntitlementView entitlement(TenantEntitlement e) {
        return new EntitlementView(e.getId(), e.getFeatureType().name(), e.getFeatureCode(), e.isEnabled(),
                e.getQuotaPerDay(), entitlements.usedToday(e.getFeatureCode()), e.getValidUntil());
    }

    // ================================================================ client apps

    public record PermissionView(String featureCode, boolean allowed) {
    }

    public record ClientAppView(Long id, String code, String name, String channel, String platform, String appIdentifier,
                                List<String> allowedOrigins, String status, List<PermissionView> permissions,
                                long credentialsCount, Instant createdAt) {
    }

    public record ClientAppCreate(String code, String name, String channel, String platform, String appIdentifier,
                                  List<String> allowedOrigins) {
    }

    public record ClientAppUpdate(String name, String platform, String appIdentifier, List<String> allowedOrigins,
                                  String status) {
    }

    public record CredentialView(Long id, String keyId, String status, Instant createdAt, Instant expiresAt,
                                 Instant lastUsedAt) {
    }

    public record CredentialCreate(String expiresAt) {
    }

    public record CreatedCredential(CredentialView credential, String secret) {
    }

    @GetMapping("/client-apps")
    @Transactional(readOnly = true)
    public List<ClientAppView> clientApps() {
        return clientAppRepository.findByTenantIdOrderByCode(tenantId()).stream().map(this::clientApp).toList();
    }

    @PostMapping("/client-apps")
    @Transactional
    public ResponseEntity<ClientAppView> createClientApp(@RequestBody ClientAppCreate body) {
        String code = AdminParams.required(body.code(), "code").toUpperCase();
        if (!code.matches("[A-Z0-9_]{2,50}")) {
            throw invalid("Code: 2-50 capital letters, digits or underscores");
        }
        if (clientAppRepository.findByTenantIdAndCode(tenantId(), code).isPresent()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "CODE_TAKEN", "A client app with this code exists");
        }
        ClientApp app = new ClientApp();
        app.setTenantId(tenantId());
        app.setCode(code);
        app.setName(AdminParams.required(body.name(), "name"));
        app.setChannel(AdminParams.enumOrNull(Codes.Channel.class, AdminParams.required(body.channel(), "channel")));
        app.setPlatform(AdminParams.blankToNull(body.platform()));
        app.setAppIdentifier(AdminParams.blankToNull(body.appIdentifier()));
        app.setAllowedOrigins(origins(body.allowedOrigins()));
        app.setStatus(Codes.ActiveStatus.ACTIVE);
        clientAppRepository.save(app);
        audit.record("CLIENT_APP_CREATED", "client_app", app.getCode(), null);
        log.info("Client app created by {}: tenantId={} clientAppId={} code={} channel={}",
                actor(), tenantId(), app.getId(), app.getCode(), app.getChannel());
        return ResponseEntity.status(HttpStatus.CREATED).body(clientApp(app));
    }

    @PutMapping("/client-apps/{id}")
    @Transactional
    public ClientAppView updateClientApp(@PathVariable Long id, @RequestBody ClientAppUpdate body) {
        ClientApp app = app(id);
        Codes.ActiveStatus oldStatus = app.getStatus();
        if (body.name() != null) {
            app.setName(AdminParams.required(body.name(), "name"));
        }
        app.setPlatform(AdminParams.blankToNull(body.platform()));
        app.setAppIdentifier(AdminParams.blankToNull(body.appIdentifier()));
        app.setAllowedOrigins(origins(body.allowedOrigins()));
        if (body.status() != null) {
            app.setStatus(AdminParams.enumOrNull(Codes.ActiveStatus.class, body.status()));
        }
        clientAuth.evict();
        audit.record("CLIENT_APP_UPDATED", "client_app", app.getCode(), Map.of("status", app.getStatus().name()));
        log.info("Client app updated by {}: clientAppId={} code={} status {}->{} allowedOrigins={}",
                actor(), app.getId(), app.getCode(), oldStatus, app.getStatus(), app.getAllowedOrigins());
        return clientApp(app);
    }

    @PutMapping("/client-apps/{id}/permissions")
    @Transactional
    public ClientAppView updatePermissions(@PathVariable Long id, @RequestBody List<PermissionView> body) {
        ClientApp app = app(id);
        Map<String, ClientAppPermission> existing = permissionRepository.findByClientAppId(id).stream()
                .collect(Collectors.toMap(ClientAppPermission::getFeatureCode, Function.identity()));
        for (PermissionView p : body) {
            ClientAppPermission row = existing.get(p.featureCode());
            if (row == null) {
                row = new ClientAppPermission();
                row.setTenantId(app.getTenantId());
                row.setClientAppId(id);
                row.setFeatureCode(p.featureCode());
            }
            row.setAllowed(p.allowed());
            permissionRepository.save(row);
        }
        permissionRepository.flush();
        entitlements.evict();
        audit.record("CLIENT_APP_PERMISSIONS_UPDATED", "client_app", app.getCode(),
                Map.of("denied", body.stream().filter(p -> !p.allowed()).map(PermissionView::featureCode).toList()));
        log.info("Client app permissions updated by {}: clientAppId={} code={} changed={} denied={}",
                actor(), app.getId(), app.getCode(), body.size(),
                body.stream().filter(p -> !p.allowed()).map(PermissionView::featureCode).toList());
        return clientApp(app);
    }

    @GetMapping("/client-apps/{id}/credentials")
    @Transactional(readOnly = true)
    public List<CredentialView> credentials(@PathVariable Long id) {
        app(id);
        return credentialRepository.findByClientAppIdOrderByCreatedAtDesc(id).stream().map(AdminConfigController::credential).toList();
    }

    @PostMapping("/client-apps/{id}/credentials")
    @Transactional
    public ResponseEntity<CreatedCredential> createCredential(@PathVariable Long id,
                                                              @RequestBody(required = false) CredentialCreate body) {
        ClientApp app = app(id);
        String secret = Secrets.token(32);
        ClientCredential c = new ClientCredential();
        c.setTenantId(app.getTenantId());
        c.setClientAppId(id);
        c.setKeyId("ck_" + Secrets.token(9).replace("-", "x").replace("_", "y"));
        c.setSecretHash(clientAuth.hash(secret));
        c.setStatus(Codes.CredentialStatus.ACTIVE);
        String expires = body != null ? AdminParams.blankToNull(body.expiresAt()) : null;
        if (expires != null) {
            c.setExpiresAt(AdminParams.endOfDay(expires));
        }
        credentialRepository.save(c);
        audit.record("CLIENT_CREDENTIAL_CREATED", "client_app", app.getCode(), Map.of("keyId", c.getKeyId()));
        log.info("Client credential created by {}: clientAppId={} code={} credentialId={} keyId={} expiresAt={}",
                actor(), app.getId(), app.getCode(), c.getId(), c.getKeyId(), c.getExpiresAt());
        return ResponseEntity.status(HttpStatus.CREATED).body(new CreatedCredential(credential(c), secret));
    }

    @PostMapping("/credentials/{id}/revoke")
    @Transactional
    public CredentialView revokeCredential(@PathVariable Long id) {
        ClientCredential c = credentialRepository.findById(id).filter(x -> x.getTenantId().equals(tenantId()))
                .orElseThrow(() -> notFound("Credential"));
        c.setStatus(Codes.CredentialStatus.REVOKED);
        clientAuth.evict();
        audit.record("CLIENT_CREDENTIAL_REVOKED", "client_credential", c.getKeyId(), null);
        log.info("Client credential revoked by {}: credentialId={} clientAppId={} keyId={}",
                actor(), c.getId(), c.getClientAppId(), c.getKeyId());
        return credential(c);
    }

    @GetMapping("/client-apps/{id}/capabilities")
    @Transactional(readOnly = true)
    public Map<String, Object> capabilities(@PathVariable Long id) {
        return capabilities.forApp(app(id));
    }

    private ClientAppView clientApp(ClientApp app) {
        Map<String, Boolean> explicit = permissionRepository.findByClientAppId(app.getId()).stream()
                .collect(Collectors.toMap(ClientAppPermission::getFeatureCode, ClientAppPermission::isAllowed));
        List<PermissionView> permissions = entitlementRepository.findByTenantIdOrderByFeatureTypeAscFeatureCodeAsc(app.getTenantId())
                .stream().map(e -> new PermissionView(e.getFeatureCode(), explicit.getOrDefault(e.getFeatureCode(), true)))
                .toList();
        List<String> origins = app.getAllowedOrigins() == null || app.getAllowedOrigins().isBlank() ? List.of()
                : Arrays.stream(app.getAllowedOrigins().split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        return new ClientAppView(app.getId(), app.getCode(), app.getName(), app.getChannel().name(), app.getPlatform(),
                app.getAppIdentifier(), origins, app.getStatus().name(), permissions,
                credentialRepository.countByClientAppIdAndStatus(app.getId(), Codes.CredentialStatus.ACTIVE), app.getCreatedAt());
    }

    private static CredentialView credential(ClientCredential c) {
        return new CredentialView(c.getId(), c.getKeyId(), c.getStatus().name(), c.getCreatedAt(), c.getExpiresAt(),
                c.getLastUsedAt());
    }

    private ClientApp app(Long id) {
        return clientAppRepository.findById(id).filter(a -> a.getTenantId().equals(tenantId()))
                .orElseThrow(() -> notFound("Client app"));
    }

    private static String origins(List<String> origins) {
        if (origins == null || origins.isEmpty()) {
            return null;
        }
        String joined = origins.stream().map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.joining(","));
        if (joined.length() > 2000) {
            throw invalid("Too many allowed origins");
        }
        return joined.isEmpty() ? null : joined;
    }

    // ================================================================ settings

    public record ConfigKeyView(String key, String description, String type, String defaultValue, Double min, Double max) {
    }

    public record ConfigParamView(Long id, String flowCode, String channel, String clientAppCode, String paramKey,
                                  String paramValue, String description, Instant updatedAt, String updatedBy) {
    }

    public record ConfigParamCreate(String flowCode, String channel, String clientAppCode, String paramKey, String paramValue) {
    }

    public record ConfigParamUpdate(String paramValue) {
    }

    @GetMapping("/config-keys")
    public List<ConfigKeyView> configKeys() {
        return Arrays.stream(ConfigKey.values()).map(k -> new ConfigKeyView(k.key(), k.description(), k.type().name(),
                k.defaultValue() != null ? k.defaultValue() : "", k.min(), k.max())).toList();
    }

    @GetMapping("/config-params")
    @Transactional(readOnly = true)
    public List<ConfigParamView> configParams() {
        return configRepository.findByTenantId(tenantId()).stream()
                .sorted(Comparator.comparing(ConfigParam::getParamKey).thenComparing(p -> scopeRank(p)))
                .map(AdminConfigController::param).toList();
    }

    @PostMapping("/config-params")
    @Transactional
    public ResponseEntity<ConfigParamView> createConfigParam(@RequestBody ConfigParamCreate body) {
        ConfigKey key = ConfigKey.fromKey(AdminParams.required(body.paramKey(), "paramKey"));
        if (key == null) {
            throw invalid("Unknown setting " + body.paramKey());
        }
        if (key == ConfigKey.LIVENESS_MODE || key == ConfigKey.LIVENESS_CHALLENGE_ACTIONS
                || key == ConfigKey.LIVENESS_CHALLENGE_STEPS) {
            throw invalid(key.key() + " is a tenant setting per flow: the tenant sets it in the portal, "
                    + "within the flow's liveness policy");
        }
        String value = validValue(key, body.paramValue());
        String flow = AdminParams.blankToNull(body.flowCode());
        String channel = AdminParams.blankToNull(body.channel());
        String app = AdminParams.blankToNull(body.clientAppCode());
        if (flow != null && entitlementRepository.findByTenantIdAndFeatureTypeAndFeatureCode(tenantId(), Codes.FeatureType.FLOW, flow).isEmpty()) {
            throw invalid("Unknown flow " + flow);
        }
        if (channel != null) {
            AdminParams.enumOrNull(Codes.Channel.class, channel);
        }
        if (app != null && clientAppRepository.findByTenantIdAndCode(tenantId(), app).isEmpty()) {
            throw invalid("Unknown client app " + app);
        }
        boolean exists = configRepository.findByTenantId(tenantId()).stream().anyMatch(p -> p.getParamKey().equals(key.key())
                && eq(p.getFlowCode(), flow) && eq(p.getChannel(), channel) && eq(p.getClientAppCode(), app));
        if (exists) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "ALREADY_EXISTS", "This setting already has a value for that scope; edit it instead");
        }
        ConfigParam p = new ConfigParam();
        p.setTenantId(tenantId());
        p.setFlowCode(flow);
        p.setChannel(channel != null ? channel.toUpperCase() : null);
        p.setClientAppCode(app);
        p.setParamKey(key.key());
        p.setParamValue(value);
        p.setDescription(key.description());
        configRepository.saveAndFlush(p);
        config.evict();
        audit.record("SETTING_CREATED", "config_param", p.getId(), scope(p));
        log.info("Setting created by {}: tenantId={} paramId={} key={} scope[flow={} channel={} app={}] value={}",
                actor(), tenantId(), p.getId(), p.getParamKey(), p.getFlowCode(), p.getChannel(), p.getClientAppCode(),
                loggable(p.getParamKey(), p.getParamValue()));
        return ResponseEntity.status(HttpStatus.CREATED).body(param(p));
    }

    @PutMapping("/config-params/{id}")
    @Transactional
    public ConfigParamView updateConfigParam(@PathVariable Long id, @RequestBody ConfigParamUpdate body) {
        ConfigParam p = configParam(id);
        ConfigKey key = ConfigKey.fromKey(p.getParamKey());
        String old = p.getParamValue();
        p.setParamValue(key != null ? validValue(key, body.paramValue()) : AdminParams.required(body.paramValue(), "paramValue"));
        configRepository.saveAndFlush(p);
        config.evict();
        Map<String, Object> details = scope(p);
        details.put("from", old);
        details.put("to", p.getParamValue());
        audit.record("SETTING_UPDATED", "config_param", p.getId(), details);
        log.info("Setting updated by {}: tenantId={} paramId={} key={} scope[flow={} channel={} app={}] {}->{}",
                actor(), tenantId(), p.getId(), p.getParamKey(), p.getFlowCode(), p.getChannel(), p.getClientAppCode(),
                loggable(p.getParamKey(), old), loggable(p.getParamKey(), p.getParamValue()));
        return param(p);
    }

    @DeleteMapping("/config-params/{id}")
    @Transactional
    public ResponseEntity<Void> deleteConfigParam(@PathVariable Long id) {
        ConfigParam p = configParam(id);
        if (p.getFlowCode() == null && p.getChannel() == null && p.getClientAppCode() == null) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "BASE_SETTING", "The base value of a setting cannot be deleted; change it instead");
        }
        configRepository.delete(p);
        configRepository.flush();
        config.evict();
        audit.record("SETTING_DELETED", "config_param", p.getId(), scope(p));
        log.info("Setting override deleted by {}: tenantId={} paramId={} key={} scope[flow={} channel={} app={}] value={}",
                actor(), tenantId(), p.getId(), p.getParamKey(), p.getFlowCode(), p.getChannel(), p.getClientAppCode(),
                loggable(p.getParamKey(), p.getParamValue()));
        return ResponseEntity.noContent().build();
    }

    private ConfigParam configParam(Long id) {
        return configRepository.findById(id).filter(p -> p.getTenantId().equals(tenantId()))
                .orElseThrow(() -> notFound("Setting"));
    }

    private static String validValue(ConfigKey key, String raw) {
        String error = key.validate(raw);
        if (error != null) {
            throw invalid(key.key() + ": " + error);
        }
        return raw.trim();
    }

    private static ConfigParamView param(ConfigParam p) {
        return new ConfigParamView(p.getId(), p.getFlowCode(), p.getChannel(), p.getClientAppCode(), p.getParamKey(),
                p.getParamValue(), p.getDescription(), p.getUpdatedAt(), p.getUpdatedBy());
    }

    private static Map<String, Object> scope(ConfigParam p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", p.getParamKey());
        m.put("flow", p.getFlowCode());
        m.put("channel", p.getChannel());
        m.put("clientApp", p.getClientAppCode());
        m.put("value", p.getParamValue());
        m.values().removeIf(v -> v == null);
        return m;
    }

    private static int scopeRank(ConfigParam p) {
        return (p.getClientAppCode() != null ? 4 : 0) + (p.getChannel() != null ? 2 : 0) + (p.getFlowCode() != null ? 1 : 0);
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equalsIgnoreCase(b);
    }

    // ================================================================ flows and reference data

    /**
     * {@code maxAttemptsUsed}: false when the step runs once and its max attempts has no effect.
     * {@code tenantSwitch}: the setting a tenant turns the step on or off with (with the matching feature in its
     * plan), or null when the step always runs. {@code mandatory} is kept for older clients; it is not enforced.
     */
    public record FlowStepView(Long id, int seq, String stepCode, boolean mandatory, int maxAttempts,
                               boolean maxAttemptsUsed, String tenantSwitch) {
    }

    /** Flow definitions are shared by every tenant. {@code enabled}: in this tenant's plan; {@code enabledTenants}: in how many plans. */
    public record FlowView(String code, String name, String description, boolean enabled, long enabledTenants,
                           List<FlowStepView> steps) {
    }

    public record FlowStepUpdate(Boolean mandatory, Integer maxAttempts) {
    }

    public record DocumentTypeView(Long id, String code, String name, int sides, boolean hasMrz, boolean hasFacePhoto,
                                   boolean enabled) {
    }

    public record IssuerView(Long id, String code, String docTypeCode, String countryCode, String emirate, String nameEn,
                             String nameAr) {
    }

    public record ReasonCodeView(String code, String category, int httpStatus, String messageEn, String messageAr) {
    }

    public record ReasonCodeUpdate(String messageEn, String messageAr) {
    }

    @GetMapping("/flows")
    @Transactional(readOnly = true)
    public List<FlowView> flows() {
        List<FlowView> out = new ArrayList<>();
        for (RefFlowDef f : flowRepository.findAllByOrderByIdAsc()) {
            out.add(flow(f));
        }
        return out;
    }

    @PutMapping("/flows/{code}/steps/{stepId}")
    @Transactional
    public FlowView updateFlowStep(@PathVariable String code, @PathVariable Long stepId, @RequestBody FlowStepUpdate body) {
        RefFlowDef f = flowRepository.findByCode(code).orElseThrow(() -> notFound("Flow"));
        RefFlowStepDef step = stepRepository.findById(stepId).filter(s -> s.getFlowId().equals(f.getId()))
                .orElseThrow(() -> notFound("Step"));
        int oldMaxAttempts = step.getMaxAttempts();
        boolean oldMandatory = step.isMandatory();
        if (body.maxAttempts() != null) {
            if (body.maxAttempts() < 1 || body.maxAttempts() > 20) {
                throw invalid("Max attempts must be between 1 and 20");
            }
            step.setMaxAttempts(body.maxAttempts());
        }
        if (body.mandatory() != null) {
            step.setMandatory(body.mandatory());
        }
        audit.record("FLOW_STEP_UPDATED", "ref_flow_step_def", step.getId(),
                Map.of("flow", code, "step", step.getStepCode(), "maxAttempts", step.getMaxAttempts(), "mandatory", step.isMandatory()));
        log.info("Flow step updated by {}: flow={} stepId={} step={} maxAttempts {}->{} mandatory {}->{}",
                actor(), code, step.getId(), step.getStepCode(), oldMaxAttempts, step.getMaxAttempts(),
                oldMandatory, step.isMandatory());
        return flow(f);
    }

    @GetMapping("/document-types")
    @Transactional(readOnly = true)
    public List<DocumentTypeView> documentTypes() {
        return docTypeRepository.findAllByOrderByIdAsc().stream().map(t -> new DocumentTypeView(t.getId(), t.getCode(),
                t.getName(), t.getSides(), t.isHasMrz(), t.isHasFacePhoto(),
                entitlements.isEnabled(Codes.FeatureType.DOCUMENT, t.getCode()))).toList();
    }

    @GetMapping("/issuers")
    @Transactional(readOnly = true)
    public List<IssuerView> issuers() {
        Map<Long, String> types = docTypeRepository.findAll().stream()
                .collect(Collectors.toMap(RefDocumentType::getId, RefDocumentType::getCode));
        return issuerRepository.findAllByOrderByIdAsc().stream().map((RefIssuer i) -> new IssuerView(i.getId(), i.getCode(),
                types.get(i.getDocTypeId()), i.getCountryCode(), i.getEmirate(), i.getNameEn(), i.getNameAr())).toList();
    }

    @GetMapping("/reason-codes")
    @Transactional(readOnly = true)
    public List<ReasonCodeView> reasonCodes() {
        return reasonRepository.findAllByOrderByCategoryAscCodeAsc().stream().map(AdminConfigController::reason).toList();
    }

    @PutMapping("/reason-codes/{code}")
    @Transactional
    public ReasonCodeView updateReasonCode(@PathVariable String code, @RequestBody ReasonCodeUpdate body) {
        RefReasonCode r = reasonRepository.findByCode(code).orElseThrow(() -> notFound("Reason code"));
        String en = AdminParams.required(body.messageEn(), "messageEn");
        if (en.length() > 500 || (body.messageAr() != null && body.messageAr().length() > 500)) {
            throw invalid("Messages are limited to 500 characters");
        }
        r.setMessageEn(en);
        r.setMessageAr(AdminParams.blankToNull(body.messageAr()));
        reasonRepository.saveAndFlush(r);
        reasonCatalog.evict();
        audit.record("REASON_MESSAGE_UPDATED", "ref_reason_code", code, null);
        log.info("Reason code messages updated by {}: code={}", actor(), code);
        return reason(r);
    }

    private FlowView flow(RefFlowDef f) {
        List<FlowStepView> steps = stepRepository.findByFlowIdOrderBySeqAsc(f.getId()).stream()
                .map(s -> new FlowStepView(s.getId(), s.getSeq(), s.getStepCode(), s.isMandatory(), s.getMaxAttempts(),
                        SessionSupport.usesStepMaxAttempts(f.getCode(), s.getStepCode()),
                        Codes.DEDUP_SEARCH.equals(s.getStepCode()) ? ConfigKey.DEDUP_ENABLED.key() : null))
                .toList();
        long enabledTenants = entitlementRepository.findAll().stream()
                .filter(e -> e.getFeatureType() == Codes.FeatureType.FLOW && e.getFeatureCode().equals(f.getCode())
                        && entitlements.isActive(e))
                .map(TenantEntitlement::getTenantId).distinct().count();
        return new FlowView(f.getCode(), f.getName(), f.getDescription(),
                entitlements.isEnabled(Codes.FeatureType.FLOW, f.getCode()), enabledTenants, steps);
    }

    private static ReasonCodeView reason(RefReasonCode r) {
        return new ReasonCodeView(r.getCode(), r.getCategory(), r.getHttpStatus(), r.getMessageEn(), r.getMessageAr());
    }

    // ================================================================ retention

    public record RetentionView(Long id, String dataCategory, int retentionDays, String description, Instant updatedAt) {
    }

    public record RetentionUpdate(Integer retentionDays) {
    }

    @GetMapping("/retention-policies")
    @Transactional(readOnly = true)
    public List<RetentionView> retentionPolicies() {
        return retentionRepository.findByTenantIdOrderByDataCategoryAsc(tenantId()).stream()
                .map(AdminConfigController::retention).toList();
    }

    @PutMapping("/retention-policies/{id}")
    @Transactional
    public RetentionView updateRetention(@PathVariable Long id, @RequestBody RetentionUpdate body) {
        RetentionPolicy p = retentionRepository.findById(id).filter(x -> x.getTenantId().equals(tenantId()))
                .orElseThrow(() -> notFound("Retention policy"));
        if (body.retentionDays() == null || body.retentionDays() < 1 || body.retentionDays() > 3650) {
            throw invalid("Retention must be between 1 and 3650 days");
        }
        int old = p.getRetentionDays();
        p.setRetentionDays(body.retentionDays());
        retentionRepository.saveAndFlush(p);
        audit.record("RETENTION_UPDATED", "retention_policy", p.getId(),
                Map.of("category", p.getDataCategory(), "from", old, "to", p.getRetentionDays()));
        log.info("Retention policy updated by {}: tenantId={} policyId={} category={} retentionDays {}->{}",
                actor(), tenantId(), p.getId(), p.getDataCategory(), old, p.getRetentionDays());
        return retention(p);
    }

    private static RetentionView retention(RetentionPolicy p) {
        return new RetentionView(p.getId(), p.getDataCategory(), p.getRetentionDays(), p.getDescription(), p.getUpdatedAt());
    }

    // ================================================================ helpers

    private static Long tenantId() {
        return RequestContext.get().getTenantId();
    }

    /** Who made a change, for the log: a back-office user, or the tenant portal (which reuses these handlers). */
    private static String actor() {
        RequestContext ctx = RequestContext.get();
        if (ctx.getAdminUser() != null) {
            return "adminUserId=" + ctx.getAdminUser().getId();
        }
        return "portalTenant=" + ctx.getPortalTenantCode();
    }

    /** A setting value safe to write to the log: masked when the key looks like a secret. */
    private static String loggable(String key, String value) {
        String k = key == null ? "" : key.toLowerCase();
        if (value != null && (k.contains("secret") || k.contains("password") || k.contains("token")
                || k.contains("apikey") || k.contains("api-key") || k.contains("api_key") || k.contains("credential")
                || k.contains("private"))) {
            return "****";
        }
        return value;
    }

    private static FaceMatchException notFound(String what) {
        return new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", what + " not found");
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }
}
