package com.facetech.backend.admin;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.ConfigParam;
import com.facetech.backend.domain.RetentionPolicy;
import com.facetech.backend.domain.Tenant;
import com.facetech.backend.domain.TenantEntitlement;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.domain.FlowLivenessPolicy;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.LivenessSettingsService;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.ConfigParamRepository;
import com.facetech.backend.repository.RetentionPolicyRepository;
import com.facetech.backend.repository.TenantEntitlementRepository;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.TenantRepository;
import com.facetech.backend.tenant.TenantUserService;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Tenants served by this camtech (platform operators only). A new tenant starts as a copy of a
 * template tenant (by default the one camtech runs for): its entitlements, settings and retention
 * policies, liveness limits, plus a MOBILE_APP and a WEB_APP client app. Its users then integrate from the
 * tenant portal. The liveness limits of each tenant and flow are set here too.
 */
@Slf4j
@RestController
@RequestMapping("/v2/admin")
public class AdminTenantController {

    private final TenantRepository tenantRepository;
    private final TenantEntitlementRepository entitlementRepository;
    private final ConfigParamRepository configRepository;
    private final RetentionPolicyRepository retentionRepository;
    private final ClientAppRepository clientAppRepository;
    private final TenantService tenantService;
    private final LivenessSettingsService livenessSettings;
    private final AuditService audit;
    private final TenantUserService tenantUsers;
    private final AdminConfigController config;

    public AdminTenantController(TenantRepository tenantRepository, TenantEntitlementRepository entitlementRepository,
                                 ConfigParamRepository configRepository, RetentionPolicyRepository retentionRepository,
                                 ClientAppRepository clientAppRepository, TenantService tenantService,
                                 LivenessSettingsService livenessSettings, AuditService audit,
                                 TenantUserService tenantUsers, AdminConfigController config) {
        this.tenantRepository = tenantRepository;
        this.entitlementRepository = entitlementRepository;
        this.configRepository = configRepository;
        this.retentionRepository = retentionRepository;
        this.clientAppRepository = clientAppRepository;
        this.tenantService = tenantService;
        this.livenessSettings = livenessSettings;
        this.audit = audit;
        this.tenantUsers = tenantUsers;
        this.config = config;
    }

    public record TenantSummary(Long id, String code, String name, String status, boolean isDefault, Instant createdAt) {
    }

    /** owner: the first tenant portal user (role OWNER); optional, it can also be added later. */
    public record TenantCreate(String code, String name, String templateCode, OwnerAccount owner) {
    }

    /** password: blank = generate one. */
    public record OwnerAccount(String username, String displayName, String email, String password) {
    }

    /** owner.password is shown once, to be shared with the tenant. */
    public record TenantCreated(Long id, String code, String name, String status, boolean isDefault, Instant createdAt,
                                TenantUserService.CreatedUser owner) {
    }

    public record TenantUpdate(String name, String status) {
    }

    @GetMapping("/tenants")
    @Transactional(readOnly = true)
    public List<TenantSummary> tenants() {
        Long defaultId = tenantService.defaultTenantId();
        return tenantRepository.findAll().stream()
                .sorted((a, b) -> a.getCode().compareTo(b.getCode()))
                .map(t -> summary(t, defaultId)).toList();
    }

    @PostMapping("/tenants")
    @Transactional
    public ResponseEntity<TenantCreated> create(@RequestBody TenantCreate body) {
        String code = AdminParams.required(body != null ? body.code() : null, "code").toUpperCase(Locale.ROOT);
        if (!code.matches("[A-Z0-9_]{2,30}")) {
            throw invalid("Code: 2-30 capital letters, digits or underscores");
        }
        if (tenantRepository.findByCode(code).isPresent()) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "CODE_TAKEN", "A tenant with this code exists");
        }
        String name = AdminParams.required(body.name(), "name");
        if (name.length() > 200) {
            throw invalid("The name is limited to 200 characters");
        }
        Tenant template = AdminParams.blankToNull(body.templateCode()) == null
                ? tenantRepository.findById(tenantService.defaultTenantId()).orElseThrow()
                : tenantService.findByCode(body.templateCode()).orElseThrow(() -> invalid("Unknown template tenant"));

        Tenant t = new Tenant();
        t.setCode(code);
        t.setName(name);
        t.setStatus("ACTIVE");
        tenantRepository.saveAndFlush(t);

        for (TenantEntitlement src : entitlementRepository.findByTenantIdOrderByFeatureTypeAscFeatureCodeAsc(template.getId())) {
            TenantEntitlement e = new TenantEntitlement();
            e.setTenantId(t.getId());
            e.setFeatureType(src.getFeatureType());
            e.setFeatureCode(src.getFeatureCode());
            e.setEnabled(src.isEnabled());
            e.setQuotaPerDay(src.getQuotaPerDay());
            e.setValidUntil(src.getValidUntil());
            entitlementRepository.save(e);
        }
        for (ConfigParam src : configRepository.findByTenantId(template.getId())) {
            ConfigParam p = new ConfigParam();
            p.setTenantId(t.getId());
            p.setFlowCode(src.getFlowCode());
            p.setChannel(src.getChannel());
            p.setClientAppCode(src.getClientAppCode());
            p.setParamKey(src.getParamKey());
            p.setParamValue(src.getParamValue());
            p.setDescription(src.getDescription());
            configRepository.save(p);
        }
        for (RetentionPolicy src : retentionRepository.findByTenantIdOrderByDataCategoryAsc(template.getId())) {
            RetentionPolicy r = new RetentionPolicy();
            r.setTenantId(t.getId());
            r.setDataCategory(src.getDataCategory());
            r.setRetentionDays(src.getRetentionDays());
            r.setDescription(src.getDescription());
            retentionRepository.save(r);
        }
        livenessSettings.provision(t.getId(), template.getId());
        clientAppRepository.save(app(t, "MOBILE_APP", "Mobile app (iOS and Android)", Codes.Channel.MOBILE, null));
        clientAppRepository.save(app(t, "WEB_APP", "Web app", Codes.Channel.WEB, "BROWSER"));
        TenantUserService.CreatedUser owner = body.owner() == null ? null : asTenant(t.getId(), () -> tenantUsers.create(
                t.getId(), new TenantUserService.CreateUser(body.owner().username(), body.owner().displayName(),
                        body.owner().email(), Codes.TenantRole.OWNER.name(), body.owner().password())));
        audit.record("TENANT_CREATED", "tenant", code, Map.of("template", template.getCode()));
        log.info("Tenant created by adminUserId={}: tenantId={} code={} template={} (entitlements, settings, retention, "
                + "liveness limits and MOBILE_APP/WEB_APP client apps copied)", adminId(), t.getId(), code, template.getCode());
        TenantSummary sum = summary(t, tenantService.defaultTenantId());
        return ResponseEntity.status(HttpStatus.CREATED).body(new TenantCreated(sum.id(), sum.code(), sum.name(),
                sum.status(), sum.isDefault(), sum.createdAt(), owner));
    }

    @PutMapping("/tenants/{id}")
    @Transactional
    public TenantSummary update(@PathVariable Long id, @RequestBody TenantUpdate body) {
        Tenant t = tenantRepository.findById(id).orElseThrow(() ->
                new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tenant not found"));
        String oldStatus = t.getStatus();
        if (body.name() != null) {
            t.setName(AdminParams.required(body.name(), "name"));
        }
        if (body.status() != null) {
            String status = body.status().trim().toUpperCase(Locale.ROOT);
            if (!List.of("ACTIVE", "SUSPENDED").contains(status)) {
                throw invalid("status must be ACTIVE or SUSPENDED");
            }
            if ("SUSPENDED".equals(status) && t.getId().equals(tenantService.defaultTenantId())) {
                throw new FaceMatchException(HttpStatus.CONFLICT, "DEFAULT_TENANT", "The default tenant cannot be suspended");
            }
            t.setStatus(status);
        }
        tenantService.evictStatus();
        audit.record("TENANT_UPDATED", "tenant", t.getCode(), Map.of("status", t.getStatus()));
        log.info("Tenant updated by adminUserId={}: tenantId={} code={} status {}->{} nameChanged={}",
                adminId(), t.getId(), t.getCode(), oldStatus, t.getStatus(), body.name() != null);
        return summary(t, tenantService.defaultTenantId());
    }

    // ================================================================ plan, settings and apps of one tenant
    // The same handlers as /v2/admin/entitlements and /v2/admin/config-params, run on the given tenant.

    @GetMapping("/tenants/{tenantId}/entitlements")
    public List<AdminConfigController.EntitlementView> tenantEntitlements(@PathVariable Long tenantId) {
        tenant(tenantId);
        return asTenant(tenantId, config::entitlements);
    }

    @PutMapping("/tenants/{tenantId}/entitlements/{id}")
    public AdminConfigController.EntitlementView updateTenantEntitlement(@PathVariable Long tenantId, @PathVariable Long id,
                                                                         @RequestBody AdminConfigController.EntitlementUpdate body) {
        tenant(tenantId);
        return asTenant(tenantId, () -> config.updateEntitlement(id, body));
    }

    @GetMapping("/tenants/{tenantId}/config-params")
    public List<AdminConfigController.ConfigParamView> tenantConfigParams(@PathVariable Long tenantId) {
        tenant(tenantId);
        return asTenant(tenantId, config::configParams);
    }

    @PostMapping("/tenants/{tenantId}/config-params")
    public ResponseEntity<AdminConfigController.ConfigParamView> createTenantConfigParam(
            @PathVariable Long tenantId, @RequestBody AdminConfigController.ConfigParamCreate body) {
        tenant(tenantId);
        return asTenant(tenantId, () -> config.createConfigParam(body));
    }

    @PutMapping("/tenants/{tenantId}/config-params/{id}")
    public AdminConfigController.ConfigParamView updateTenantConfigParam(@PathVariable Long tenantId, @PathVariable Long id,
                                                                         @RequestBody AdminConfigController.ConfigParamUpdate body) {
        tenant(tenantId);
        return asTenant(tenantId, () -> config.updateConfigParam(id, body));
    }

    @DeleteMapping("/tenants/{tenantId}/config-params/{id}")
    public ResponseEntity<Void> deleteTenantConfigParam(@PathVariable Long tenantId, @PathVariable Long id) {
        tenant(tenantId);
        return asTenant(tenantId, () -> config.deleteConfigParam(id));
    }

    /** The tenant's client apps, read-only: to scope a setting to one of them. */
    @GetMapping("/tenants/{tenantId}/client-apps")
    public List<AdminConfigController.ClientAppView> tenantClientApps(@PathVariable Long tenantId) {
        tenant(tenantId);
        return asTenant(tenantId, config::clientApps);
    }

    // ================================================================ tenant portal users

    @GetMapping("/tenants/{tenantId}/users")
    public List<TenantUserService.UserView> tenantUsers(@PathVariable Long tenantId) {
        tenant(tenantId);
        return tenantUsers.list(tenantId);
    }

    @PostMapping("/tenants/{tenantId}/users")
    public ResponseEntity<TenantUserService.CreatedUser> createTenantUser(@PathVariable Long tenantId,
                                                                         @RequestBody TenantUserService.CreateUser body) {
        tenant(tenantId);
        TenantUserService.CreatedUser created = asTenant(tenantId, () -> tenantUsers.create(tenantId, body));
        log.info("Tenant user created by adminUserId={}: tenantId={} username={}", adminId(), tenantId,
                created.user().username());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/tenants/{tenantId}/users/{userId}")
    public TenantUserService.UserView updateTenantUser(@PathVariable Long tenantId, @PathVariable Long userId,
                                                       @RequestBody TenantUserService.UpdateUser body) {
        tenant(tenantId);
        return asTenant(tenantId, () -> tenantUsers.update(tenantId, userId, body, null));
    }

    @PostMapping("/tenants/{tenantId}/users/{userId}/reset-password")
    public Map<String, String> resetTenantUserPassword(@PathVariable Long tenantId, @PathVariable Long userId,
                                                       @RequestBody(required = false) TenantUserService.ResetPassword body) {
        tenant(tenantId);
        String password = asTenant(tenantId, () -> tenantUsers.resetPassword(tenantId, userId,
                body != null ? body.password() : null));
        log.info("Tenant user password reset by adminUserId={}: tenantId={} userId={}", adminId(), tenantId, userId);
        return Map.of("password", password);
    }

    /** Runs a change as if on the given tenant, so its audit entry lands in that tenant's audit log. */
    private static <T> T asTenant(Long tenantId, Supplier<T> action) {
        RequestContext ctx = RequestContext.get();
        Long previous = ctx.getTenantId();
        ctx.setTenantId(tenantId);
        try {
            return action.get();
        } finally {
            ctx.setTenantId(previous);
        }
    }

    // ================================================================ liveness limits per flow

    @GetMapping("/tenants/{tenantId}/liveness-policies")
    @Transactional(readOnly = true)
    public List<LivenessSettingsService.AdminFlowLiveness> livenessPolicies(@PathVariable Long tenantId) {
        tenant(tenantId);
        return LivenessSettingsService.LIVENESS_FLOWS.stream().map(f -> livenessSettings.adminView(tenantId, f)).toList();
    }

    @GetMapping("/tenants/{tenantId}/flows/{flowCode}/liveness-policy")
    @Transactional(readOnly = true)
    public LivenessSettingsService.AdminFlowLiveness livenessPolicy(@PathVariable Long tenantId, @PathVariable String flowCode) {
        tenant(tenantId);
        return livenessSettings.adminView(tenantId, livenessFlow(flowCode));
    }

    @PutMapping("/tenants/{tenantId}/flows/{flowCode}/liveness-policy")
    @Transactional
    public LivenessSettingsService.AdminFlowLiveness updateLivenessPolicy(@PathVariable Long tenantId,
                                                                          @PathVariable String flowCode,
                                                                          @RequestBody LivenessSettingsService.PolicyUpdate body) {
        Tenant t = tenant(tenantId);
        String flow = livenessFlow(flowCode);
        FlowLivenessPolicy row = livenessSettings.savePolicy(tenantId, flow, body);
        Map<String, Object> details = new java.util.LinkedHashMap<>();
        details.put("tenant", t.getCode());
        details.put("flow", flow);
        details.put("allowedModes", row.getAllowedModes());
        details.put("allowedActions", row.getAllowedActions());
        details.put("minActions", row.getMinActions());
        details.put("maxActions", row.getMaxActions());
        details.put("requireSpareAction", row.isRequireSpareAction());
        details.put("resetTenant", Boolean.TRUE.equals(body.resetTenant()));
        audit.record("LIVENESS_POLICY_UPDATED", "flow_liveness_policy", row.getId(), details);
        log.info("Liveness policy updated by adminUserId={}: tenantId={} code={} flow={} resetTenant={}", adminId(),
                tenantId, t.getCode(), flow, Boolean.TRUE.equals(body.resetTenant()));
        return livenessSettings.adminView(tenantId, flow);
    }

    private Tenant tenant(Long id) {
        return tenantRepository.findById(id).orElseThrow(() ->
                new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Tenant not found"));
    }

    private static String livenessFlow(String flowCode) {
        String flow = flowCode == null ? "" : flowCode.trim().toUpperCase(Locale.ROOT);
        if (!LivenessSettingsService.isLivenessFlow(flow)) {
            throw new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "No liveness settings for flow " + flowCode);
        }
        return flow;
    }

    private static ClientApp app(Tenant t, String code, String name, Codes.Channel channel, String platform) {
        ClientApp a = new ClientApp();
        a.setTenantId(t.getId());
        a.setCode(code);
        a.setName(name);
        a.setChannel(channel);
        a.setPlatform(platform);
        a.setStatus(Codes.ActiveStatus.ACTIVE);
        return a;
    }

    private static TenantSummary summary(Tenant t, Long defaultId) {
        return new TenantSummary(t.getId(), t.getCode(), t.getName(), t.getStatus(), t.getId().equals(defaultId),
                t.getCreatedAt());
    }

    private static Long adminId() {
        return RequestContext.get().getAdminUser() != null ? RequestContext.get().getAdminUser().getId() : null;
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }
}
