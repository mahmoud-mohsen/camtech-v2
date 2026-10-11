package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminConfigController;
import com.facetech.backend.admin.AdminViews;
import com.facetech.backend.admin.AdminWebhookController;
import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.BrandingService;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.DocumentOcrSettingsService;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.LivenessSettingsService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.SdkTokenService;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.platform.TenantSettingsService;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.ClientCredentialRepository;
import com.facetech.backend.verification.SessionSupport;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Tenant portal: what a tenant needs to integrate — its client apps and API keys, webhooks,
 * the web SDK branding, liveness settings per flow, duplicate identity search, and SDK tokens for the playground. Limited to the tenant resolved by
 * {@link TenantPortalFilter}. Apps of the ADMIN channel (camtech's own back-office) are
 * neither shown nor editable here.
 */
@RestController
@RequestMapping("/v2/tenant")
public class TenantIntegrationController {

    private final AdminConfigController config;
    private final AdminWebhookController webhooks;
    private final ClientAppRepository clientAppRepository;
    private final ClientCredentialRepository credentialRepository;
    private final BrandingService branding;
    private final SdkTokenService sdkTokens;
    private final TenantService tenantService;
    private final LivenessSettingsService livenessSettings;
    private final EntitlementService entitlements;
    private final AuditService audit;
    private final DocumentOcrSettingsService ocrSettings;
    private final TenantSettingsService tenantSettings;
    private final SessionSupport sessionSupport;

    public TenantIntegrationController(AdminConfigController config, AdminWebhookController webhooks,
                                       ClientAppRepository clientAppRepository,
                                       ClientCredentialRepository credentialRepository, BrandingService branding,
                                       SdkTokenService sdkTokens, TenantService tenantService,
                                       LivenessSettingsService livenessSettings, EntitlementService entitlements,
                                       AuditService audit, DocumentOcrSettingsService ocrSettings,
                                       TenantSettingsService tenantSettings, SessionSupport sessionSupport) {
        this.config = config;
        this.webhooks = webhooks;
        this.clientAppRepository = clientAppRepository;
        this.credentialRepository = credentialRepository;
        this.branding = branding;
        this.sdkTokens = sdkTokens;
        this.tenantService = tenantService;
        this.livenessSettings = livenessSettings;
        this.entitlements = entitlements;
        this.audit = audit;
        this.ocrSettings = ocrSettings;
        this.tenantSettings = tenantSettings;
        this.sessionSupport = sessionSupport;
    }

    // ================================================================ client apps and API keys

    @GetMapping("/client-apps")
    public List<AdminConfigController.ClientAppView> clientApps() {
        return config.clientApps().stream().filter(a -> !Codes.Channel.ADMIN.name().equals(a.channel())).toList();
    }

    @PostMapping("/client-apps")
    public ResponseEntity<AdminConfigController.ClientAppView> createClientApp(
            @RequestBody AdminConfigController.ClientAppCreate body) {
        if (body == null || body.channel() == null
                || !List.of(Codes.Channel.MOBILE.name(), Codes.Channel.WEB.name()).contains(body.channel().trim().toUpperCase())) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "channel must be MOBILE or WEB");
        }
        return config.createClientApp(body);
    }

    @PutMapping("/client-apps/{id}")
    public AdminConfigController.ClientAppView updateClientApp(@PathVariable Long id,
                                                               @RequestBody AdminConfigController.ClientAppUpdate body) {
        app(id);
        return config.updateClientApp(id, body);
    }

    @PutMapping("/client-apps/{id}/permissions")
    public AdminConfigController.ClientAppView updatePermissions(@PathVariable Long id,
                                                                 @RequestBody List<AdminConfigController.PermissionView> body) {
        app(id);
        return config.updatePermissions(id, body);
    }

    @GetMapping("/client-apps/{id}/capabilities")
    public Map<String, Object> capabilities(@PathVariable Long id) {
        app(id);
        return config.capabilities(id);
    }

    @GetMapping("/client-apps/{id}/credentials")
    public List<AdminConfigController.CredentialView> credentials(@PathVariable Long id) {
        app(id);
        return config.credentials(id);
    }

    @PostMapping("/client-apps/{id}/credentials")
    public ResponseEntity<AdminConfigController.CreatedCredential> createCredential(
            @PathVariable Long id, @RequestBody(required = false) AdminConfigController.CredentialCreate body) {
        app(id);
        return config.createCredential(id, body);
    }

    @PostMapping("/credentials/{id}/revoke")
    @Transactional
    public AdminConfigController.CredentialView revokeCredential(@PathVariable Long id) {
        credentialRepository.findById(id).filter(c -> c.getTenantId().equals(tenantId()))
                .ifPresent(c -> app(c.getClientAppId()));
        return config.revokeCredential(id);
    }

    /** An app of this tenant that the portal may manage (not the ADMIN channel). */
    private ClientApp app(Long id) {
        return clientAppRepository.findById(id)
                .filter(a -> a.getTenantId().equals(tenantId()) && a.getChannel() != Codes.Channel.ADMIN)
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Client app not found"));
    }

    // ================================================================ webhooks

    @GetMapping("/webhooks")
    public List<AdminWebhookController.WebhookView> webhooks() {
        return webhooks.webhooks();
    }

    @PostMapping("/webhooks")
    public ResponseEntity<AdminWebhookController.WithSecret> createWebhook(@RequestBody AdminWebhookController.WebhookRequest body) {
        return webhooks.create(body);
    }

    @PutMapping("/webhooks/{id}")
    public AdminWebhookController.WebhookView updateWebhook(@PathVariable Long id,
                                                           @RequestBody AdminWebhookController.WebhookRequest body) {
        return webhooks.update(id, body);
    }

    @DeleteMapping("/webhooks/{id}")
    public ResponseEntity<Void> deleteWebhook(@PathVariable Long id) {
        return webhooks.delete(id);
    }

    @PostMapping("/webhooks/{id}/rotate-secret")
    public AdminWebhookController.WithSecret rotateWebhookSecret(@PathVariable Long id) {
        return webhooks.rotate(id);
    }

    @PostMapping("/webhooks/{id}/test")
    public AdminWebhookController.DeliveryView testWebhook(@PathVariable Long id) {
        return webhooks.test(id);
    }

    @GetMapping("/webhooks/{id}/deliveries")
    public AdminViews.PageView<AdminWebhookController.DeliveryView> deliveries(
            @PathVariable Long id, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return webhooks.deliveries(id, page, size);
    }

    @PostMapping("/webhook-deliveries/{id}/retry")
    public AdminWebhookController.DeliveryView retryDelivery(@PathVariable Long id) {
        return webhooks.retry(id);
    }

    // ================================================================ branding

    @GetMapping("/branding")
    public BrandingService.BrandingView branding() {
        return branding.get(tenantId());
    }

    @PutMapping("/branding")
    public BrandingService.BrandingView updateBranding(@RequestBody BrandingService.BrandingUpdate body) {
        return branding.update(tenantId(), body);
    }

    @DeleteMapping("/branding")
    public BrandingService.BrandingView resetBranding() {
        return branding.reset(tenantId());
    }

    // ================================================================ liveness settings per flow

    /** Liveness flows the tenant is entitled to, with its settings and the back-office limits. */
    @GetMapping("/flows")
    @Transactional(readOnly = true)
    public List<LivenessSettingsService.TenantFlowLiveness> flows() {
        return LivenessSettingsService.LIVENESS_FLOWS.stream()
                .filter(f -> entitlements.isEnabled(Codes.FeatureType.FLOW, f))
                .map(f -> livenessSettings.tenantView(tenantId(), f)).toList();
    }

    @PutMapping("/flows/{flowCode}/liveness")
    @Transactional
    public LivenessSettingsService.TenantFlowLiveness updateFlowLiveness(
            @PathVariable String flowCode, @RequestBody LivenessSettingsService.SettingsUpdate body) {
        String flow = flowCode == null ? "" : flowCode.trim().toUpperCase();
        if (!LivenessSettingsService.isLivenessFlow(flow) || !entitlements.isEnabled(Codes.FeatureType.FLOW, flow)) {
            throw new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "No liveness settings for flow " + flowCode);
        }
        LivenessSettingsService.LivenessSettings saved = livenessSettings.saveTenant(tenantId(), flow, body);
        audit.record("LIVENESS_SETTINGS_UPDATED", "flow", flow, Map.of("mode", saved.mode(),
                "actions", saved.actions(), "challengeCount", saved.challengeCount()));
        return livenessSettings.tenantView(tenantId(), flow);
    }

    // ================================================================ duplicate identity search

    /**
     * {@code available}: DEDUP_SEARCH is in the tenant's plan. {@code enabled}: dedup.enabled for the whole tenant
     * (camtech may still override it for a flow, channel or app). {@code flows}: the tenant's flows that search.
     */
    public record DuplicateSearchSettings(boolean available, boolean enabled, List<String> flows) {
    }

    public record DuplicateSearchUpdate(Boolean enabled) {
    }

    @GetMapping("/duplicate-search")
    @Transactional(readOnly = true)
    public DuplicateSearchSettings duplicateSearch() {
        List<String> flows = entitlements.entitlements().stream()
                .filter(e -> e.getFeatureType() == Codes.FeatureType.FLOW && entitlements.isActive(e)
                        && sessionSupport.flowHasStep(e.getFeatureCode(), Codes.DEDUP_SEARCH))
                .map(e -> e.getFeatureCode()).toList();
        return new DuplicateSearchSettings(entitlements.isEnabled(Codes.FeatureType.FEATURE, Codes.FEATURE_DEDUP),
                Boolean.parseBoolean(tenantSettings.get(tenantId(), ConfigKey.DEDUP_ENABLED)), flows);
    }

    @PutMapping("/duplicate-search")
    @Transactional
    public DuplicateSearchSettings updateDuplicateSearch(@RequestBody DuplicateSearchUpdate body) {
        entitlements.require(Codes.FeatureType.FEATURE, Codes.FEATURE_DEDUP);
        if (body == null || body.enabled() == null) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "enabled is required");
        }
        boolean before = Boolean.parseBoolean(tenantSettings.get(tenantId(), ConfigKey.DEDUP_ENABLED));
        tenantSettings.set(tenantId(), ConfigKey.DEDUP_ENABLED, body.enabled().toString());
        audit.record("DUPLICATE_SEARCH_UPDATED", "tenant", tenantId(), Map.of("from", before, "to", body.enabled()));
        return duplicateSearch();
    }

    // ================================================================ document OCR review settings

    @GetMapping("/document-ocr-settings")
    public DocumentOcrSettingsService.TenantOcrSettings documentOcrSettings() {
        entitlements.require(Codes.FeatureType.FEATURE, Codes.FEATURE_SERVER_OCR);
        return ocrSettings.tenantView(tenantId());
    }

    @PutMapping("/document-ocr-settings")
    public DocumentOcrSettingsService.TenantOcrSettings updateDocumentOcrSettings(
            @RequestBody DocumentOcrSettingsService.SettingsUpdate body) {
        entitlements.require(Codes.FeatureType.FEATURE, Codes.FEATURE_SERVER_OCR);
        DocumentOcrSettingsService.TenantOcrSettings saved = ocrSettings.saveTenant(tenantId(), body);
        DocumentOcrSettingsService.OcrSettings s = saved.settings();
        audit.record("DOCUMENT_OCR_SETTINGS_UPDATED", "tenant", tenantId(), Map.of("reviewMode", s.reviewMode(),
                "autoAcceptConfidence", s.autoAcceptConfidence(), "fieldMinConfidence", s.fieldMinConfidence(),
                "requiredFields", s.requiredFields(), "acceptExpired", s.acceptExpired()));
        return saved;
    }

    @DeleteMapping("/document-ocr-settings")
    public DocumentOcrSettingsService.TenantOcrSettings resetDocumentOcrSettings() {
        entitlements.require(Codes.FeatureType.FEATURE, Codes.FEATURE_SERVER_OCR);
        DocumentOcrSettingsService.TenantOcrSettings reset = ocrSettings.resetTenant(tenantId());
        audit.record("DOCUMENT_OCR_SETTINGS_RESET", "tenant", tenantId(), Map.of());
        return reset;
    }

    // ================================================================ playground

    public record PlaygroundTokenRequest(String clientAppCode, String subjectRef, Integer ttlMinutes) {
    }

    public record PlaygroundToken(String sdkToken, Instant expiresAt, String tenantCode, String clientAppCode,
                                  String subjectRef) {
    }

    /** An SDK token for one of the tenant's apps, so the portal can run the real end-user flows. */
    @PostMapping("/playground/sdk-token")
    @Transactional(readOnly = true)
    public ResponseEntity<PlaygroundToken> playgroundToken(@RequestBody PlaygroundTokenRequest body) {
        String code = body == null || body.clientAppCode() == null ? "" : body.clientAppCode().trim().toUpperCase();
        ClientApp app = clientAppRepository.findByTenantIdAndCode(tenantId(), code)
                .filter(a -> a.getChannel() != Codes.Channel.ADMIN)
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Client app not found"));
        if (app.getStatus() != Codes.ActiveStatus.ACTIVE) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "CLIENT_APP_DISABLED", "Enable this app first");
        }
        String subjectRef = body.subjectRef() != null && !body.subjectRef().isBlank() ? body.subjectRef().trim() : null;
        if (subjectRef != null && subjectRef.length() > 200) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "subjectRef is limited to 200 characters");
        }
        SdkTokenService.Issued issued = sdkTokens.issue(app, subjectRef, body.ttlMinutes());
        return ResponseEntity.status(HttpStatus.CREATED).body(new PlaygroundToken(issued.token(), issued.expiresAt(),
                tenantService.code(app.getTenantId()), app.getCode(), subjectRef));
    }

    private static Long tenantId() {
        return RequestContext.get().getTenantId();
    }
}
