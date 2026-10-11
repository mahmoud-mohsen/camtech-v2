package com.facetech.backend.platform;

import com.facetech.backend.domain.Tenant;
import com.facetech.backend.domain.TenantBranding;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.repository.TenantBrandingRepository;
import com.facetech.backend.repository.TenantRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The look of the web SDK per tenant (tenant_branding). Read by the SDK through
 * GET /v2/branding and edited in the tenant portal. Without a row, defaults apply.
 */
@Service
@Slf4j
public class BrandingService {

    public static final List<String> FONTS = List.of("system-ui", "Inter", "Roboto", "Noto Sans Arabic", "Tajawal", "Cairo");
    static final List<String> LANGS = List.of("en", "ar");
    static final Set<String> TEXT_KEYS = Set.of("welcomeTitle", "welcomeBody", "doneTitle", "doneBody");
    /** Roughly 300 KB of image once base64-decoded. */
    static final int MAX_LOGO_CHARS = 400_000;

    private static final Pattern COLOR = Pattern.compile("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$");
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]{1,64}@[^\\s@]{1,190}\\.[^\\s@]{2,}$");
    private static final Pattern LOGO = Pattern.compile("^data:image/(png|jpeg|webp|svg\\+xml);base64,[A-Za-z0-9+/=]+$");
    private static final Pattern SVG_ACTIVE = Pattern.compile("(?i)<script|javascript:|\\son[a-z]+\\s*=|<foreignObject|<iframe");

    private final TenantBrandingRepository repository;
    private final TenantRepository tenantRepository;
    private final AuditService audit;
    private final ObjectMapper objectMapper;

    public BrandingService(TenantBrandingRepository repository, TenantRepository tenantRepository, AuditService audit,
                           ObjectMapper objectMapper) {
        this.repository = repository;
        this.tenantRepository = tenantRepository;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    public record BrandingView(String tenant, String displayName, String logoDataUrl, String primaryColor,
                               String accentColor, String backgroundColor, String surfaceColor, String textColor,
                               int borderRadius, String fontFamily, String themeMode, String supportEmail,
                               String supportUrl, String privacyUrl, boolean showPoweredBy,
                               Map<String, Map<String, String>> texts, Instant updatedAt) {
    }

    public record BrandingUpdate(String displayName, String logoDataUrl, String primaryColor, String accentColor,
                                 String backgroundColor, String surfaceColor, String textColor, Integer borderRadius,
                                 String fontFamily, String themeMode, String supportEmail, String supportUrl,
                                 String privacyUrl, Boolean showPoweredBy, Map<String, Map<String, String>> texts) {
    }

    @Transactional(readOnly = true)
    public BrandingView get(Long tenantId) {
        Tenant tenant = tenantRepository.findById(tenantId).orElseThrow();
        return repository.findByTenantId(tenantId).map(b -> view(tenant, b)).orElseGet(() -> {
            log.debug("No branding for tenant {}: using defaults", tenant.getCode());
            return defaults(tenant);
        });
    }

    @Transactional
    public BrandingView update(Long tenantId, BrandingUpdate body) {
        if (body == null) {
            throw invalid("Send the branding");
        }
        Tenant tenant = tenantRepository.findById(tenantId).orElseThrow();
        TenantBranding b = repository.findByTenantId(tenantId).orElseGet(() -> {
            TenantBranding n = new TenantBranding();
            n.setTenantId(tenantId);
            return n;
        });
        b.setDisplayName(text(body.displayName(), 100, "displayName"));
        b.setLogoDataUrl(logo(body.logoDataUrl()));
        b.setPrimaryColor(color(body.primaryColor(), "primaryColor"));
        b.setAccentColor(color(body.accentColor(), "accentColor"));
        b.setBackgroundColor(color(body.backgroundColor(), "backgroundColor"));
        b.setSurfaceColor(color(body.surfaceColor(), "surfaceColor"));
        b.setTextColor(color(body.textColor(), "textColor"));
        if (body.borderRadius() == null || body.borderRadius() < 0 || body.borderRadius() > 32) {
            throw invalid("borderRadius must be between 0 and 32");
        }
        b.setBorderRadius(body.borderRadius());
        if (body.fontFamily() == null || !FONTS.contains(body.fontFamily())) {
            throw invalid("fontFamily must be one of " + String.join(", ", FONTS));
        }
        b.setFontFamily(body.fontFamily());
        String mode = body.themeMode() == null ? "" : body.themeMode().toUpperCase(Locale.ROOT);
        if (!Set.of("LIGHT", "DARK", "AUTO").contains(mode)) {
            throw invalid("themeMode must be LIGHT, DARK or AUTO");
        }
        b.setThemeMode(mode);
        String email = text(body.supportEmail(), 200, "supportEmail");
        if (email != null && !EMAIL.matcher(email).matches()) {
            throw invalid("supportEmail is not a valid email address");
        }
        b.setSupportEmail(email);
        b.setSupportUrl(url(body.supportUrl(), "supportUrl"));
        b.setPrivacyUrl(url(body.privacyUrl(), "privacyUrl"));
        b.setShowPoweredBy(body.showPoweredBy() == null || body.showPoweredBy());
        b.setTexts(texts(body.texts()));
        repository.saveAndFlush(b);
        audit.record("BRANDING_UPDATED", "tenant_branding", tenant.getCode(), Map.of("themeMode", mode));
        log.info("Branding updated for tenant {} (themeMode={}, font={}, logo={})", tenant.getCode(), mode,
                b.getFontFamily(), b.getLogoDataUrl() != null ? b.getLogoDataUrl().length() + " chars" : "none");
        return view(tenant, b);
    }

    @Transactional
    public BrandingView reset(Long tenantId) {
        Tenant tenant = tenantRepository.findById(tenantId).orElseThrow();
        repository.findByTenantId(tenantId).ifPresent(b -> {
            repository.delete(b);
            repository.flush();
            audit.record("BRANDING_RESET", "tenant_branding", tenant.getCode(), null);
            log.info("Branding reset to defaults for tenant {}", tenant.getCode());
        });
        return defaults(tenant);
    }

    private BrandingView view(Tenant tenant, TenantBranding b) {
        return new BrandingView(tenant.getCode(), b.getDisplayName() != null ? b.getDisplayName() : tenant.getName(),
                b.getLogoDataUrl(), b.getPrimaryColor(), b.getAccentColor(), b.getBackgroundColor(), b.getSurfaceColor(),
                b.getTextColor(), b.getBorderRadius(), b.getFontFamily(), b.getThemeMode(), b.getSupportEmail(),
                b.getSupportUrl(), b.getPrivacyUrl(), b.isShowPoweredBy(), parseTexts(b.getTexts()), b.getUpdatedAt());
    }

    static BrandingView defaults(Tenant tenant) {
        return new BrandingView(tenant.getCode(), tenant.getName(), null, "#1F4FD8", "#12B886", "#F5F7FB", "#FFFFFF",
                "#141824", 12, "system-ui", "AUTO", null, null, null, true, Map.of(), null);
    }

    private Map<String, Map<String, String>> parseTexts(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            log.warn("Stored branding texts could not be parsed, ignoring them: {}", e.toString());
            return Map.of();
        }
    }

    private String texts(Map<String, Map<String, String>> texts) {
        if (texts == null || texts.isEmpty()) {
            return null;
        }
        Map<String, Map<String, String>> clean = new LinkedHashMap<>();
        texts.forEach((lang, values) -> {
            if (!LANGS.contains(lang)) {
                throw invalid("texts: unknown language " + lang + " (use en or ar)");
            }
            Map<String, String> out = new LinkedHashMap<>();
            if (values != null) {
                values.forEach((k, v) -> {
                    if (!TEXT_KEYS.contains(k)) {
                        throw invalid("texts." + lang + ": unknown text " + k);
                    }
                    String t = text(v, k.endsWith("Body") ? 600 : 120, "texts." + lang + "." + k);
                    if (t != null) {
                        out.put(k, t);
                    }
                });
            }
            if (!out.isEmpty()) {
                clean.put(lang, out);
            }
        });
        if (clean.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(clean);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String logo(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String v = raw.trim();
        if (v.length() > MAX_LOGO_CHARS) {
            throw invalid("The logo is too large: keep it under 300 KB");
        }
        if (!LOGO.matcher(v).matches()) {
            throw invalid("The logo must be a PNG, JPEG, WebP or SVG image");
        }
        if (v.startsWith("data:image/svg+xml")) {
            String svg;
            try {
                svg = new String(Base64.getDecoder().decode(v.substring(v.indexOf(',') + 1)),
                        StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                throw invalid("The logo is not valid base64");
            }
            if (SVG_ACTIVE.matcher(svg).find()) {
                throw invalid("SVG logos cannot contain scripts, event handlers or embedded content");
            }
        }
        return v;
    }

    private static String color(String raw, String name) {
        if (raw == null || !COLOR.matcher(raw.trim()).matches()) {
            throw invalid(name + " must be a hex color such as #1F4FD8");
        }
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    private static String url(String raw, String name) {
        String v = text(raw, 500, name);
        if (v == null) {
            return null;
        }
        try {
            URI u = URI.create(v);
            boolean local = "localhost".equalsIgnoreCase(u.getHost()) || "127.0.0.1".equals(u.getHost());
            if (u.getHost() == null || !("https".equalsIgnoreCase(u.getScheme()) || local && "http".equalsIgnoreCase(u.getScheme()))) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException e) {
            throw invalid(name + " must be a full https:// address");
        }
        return v;
    }

    private static String text(String raw, int max, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String v = raw.trim();
        if (v.length() > max) {
            throw invalid(name + " is limited to " + max + " characters");
        }
        return v;
    }

    private static FaceMatchException invalid(String message) {
        return new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }
}
