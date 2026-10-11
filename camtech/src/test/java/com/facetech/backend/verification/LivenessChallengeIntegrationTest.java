package com.facetech.backend.verification;

import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.repository.VerificationCheckRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.repository.VerificationStepRepository;
import com.facetech.backend.service.FaceEmbeddingClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Active (challenge) and passive (anti-spoof) liveness end to end, with the face service mocked:
 * it reports, for each frame, what the real service would measure.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:camtech_challenge_it;MODE=Oracle;DB_CLOSE_DELAY=-1;DEFAULT_NULL_ORDERING=HIGH",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "camtech.jobs.enabled=false",
        "camtech.backoffice.admin-password=FirstPass123",
        "ocr.provider=none"
})
@AutoConfigureMockMvc
class LivenessChallengeIntegrationTest {

    @Autowired
    MockMvc mvc;
    @Autowired
    ObjectMapper json;
    @Autowired
    VerificationSessionRepository sessions;
    @Autowired
    VerificationStepRepository steps;
    @Autowired
    VerificationCheckRepository checks;

    @MockBean
    FaceEmbeddingClient faceClient;
    @MockBean
    OcrService ocrService;
    @MockBean
    com.facetech.backend.platform.storage.ObjectStore objectStore;

    private final Map<String, byte[]> bucket = new ConcurrentHashMap<>();
    /** Builds the face service's answer from the challenge actions the test performs. */
    private final AtomicReference<Function<List<String>, FaceEmbeddingClient.LivenessMeasure>> measure = new AtomicReference<>();
    private final AtomicReference<List<String>> performed = new AtomicReference<>(List.of());
    private static String sdkToken;

    @BeforeEach
    void mocks() throws Exception {
        when(objectStore.put(anyString(), any(), anyString())).thenAnswer(inv -> {
            String uri = "oci://test-bucket/" + inv.getArgument(0);
            bucket.put(uri, inv.getArgument(1));
            return uri;
        });
        List<Double> face = vector();
        when(faceClient.embed(any(), eq("normal.jpg"), eq(FaceEmbeddingClient.ROLE_SELFIE))).thenReturn(
                new FaceEmbeddingClient.EmbedResult(face, "test-model", 0.99, 1, 0.10, false, List.of()));
        when(faceClient.embed(any(), eq("closer.jpg"), eq(FaceEmbeddingClient.ROLE_SELFIE))).thenReturn(
                new FaceEmbeddingClient.EmbedResult(face, "test-model", 0.99, 1, 0.16, false, List.of()));
        measure.set(actions -> realPerson(actions, 0.93));
        when(faceClient.liveness(any(), anyList(), anyBoolean()))
                .thenAnswer(inv -> measure.get().apply(performed.get()));
    }

    @Test
    void webSdkMustDoAChallengeAndEachChallengeWorksOnce() throws Exception {
        String[] s = start();
        // the web channel requires a challenge
        mvc.perform(liveness(s, null, 0)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CHALLENGE_REQUIRED"));

        JsonNode c = challenge(s);
        List<String> actions = actions(c);
        assertThat(actions).hasSize(2).doesNotHaveDuplicates()
                .allMatch(a -> List.of("TURN_LEFT", "TURN_RIGHT", "BLINK").contains(a));

        performed.set(actions);
        mvc.perform(liveness(s, c.get("challengeId").asText(), framesFor(actions)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.result").value("PASSED"));
        var session = sessions.findByPublicId(s[0]).orElseThrow();
        var liveness = steps.findBySessionIdOrderByIdAsc(session.getId()).get(0);
        assertThat(checks.findByStepIdInOrderByIdAsc(List.of(liveness.getId())))
                .extracting(x -> x.getCheckCode() + ":" + x.getOutcome())
                .contains("PASSIVE_ANTISPOOF:PASS", "ACTIVE_CHALLENGE:PASS");

        // a used challenge cannot back another attempt, even in another verification
        String[] other = start();
        mvc.perform(liveness(other, c.get("challengeId").asText(), framesFor(actions)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CHALLENGE_INVALID"));
    }

    @Test
    void notDoingTheRequestedActionFailsAndUsesTheChallenge() throws Exception {
        String[] s = start();
        JsonNode c = challenge(s);
        List<String> actions = actions(c);
        performed.set(List.of());   // the user just looks at the camera
        mvc.perform(liveness(s, c.get("challengeId").asText(), 4))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("CHALLENGE_FAILED"))
                .andExpect(jsonPath("$.attemptsRemaining").value(4))
                .andExpect(jsonPath("$.nextStep").value("LIVENESS"));
        performed.set(actions);
        mvc.perform(liveness(s, c.get("challengeId").asText(), framesFor(actions)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CHALLENGE_INVALID"));
        // a fresh challenge done properly passes
        JsonNode next = challenge(s);
        performed.set(actions(next));
        mvc.perform(liveness(s, next.get("challengeId").asText(), framesFor(actions(next))))
                .andExpect(status().isOk());
    }

    @Test
    void aPhotoOrScreenFailsThePassiveCheck() throws Exception {
        String[] s = start();
        JsonNode c = challenge(s);
        performed.set(actions(c));
        measure.set(actions -> realPerson(actions, 0.12));
        mvc.perform(liveness(s, c.get("challengeId").asText(), framesFor(actions(c))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SPOOF_SUSPECTED"));
    }

    // ================================================================ helpers

    /** What the face service reports for a real person doing {@code actions} (passive score {@code real}). */
    private static FaceEmbeddingClient.LivenessMeasure realPerson(List<String> actions, double real) {
        List<FaceEmbeddingClient.FrameMeasure> frames = new ArrayList<>();
        frames.add(new FaceEmbeddingClient.FrameMeasure(0, null, 1, 1.0, 0.3, 0.95, real, 0.0, 0.8, 0.10));   // closer selfie
        int i = 1;
        frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, 0.0, 0.3, 0.9, real, 0.0, 0.8, 0.10));
        for (String a : actions) {
            switch (a) {
                case "TURN_LEFT" -> frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, 28.0, 0.3, 0.85, real, 0.0, 0.8, 0.10));
                case "TURN_RIGHT" -> frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, -28.0, 0.3, 0.85, real, 0.0, 0.8, 0.10));
                default -> {
                    frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, 0.0, 0.07, 0.88, real, 0.0, 0.8, 0.10));
                    frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, 0.0, 0.31, 0.9, real, 0.0, 0.8, 0.10));
                }
            }
            frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, 0.0, 0.3, 0.9, real, 0.0, 0.8, 0.10));
        }
        while (frames.size() < 5) {
            frames.add(new FaceEmbeddingClient.FrameMeasure(i++, null, 1, 0.0, 0.3, 0.9, real, 0.0, 0.8, 0.10));
        }
        return new FaceEmbeddingClient.LivenessMeasure(true, "test-antispoof", real, frames);
    }

    private static int framesFor(List<String> actions) {
        return Math.max(4, 1 + actions.size() * 3);
    }

    private String[] start() throws Exception {
        JsonNode r = body(mvc.perform(post("/v2/selfie-verifications").header("X-Sdk-Token", sdkToken())
                .contentType(MediaType.APPLICATION_JSON).content("{\"subjectRef\":\"challenge-user\"}"))
                .andExpect(status().isCreated()).andReturn());
        return new String[]{r.get("sessionId").asText(), r.get("sessionToken").asText()};
    }

    private JsonNode challenge(String[] s) throws Exception {
        return body(mvc.perform(post("/v2/liveness-challenges").header("X-Sdk-Token", sdkToken())
                        .header("Authorization", "Bearer " + s[1]).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":\"" + s[0] + "\"}"))
                .andExpect(status().isCreated()).andReturn());
    }

    private static List<String> actions(JsonNode challenge) {
        List<String> out = new ArrayList<>();
        challenge.get("actions").forEach(a -> out.add(a.asText()));
        return out;
    }

    private MockMultipartHttpServletRequestBuilder liveness(String[] s, String challengeId, int frames) throws Exception {
        MockMultipartHttpServletRequestBuilder b = multipart("/v2/selfie-verifications/" + s[0] + "/liveness");
        b.file(image("normal")).file(image("closer"));
        for (int i = 0; i < frames; i++) {
            b.file(image("challengeFrames"));
        }
        if (challengeId != null) {
            b.param("challengeId", challengeId);
        }
        b.header("X-Sdk-Token", sdkToken()).header("Authorization", "Bearer " + s[1]);
        return b;
    }

    private String tenantToken() throws Exception {
        if (signIn == null) {
            signIn = new com.facetech.backend.tenant.TenantSignIn(mvc, json);
        }
        return signIn.token("NOQODI", adminToken());
    }

    private static String adminToken;
    private static com.facetech.backend.tenant.TenantSignIn signIn;

    private synchronized String adminToken() throws Exception {
        if (adminToken != null) {
            return adminToken;
        }
        MvcResult r = mvc.perform(post("/v2/admin/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"FirstPass123\"}")).andExpect(status().isOk()).andReturn();
        String first = json.readTree(r.getResponse().getContentAsByteArray()).get("token").asText();
        mvc.perform(post("/v2/admin/auth/change-password").header("Authorization", "Bearer " + first)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"FirstPass123\",\"newPassword\":\"AdminPass456x\"}"))
                .andExpect(status().isNoContent());
        adminToken = first;
        return adminToken;
    }

    /** An SDK token for NOQODI's WEB_APP (web channel), as the tenant's backend would get one. */
    private synchronized String sdkToken() throws Exception {
        if (sdkToken == null) {
            sdkToken = body(mvc.perform(post("/v2/tenant/playground/sdk-token")
                            .header("Authorization", "Bearer " + tenantToken())
                            .contentType(MediaType.APPLICATION_JSON).content("{\"clientAppCode\":\"WEB_APP\"}"))
                    .andExpect(status().isCreated()).andReturn()).get("sdkToken").asText();
        }
        return sdkToken;
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsByteArray());
    }

    private static MockMultipartFile image(String field) throws Exception {
        BufferedImage img = new BufferedImage(32, 24, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "jpeg", out);
        return new MockMultipartFile(field, field + ".jpg", "image/jpeg", out.toByteArray());
    }

    private static List<Double> vector() {
        List<Double> v = new ArrayList<>(Collections.nCopies(512, 0.0));
        v.set(0, 1.0);
        return v;
    }
}
