package com.facetech.backend.tenant;

import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.repository.AuditEventRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.service.FaceEmbeddingClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tenant portal (/v2/tenant/**), SDK tokens, branding and tenant isolation, end to end on an
 * in-memory Oracle-mode database built by the Liquibase changelog.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:camtech_tenant_it;MODE=Oracle;DB_CLOSE_DELAY=-1;DEFAULT_NULL_ORDERING=HIGH",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "camtech.jobs.enabled=false",
        "camtech.backoffice.admin-password=FirstPass123",
        "ocr.provider=none"
})
@AutoConfigureMockMvc
class TenantPortalIntegrationTest {

    private static final String ADMIN_PASSWORD = "TenantAdminPass789";
    private static String adminToken;
    private TenantSignIn signIn;

    @Autowired
    MockMvc mvc;
    @Autowired
    ObjectMapper json;
    @Autowired
    VerificationSessionRepository sessions;
    @Autowired
    AuditEventRepository auditEvents;

    @MockBean
    FaceEmbeddingClient faceClient;
    @MockBean
    OcrService ocrService;
    @MockBean
    com.facetech.backend.platform.storage.ObjectStore objectStore;

    @Test
    void tenantComesFromTheSignedInUser() throws Exception {
        mvc.perform(get("/v2/tenant/info")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(get("/v2/tenant/info").header("Authorization", "Bearer nope")).andExpect(status().isUnauthorized());
        mvc.perform(get("/v2/tenant/info").header("X-Tenant-Code", "NOQODI")).andExpect(status().isUnauthorized());
        mvc.perform(tenant(get("/v2/tenant/info"), "NOQODI")).andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("NOQODI"))
                .andExpect(jsonPath("$.flows[?(@.code == 'SELFIE_ID_VERIFICATION')].enabled").value(true));

        JsonNode dash = body(mvc.perform(tenant(get("/v2/tenant/dashboard"), "NOQODI")).andExpect(status().isOk()).andReturn());
        assertThat(dash.has("avgDocMatchSimilarity")).as("scores stay internal").isFalse();
        assertThat(dash.has("byClientApp")).isTrue();
        assertThat(dash.has("scans")).isTrue();

        JsonNode apps = body(mvc.perform(tenant(get("/v2/tenant/client-apps"), "NOQODI")).andExpect(status().isOk()).andReturn());
        assertThat(apps.findValuesAsText("channel")).doesNotContain("ADMIN");
    }

    @Test
    void newTenantIntegratesWithSdkTokensAndStaysIsolated() throws Exception {
        String code = "DEMO" + System.nanoTime() % 100000;
        // a platform operator creates the tenant from the back-office API
        mvc.perform(admin(post("/v2/admin/tenants").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\",\"name\":\"Demo Company\"}")))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.code").value(code));
        mvc.perform(admin(post("/v2/admin/tenants").contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"" + code + "\",\"name\":\"Again\"}"))).andExpect(status().isConflict());

        // the tenant creates a web app restricted to its website, and an API key
        JsonNode app = body(mvc.perform(tenant(post("/v2/tenant/client-apps"), code).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"SHOP_WEB\",\"name\":\"Shop\",\"channel\":\"WEB\",\"allowedOrigins\":[\"https://shop.example\"]}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(tenant(post("/v2/tenant/client-apps"), code).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"OPS\",\"name\":\"Ops\",\"channel\":\"ADMIN\"}"))
                .andExpect(status().isBadRequest());
        JsonNode cred = body(mvc.perform(tenant(post("/v2/tenant/client-apps/" + app.get("id").asLong() + "/credentials"), code)
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isCreated()).andReturn());
        String keyId = cred.get("credential").get("keyId").asText();
        String secret = cred.get("secret").asText();

        // its backend asks for an SDK token bound to one user
        JsonNode sdk = body(mvc.perform(post("/v2/sdk-tokens").contentType(MediaType.APPLICATION_JSON)
                        .header("X-Client-Id", keyId).header("X-Client-Secret", secret)
                        .content("{\"subjectRef\":\"cust-1\",\"ttlMinutes\":15}"))
                .andExpect(status().isCreated()).andReturn());
        String sdkToken = sdk.get("sdkToken").asText();
        assertThat(sdk.get("tenantCode").asText()).isEqualTo(code);
        // an SDK token cannot mint more tokens, and the default (uncredentialed) app cannot either
        mvc.perform(post("/v2/sdk-tokens").header("X-Sdk-Token", sdkToken)).andExpect(status().isForbidden());
        mvc.perform(post("/v2/sdk-tokens")).andExpect(status().isUnauthorized());

        // the browser uses the token: capabilities and branding are the tenant's, origins are enforced
        mvc.perform(get("/v2/capabilities").header("X-Sdk-Token", sdkToken).header("Origin", "https://shop.example"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.tenant").value(code))
                .andExpect(jsonPath("$.clientApp").value("SHOP_WEB"));
        mvc.perform(get("/v2/capabilities").header("X-Sdk-Token", sdkToken).header("Origin", "https://evil.example"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ORIGIN_NOT_ALLOWED"));
        mvc.perform(get("/v2/branding").header("X-Sdk-Token", sdkToken)).andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant").value(code)).andExpect(jsonPath("$.displayName").value("Demo Company"));
        // SDK tokens only open the end-user flows
        mvc.perform(get("/user").header("X-Sdk-Token", sdkToken)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SDK_TOKEN_NOT_ALLOWED"));
        mvc.perform(get("/v2/capabilities").header("X-Sdk-Token", sdkToken + "x")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("SDK_TOKEN_INVALID"));

        // the token is bound to cust-1
        mvc.perform(post("/v2/selfie-verifications").header("X-Sdk-Token", sdkToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectRef\":\"someone-else\"}")).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SUBJECT_MISMATCH"));
        JsonNode start = body(mvc.perform(post("/v2/selfie-verifications").header("X-Sdk-Token", sdkToken)
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isCreated()).andReturn());
        String sessionId = start.get("sessionId").asText();
        String sessionToken = start.get("sessionToken").asText();
        assertThat(sessions.findByPublicId(sessionId).orElseThrow().getSubjectRef()).isEqualTo("cust-1");

        // the session token alone continues that verification, as the app it belongs to
        mvc.perform(get("/v2/selfie-verifications/" + sessionId).header("Authorization", "Bearer " + sessionToken)
                .header("Origin", "https://shop.example")).andExpect(status().isOk())
                .andExpect(jsonPath("$.nextStep").value("LIVENESS"));
        mvc.perform(get("/v2/selfie-verifications/" + sessionId).header("Authorization", "Bearer " + sessionToken)
                .header("Origin", "https://evil.example")).andExpect(status().isForbidden());

        // the tenant sees its own verification, without scores or images; NOQODI does not see it
        mvc.perform(tenant(get("/v2/tenant/sessions"), code)).andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.items[0].clientAppCode").value("SHOP_WEB"));
        JsonNode detail = body(mvc.perform(tenant(get("/v2/tenant/sessions/" + sessionId), code)).andExpect(status().isOk()).andReturn());
        assertThat(detail.has("finalSimilarity")).isFalse();
        assertThat(detail.has("ipAddress")).isFalse();
        mvc.perform(tenant(get("/v2/tenant/sessions/" + sessionId), "NOQODI")).andExpect(status().isNotFound());
        mvc.perform(tenant(get("/v2/tenant/client-apps/" + app.get("id").asLong() + "/credentials"), "NOQODI"))
                .andExpect(status().isNotFound());

        // cancelling from the portal is audited as the tenant
        mvc.perform(tenant(post("/v2/tenant/sessions/" + sessionId + "/cancel"), code)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        assertThat(auditEvents.findAll()).anyMatch(e -> "SESSION_CANCELLED".equals(e.getAction())
                && e.getActorType().name().equals("TENANT"));

        // playground tokens work for the tenant's own apps only
        mvc.perform(tenant(post("/v2/tenant/playground/sdk-token"), code).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientAppCode\":\"WEB_APP\",\"subjectRef\":\"pg-1\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.clientAppCode").value("WEB_APP"));
        mvc.perform(tenant(post("/v2/tenant/playground/sdk-token"), "NOQODI").contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientAppCode\":\"BACKOFFICE\"}")).andExpect(status().isNotFound());

        // a suspended tenant is locked out of the portal
        long tenantId = body(mvc.perform(admin(get("/v2/admin/tenants"))).andReturn()).findParents("code").stream()
                .filter(n -> code.equals(n.get("code").asText())).findFirst().orElseThrow().get("id").asLong();
        mvc.perform(admin(put("/v2/admin/tenants/" + tenantId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"SUSPENDED\"}"))).andExpect(status().isOk());
        mvc.perform(tenant(get("/v2/tenant/info"), code)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("TENANT_SUSPENDED"));
        // ...and so are its apps
        mvc.perform(get("/v2/capabilities").header("X-Sdk-Token", sdkToken)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("TENANT_SUSPENDED"));
    }

    @Test
    void ownerFromTheBackOfficeSignsInAndManagesUsersByRole() throws Exception {
        String code = "USERS" + System.nanoTime() % 100000;
        String owner = code.toLowerCase() + "-owner";
        // camtech creates the tenant with its first owner; the generated password is shown once
        JsonNode created = body(mvc.perform(admin(post("/v2/admin/tenants").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\",\"name\":\"Users Co\",\"owner\":{\"username\":\"" + owner
                                + "\",\"email\":\"o@users.example\"}}")))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.owner.user.role").value("OWNER")).andReturn());
        String generated = created.get("owner").get("password").asText();
        assertThat(generated).hasSize(16);
        long tenantId = created.get("id").asLong();

        mvc.perform(post("/v2/tenant/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + owner + "\",\"password\":\"wrong-password-1\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_LOGIN"));
        JsonNode login = body(mvc.perform(post("/v2/tenant/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + owner.toUpperCase() + "\",\"password\":\"" + generated + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.tenant.code").value(code))
                .andExpect(jsonPath("$.user.mustChangePassword").value(true)).andReturn());
        String ownerToken = login.get("token").asText();
        // the first password must be changed before anything else
        mvc.perform(get("/v2/tenant/info").header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));
        mvc.perform(post("/v2/tenant/auth/change-password").header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"" + generated + "\",\"newPassword\":\"OwnerChosen123\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/v2/tenant/auth/me").header("Authorization", "Bearer " + ownerToken)).andExpect(status().isOk())
                .andExpect(jsonPath("$.user.username").value(owner)).andExpect(jsonPath("$.tenant.name").value("Users Co"));

        // the owner adds a viewer (password chosen) and a reviewer (password generated)
        mvc.perform(post("/v2/tenant/users").header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + owner + "\",\"role\":\"VIEWER\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("USERNAME_TAKEN"));
        mvc.perform(post("/v2/tenant/users").header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + code + "-viewer\",\"role\":\"VIEWER\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("WEAK_PASSWORD"));
        mvc.perform(post("/v2/tenant/users").header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + code + "-viewer\",\"role\":\"VIEWER\",\"password\":\"ViewerFirst123\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.password").value("ViewerFirst123"));
        JsonNode reviewer = body(mvc.perform(post("/v2/tenant/users").header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + code + "-reviewer\",\"role\":\"REVIEWER\"}"))
                .andExpect(status().isCreated()).andReturn());
        assertThat(reviewer.get("password").asText()).hasSize(16);

        TenantSignIn signIn = new TenantSignIn(mvc, json);
        String viewerToken = signIn.login(code + "-viewer", "ViewerFirst123");
        mvc.perform(post("/v2/tenant/auth/change-password").header("Authorization", "Bearer " + viewerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"ViewerFirst123\",\"newPassword\":\"ViewerNext123\"}")).andExpect(status().isNoContent());
        // a viewer reads but cannot change anything, nor see users
        mvc.perform(get("/v2/tenant/sessions").header("Authorization", "Bearer " + viewerToken)).andExpect(status().isOk());
        mvc.perform(post("/v2/tenant/client-apps").header("Authorization", "Bearer " + viewerToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"X_WEB\",\"name\":\"X\",\"channel\":\"WEB\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mvc.perform(get("/v2/tenant/users").header("Authorization", "Bearer " + viewerToken)).andExpect(status().isForbidden());
        // a reviewer can review but not build
        String reviewerToken = signIn.signInNewUser(code, "REVIEWER", adminToken());
        mvc.perform(post("/v2/tenant/document-scans/999999/review").header("Authorization", "Bearer " + reviewerToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"REJECTED\"}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus()).as("allowed, the scan just does not exist")
                        .isIn(400, 404));
        mvc.perform(put("/v2/tenant/branding").header("Authorization", "Bearer " + reviewerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isForbidden());

        // the only owner cannot lose owner access; camtech cannot take it away either
        JsonNode users = body(mvc.perform(get("/v2/tenant/users").header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk()).andReturn());
        long ownerId = users.findParents("username").stream().filter(u -> owner.equals(u.get("username").asText()))
                .findFirst().orElseThrow().get("id").asLong();
        long viewerId = users.findParents("username").stream().filter(u -> (code + "-viewer").equals(u.get("username").asText()))
                .findFirst().orElseThrow().get("id").asLong();
        mvc.perform(put("/v2/tenant/users/" + ownerId).header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"role\":\"VIEWER\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SELF_LOCKOUT"));
        mvc.perform(admin(put("/v2/admin/tenants/" + tenantId + "/users/" + ownerId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DISABLED\"}")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LAST_OWNER"));

        // disabling a user signs them out
        mvc.perform(put("/v2/tenant/users/" + viewerId).header("Authorization", "Bearer " + ownerToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DISABLED\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DISABLED"));
        mvc.perform(get("/v2/tenant/sessions").header("Authorization", "Bearer " + viewerToken)).andExpect(status().isUnauthorized());

        // camtech resets a locked-out owner: old sessions end, the new password must be changed
        JsonNode reset = body(mvc.perform(admin(post("/v2/admin/tenants/" + tenantId + "/users/" + ownerId + "/reset-password")))
                .andExpect(status().isOk()).andReturn());
        mvc.perform(get("/v2/tenant/auth/me").header("Authorization", "Bearer " + ownerToken)).andExpect(status().isUnauthorized());
        mvc.perform(post("/v2/tenant/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + owner + "\",\"password\":\"" + reset.get("password").asText() + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.mustChangePassword").value(true));
        mvc.perform(admin(get("/v2/admin/tenants/" + tenantId + "/users"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4));

        // portal actions are audited with the user's name, in the tenant's audit log
        assertThat(auditEvents.findAll()).anyMatch(e -> "TENANT_USER_UPDATED".equals(e.getAction())
                && owner.equals(e.getActor()) && e.getTenantId() == tenantId);
        assertThat(auditEvents.findAll()).anyMatch(e -> "TENANT_PASSWORD_RESET".equals(e.getAction())
                && "ADMIN".equals(e.getActorType().name()) && e.getTenantId() == tenantId);
    }

    @Test
    void brandingIsValidatedAndServedToTheSdk() throws Exception {
        mvc.perform(tenant(get("/v2/tenant/branding"), "NOQODI")).andExpect(status().isOk())
                .andExpect(jsonPath("$.themeMode").value("AUTO")).andExpect(jsonPath("$.updatedAt").doesNotExist());

        mvc.perform(tenant(put("/v2/tenant/branding"), "NOQODI").contentType(MediaType.APPLICATION_JSON)
                .content(branding("red", "system-ui", null))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        String evilSvg = "data:image/svg+xml;base64," + Base64.getEncoder().encodeToString(
                "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".getBytes(StandardCharsets.UTF_8));
        mvc.perform(tenant(put("/v2/tenant/branding"), "NOQODI").contentType(MediaType.APPLICATION_JSON)
                .content(branding("#0A7C66", "Tajawal", evilSvg))).andExpect(status().isBadRequest());

        String svg = "data:image/svg+xml;base64," + Base64.getEncoder().encodeToString(
                "<svg xmlns='http://www.w3.org/2000/svg'><circle r='4'/></svg>".getBytes(StandardCharsets.UTF_8));
        mvc.perform(tenant(put("/v2/tenant/branding"), "NOQODI").contentType(MediaType.APPLICATION_JSON)
                        .content(branding("#0a7c66", "Tajawal", svg)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.primaryColor").value("#0A7C66"))
                .andExpect(jsonPath("$.texts.ar.welcomeTitle").value("مرحبا"));

        // the SDK of any NOQODI app gets it
        mvc.perform(get("/v2/branding")).andExpect(status().isOk())
                .andExpect(jsonPath("$.fontFamily").value("Tajawal")).andExpect(jsonPath("$.logoDataUrl").value(svg));

        mvc.perform(tenant(delete("/v2/tenant/branding"), "NOQODI")).andExpect(status().isOk())
                .andExpect(jsonPath("$.fontFamily").value("system-ui"));
    }

    @Test
    void tenantSwitchesDuplicateSearchAndTheAppCapabilitiesFollow() throws Exception {
        String code = "DUP" + System.nanoTime() % 100000;
        mvc.perform(admin(post("/v2/admin/tenants").contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"" + code + "\",\"name\":\"Dedup Co\"}"))).andExpect(status().isCreated());
        JsonNode app = body(mvc.perform(tenant(post("/v2/tenant/client-apps"), code).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"APP\",\"name\":\"App\",\"channel\":\"MOBILE\"}"))
                .andExpect(status().isCreated()).andReturn());
        String caps = "/v2/tenant/client-apps/" + app.get("id").asLong() + "/capabilities";
        String selfieSteps = "$.flows[?(@.code == 'SELFIE_ID_VERIFICATION')].steps[*]";

        mvc.perform(tenant(get("/v2/tenant/duplicate-search"), code)).andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true)).andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.flows").value(org.hamcrest.Matchers.hasItem("SELFIE_ID_VERIFICATION")));
        mvc.perform(tenant(get(caps), code)).andExpect(status().isOk())
                .andExpect(jsonPath(selfieSteps).value(org.hamcrest.Matchers.hasItem("DEDUP_SEARCH")));

        mvc.perform(tenant(put("/v2/tenant/duplicate-search"), code).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(tenant(put("/v2/tenant/duplicate-search"), code).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        mvc.perform(tenant(get(caps), code)).andExpect(status().isOk())
                .andExpect(jsonPath(selfieSteps).value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("DEDUP_SEARCH"))));
        // another tenant is not affected
        mvc.perform(tenant(get("/v2/tenant/duplicate-search"), "NOQODI")).andExpect(jsonPath("$.enabled").value(true));

        // the back-office flow definitions say which step settings have an effect
        mvc.perform(admin(get("/v2/admin/flows"))).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code == 'SELFIE_ID_VERIFICATION')].steps[?(@.stepCode == 'LIVENESS')].maxAttemptsUsed").value(true))
                .andExpect(jsonPath("$[?(@.code == 'SELFIE_ID_VERIFICATION')].steps[?(@.stepCode == 'FACE_DOC_MATCH')].maxAttemptsUsed").value(false))
                .andExpect(jsonPath("$[?(@.code == 'SELFIE_ID_VERIFICATION')].steps[?(@.stepCode == 'DEDUP_SEARCH')].tenantSwitch").value("dedup.enabled"))
                .andExpect(jsonPath("$[?(@.code == 'SELFIE_ID_VERIFICATION')].enabledTenants").value(org.hamcrest.Matchers.hasItem(
                        org.hamcrest.Matchers.greaterThanOrEqualTo(2))));
    }

    @Test
    void backOfficeManagesThePlanAndSettingsOfOneTenant() throws Exception {
        String code = "PLAN" + System.nanoTime() % 100000;
        long id = body(mvc.perform(admin(post("/v2/admin/tenants").contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"" + code + "\",\"name\":\"Plan Co\"}"))).andExpect(status().isCreated()).andReturn())
                .get("id").asLong();
        long defaultDedup = body(mvc.perform(admin(get("/v2/admin/entitlements"))).andReturn()).findParents("featureCode").stream()
                .filter(e -> e.get("featureCode").asText().equals("DEDUP_SEARCH")).findFirst().orElseThrow().get("id").asLong();

        JsonNode ents = body(mvc.perform(admin(get("/v2/admin/tenants/" + id + "/entitlements"))).andExpect(status().isOk()).andReturn());
        long dedup = ents.findParents("featureCode").stream().filter(e -> e.get("featureCode").asText().equals("DEDUP_SEARCH"))
                .findFirst().orElseThrow().get("id").asLong();
        // an entitlement of another tenant is not reachable through this tenant
        mvc.perform(admin(put("/v2/admin/tenants/" + id + "/entitlements/" + defaultDedup)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false}")).andExpect(status().isNotFound());
        mvc.perform(admin(put("/v2/admin/tenants/" + id + "/entitlements/" + dedup)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false}")).andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        mvc.perform(tenant(get("/v2/tenant/duplicate-search"), code)).andExpect(jsonPath("$.available").value(false));
        mvc.perform(tenant(get("/v2/tenant/duplicate-search"), "NOQODI")).andExpect(jsonPath("$.available").value(true));

        // a setting override for this tenant only
        mvc.perform(admin(post("/v2/admin/tenants/" + id + "/config-params")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"paramKey\":\"session.ttl_minutes\",\"flowCode\":\"SELFIE_ID_VERIFICATION\",\"paramValue\":\"30\"}"))
                .andExpect(status().isCreated());
        JsonNode params = body(mvc.perform(admin(get("/v2/admin/tenants/" + id + "/config-params"))).andExpect(status().isOk()).andReturn());
        assertThat(params.findValuesAsText("paramKey")).contains("session.ttl_minutes");
        JsonNode defaults = body(mvc.perform(admin(get("/v2/admin/config-params"))).andReturn());
        assertThat(defaults.findParents("paramKey").stream().filter(p -> p.get("paramKey").asText().equals("session.ttl_minutes")
                && p.has("flowCode") && !p.get("flowCode").isNull())).isEmpty();
        mvc.perform(admin(get("/v2/admin/tenants/" + id + "/client-apps"))).andExpect(status().isOk())
                .andExpect(jsonPath("$[*].code").value(org.hamcrest.Matchers.hasItems("MOBILE_APP", "WEB_APP")));
        mvc.perform(admin(get("/v2/admin/tenants/999999/entitlements"))).andExpect(status().isNotFound());
    }

    private static String branding(String primary, String font, String logo) {
        return "{\"displayName\":\"Noqodi\",\"logoDataUrl\":" + (logo == null ? "null" : "\"" + logo + "\"")
                + ",\"primaryColor\":\"" + primary + "\",\"accentColor\":\"#12B886\",\"backgroundColor\":\"#F5F7FB\""
                + ",\"surfaceColor\":\"#FFFFFF\",\"textColor\":\"#141824\",\"borderRadius\":14,\"fontFamily\":\"" + font + "\""
                + ",\"themeMode\":\"LIGHT\",\"supportEmail\":\"help@noqodi.com\",\"supportUrl\":null"
                + ",\"privacyUrl\":\"https://www.noqodi.com/privacy\",\"showPoweredBy\":false"
                + ",\"texts\":{\"ar\":{\"welcomeTitle\":\"مرحبا\"},\"en\":{\"welcomeTitle\":\"Welcome\"}}}";
    }

    private MockHttpServletRequestBuilder tenant(MockHttpServletRequestBuilder b, String code) throws Exception {
        return b.header("Authorization", "Bearer " + signIn().token(code, adminToken()));
    }

    private synchronized TenantSignIn signIn() {
        if (signIn == null) {
            signIn = new TenantSignIn(mvc, json);
        }
        return signIn;
    }

    private MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder b) throws Exception {
        return b.header("Authorization", "Bearer " + adminToken());
    }

    private synchronized String adminToken() throws Exception {
        if (adminToken != null) {
            return adminToken;
        }
        MvcResult r = mvc.perform(post("/v2/admin/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"FirstPass123\"}")).andExpect(status().isOk()).andReturn();
        String first = body(r).get("token").asText();
        mvc.perform(post("/v2/admin/auth/change-password").header("Authorization", "Bearer " + first)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"FirstPass123\",\"newPassword\":\"" + ADMIN_PASSWORD + "\"}"))
                .andExpect(status().isNoContent());
        adminToken = first;
        return adminToken;
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsByteArray());
    }
}
