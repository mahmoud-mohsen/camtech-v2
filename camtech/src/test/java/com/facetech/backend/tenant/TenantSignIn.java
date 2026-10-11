package com.facetech.backend.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Test helper: signs in to the tenant portal as an OWNER that a camtech operator creates for the tenant. */
public final class TenantSignIn {

    public static final String FIRST_PASSWORD = "OwnerFirst123";
    public static final String PASSWORD = "OwnerPass456";

    private final MockMvc mvc;
    private final ObjectMapper json;
    private final Map<String, String> tokens = new ConcurrentHashMap<>();

    public TenantSignIn(MockMvc mvc, ObjectMapper json) {
        this.mvc = mvc;
        this.json = json;
    }

    /** Bearer token of an OWNER of the tenant (created and signed in once per tenant). */
    public String token(String tenantCode, String adminToken) throws Exception {
        String code = tenantCode.toUpperCase(Locale.ROOT);
        String cached = tokens.get(code);
        if (cached != null) {
            return cached;
        }
        String token = signInNewUser(code, "OWNER", adminToken);
        tokens.put(code, token);
        return token;
    }

    /** Creates a user with the role through the back-office API, signs in and changes the first password. */
    public String signInNewUser(String tenantCode, String role, String adminToken) throws Exception {
        long tenantId = tenantId(tenantCode, adminToken);
        String username = tenantCode.toLowerCase(Locale.ROOT) + "-" + role.toLowerCase(Locale.ROOT) + "-" + System.nanoTime();
        mvc.perform(post("/v2/admin/tenants/" + tenantId + "/users").header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"role\":\"" + role + "\",\"password\":\""
                                + FIRST_PASSWORD + "\"}"))
                .andExpect(status().isCreated());
        String token = login(username, FIRST_PASSWORD);
        mvc.perform(post("/v2/tenant/auth/change-password").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"" + FIRST_PASSWORD + "\",\"newPassword\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isNoContent());
        return token;
    }

    public String login(String username, String password) throws Exception {
        MvcResult r = mvc.perform(post("/v2/tenant/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk()).andReturn();
        return json.readTree(r.getResponse().getContentAsByteArray()).get("token").asText();
    }

    private long tenantId(String code, String adminToken) throws Exception {
        MvcResult r = mvc.perform(get("/v2/admin/tenants").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk()).andReturn();
        for (JsonNode t : json.readTree(r.getResponse().getContentAsByteArray())) {
            if (code.equals(t.get("code").asText())) {
                return t.get("id").asLong();
            }
        }
        throw new AssertionError("No tenant " + code);
    }
}
