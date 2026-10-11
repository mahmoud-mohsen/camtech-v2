package com.facetech.backend.api;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.platform.LivenessSettingsService;
import com.facetech.backend.platform.ResultTokenService;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.PartyRepository;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End to end on an in-memory Oracle-mode database built by the Liquibase
 * changelog, with the OCI bucket replaced by an in-memory store and the
 * face-embedding and OCR services mocked.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:camtech_it;MODE=Oracle;DB_CLOSE_DELAY=-1;DEFAULT_NULL_ORDERING=HIGH",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "camtech.jobs.enabled=false",
        "camtech.backoffice.admin-password=FirstPass123",
        "ocr.provider=none"
})
@AutoConfigureMockMvc
class CamtechApiIntegrationTest {

    private static final String ADMIN_PASSWORD = "NewAdminPass456";

    @Autowired
    MockMvc mvc;
    @Autowired
    ObjectMapper json;
    @Autowired
    ResultTokenService resultTokens;
    @Autowired
    VerificationSessionRepository sessions;
    @Autowired
    VerificationStepRepository steps;
    @Autowired
    VerificationCheckRepository checks;
    @Autowired
    FaceTemplateRepository templates;
    @Autowired
    PartyRepository parties;
    @Autowired
    IdentityDocumentRepository documents;
    @Autowired
    MediaFileRepository mediaFiles;
    @Autowired
    com.facetech.backend.repository.AuditEventRepository auditEvents;
    @Autowired
    com.facetech.backend.repository.OutboxEventRepository outboxEvents;
    @Autowired
    org.springframework.transaction.PlatformTransactionManager txManager;

    @MockBean
    FaceEmbeddingClient faceClient;
    @MockBean
    OcrService ocrService;
    /** Stands in for the OCI bucket: objects kept in memory, same URIs as the real store. */
    @MockBean
    com.facetech.backend.platform.storage.ObjectStore objectStore;
    private final Map<String, byte[]> bucket = new java.util.concurrent.ConcurrentHashMap<>();

    /** What the mocked face service returns for the selfies (a fresh vector keeps a test clear of the 1:N search). */
    private final AtomicReference<List<Double>> selfieEmbedding = new AtomicReference<>();
    /** What the mocked face service returns for the document portrait. */
    private final AtomicReference<List<Double>> documentEmbedding = new AtomicReference<>();
    /** Quality issues the mocked face service reports for the next "normal" selfie. */
    private final AtomicReference<List<String>> normalIssues = new AtomicReference<>(List.of());
    /** When true the mocked face service is down. */
    private final java.util.concurrent.atomic.AtomicBoolean faceServiceDown = new java.util.concurrent.atomic.AtomicBoolean();
    /** Challenge actions the "user" performs (null = just looks at the camera): the mock measures them. */
    private final AtomicReference<List<String>> performed = new AtomicReference<>();
    /** When false the mocked face service has no passive anti-spoof model. */
    private final java.util.concurrent.atomic.AtomicBoolean passiveAvailable = new java.util.concurrent.atomic.AtomicBoolean(true);

    private static final List<Double> SELFIE = vector(1.0, 0.0);
    private static String adminToken;

    @BeforeEach
    void mockFaceService() {
        when(objectStore.put(anyString(), any(), anyString())).thenAnswer(inv -> {
            String uri = "oci://test-bucket/" + inv.getArgument(0);
            bucket.put(uri, inv.getArgument(1));
            return uri;
        });
        when(objectStore.get(anyString())).thenAnswer(inv -> bucket.get((String) inv.getArgument(0)));
        documentEmbedding.set(SELFIE);
        selfieEmbedding.set(SELFIE);
        normalIssues.set(List.of());
        faceServiceDown.set(false);
        when(faceClient.embed(any(), eq("normal.jpg"), eq(FaceEmbeddingClient.ROLE_SELFIE))).thenAnswer(inv -> {
            if (faceServiceDown.get()) {
                throw new com.facetech.backend.exception.FaceMatchException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                        "FACE_SERVICE_UNAVAILABLE", "Face match service is unavailable");
            }
            return new FaceEmbeddingClient.EmbedResult(selfieEmbedding.get(), "test-model", 0.99, 1, 0.10, false, normalIssues.get());
        });
        when(faceClient.embed(any(), eq("closer.jpg"), eq(FaceEmbeddingClient.ROLE_SELFIE))).thenAnswer(inv ->
                new FaceEmbeddingClient.EmbedResult(selfieEmbedding.get(), "test-model", 0.99, 1, 0.16, false, List.of()));
        when(faceClient.embed(any(), anyString(), eq(FaceEmbeddingClient.ROLE_DOCUMENT))).thenAnswer(inv ->
                new FaceEmbeddingClient.EmbedResult(documentEmbedding.get(), "test-model", 0.95, 1, 0.3, false, List.of()));
        when(faceClient.compare(any(), anyString(), anyList()))
                .thenReturn(new FaceEmbeddingClient.CompareResult(0.9, 0, false, "test-model"));
        // Passive anti-spoof: a real face on every image (or no model when passiveAvailable is false).
        passiveAvailable.set(true);
        performed.set(null);
        when(faceClient.liveness(any(), anyList(), anyBoolean())).thenAnswer(inv -> {
            List<byte[]> frames = inv.getArgument(1);
            boolean model = passiveAvailable.get();
            List<FaceEmbeddingClient.FrameMeasure> measures = new ArrayList<>();
            if (performed.get() != null) {
                return new FaceEmbeddingClient.LivenessMeasure(model, "test-antispoof", 0.9, performedFrames(performed.get()));
            }
            for (int i = 0; i < frames.size(); i++) {
                measures.add(new FaceEmbeddingClient.FrameMeasure(i, null, 1, 0.0, 0.3, 0.95, model ? 0.9 : null, 0.0, 0.8, 0.10));
            }
            return new FaceEmbeddingClient.LivenessMeasure(model, model ? "test-antispoof" : null, model ? 0.9 : null, measures);
        });
    }

    // ================================================================ v2 selfie ID verification

    @Test
    void selfieIdVerificationHappyPathStoresEverythingAndSignsTheResult() throws Exception {
        JsonNode start = body(mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                        .header("X-Device-Id", "device-1").header("X-Platform", "android").header("X-App-Version", "3.2.0")
                        .content("{\"subjectRef\":\"usr_happy\",\"documentType\":\"EMIRATES_ID\"}"))
                .andExpect(status().isCreated()).andReturn());
        String id = start.get("sessionId").asText();
        String token = start.get("sessionToken").asText();
        assertThat(start.get("nextStep").asText()).isEqualTo("LIVENESS");

        JsonNode live = body(mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore")
                .header("Authorization", "Bearer " + token)).andExpect(status().isOk()).andReturn());
        assertThat(live.get("result").asText()).isEqualTo("PASSED");
        assertThat(live.get("nextStep").asText()).isEqualTo("DOCUMENT");

        String eid = validEid("78419901234567");
        JsonNode doc = body(mvc.perform(multipart("/v2/selfie-verifications/" + id + "/document")
                        .file(image("document")).param("documentType", "EMIRATES_ID").param("documentNumber", eid)
                        .param("expiryDate", LocalDate.now().plusYears(2).toString()).param("fullName", "TEST PERSON HAPPY")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn());
        assertThat(doc.get("result").asText()).isEqualTo("MATCH");
        assertThat(doc.get("decision").asText()).isEqualTo("APPROVED");
        assertThat(doc.get("nextStep").asText()).isEqualTo("DONE");
        assertThat(doc.has("similarity")).as("v2 never exposes scores").isFalse();

        JsonNode result = body(mvc.perform(get("/v2/selfie-verifications/" + id + "/result")
                .header("Authorization", "Bearer " + token)).andExpect(status().isOk()).andReturn());
        Map<String, Object> claims = resultTokens.verify(result.get("resultToken").asText());
        assertThat(claims).containsEntry("decision", "APPROVED").containsEntry("sid", id).containsEntry("sub", "usr_happy");

        VerificationSession s = sessions.findByPublicId(id).orElseThrow();
        assertThat(s.getStatus()).isEqualTo(Codes.SessionStatus.COMPLETED);
        assertThat(steps.findBySessionIdOrderByIdAsc(s.getId())).extracting(st -> st.getStepCode())
                .containsExactly("LIVENESS", "DOC_CAPTURE", "DOC_VALIDATION", "FACE_DOC_MATCH", "DEDUP_SEARCH");
        assertThat(templates.findBySessionId(s.getId())).hasSize(3)
                .allMatch(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED && s.getPartyId().equals(t.getPartyId()));
        assertThat(documents.findById(s.getDocumentId()).orElseThrow().getStatus()).isEqualTo(Codes.DocumentStatus.VERIFIED);
        assertThat(mediaFiles.findAll()).anyMatch(m -> m.getStorageUri().startsWith("oci://test-bucket/camtech/selfie-verifications/")
                && m.getStorageUri().contains("/" + id + "/liveness/attempt-1-normal"));

        // wrong session token is refused
        mvc.perform(get("/v2/selfie-verifications/" + id).header("Authorization", "Bearer wrong"))
                .andExpect(status().isUnauthorized());

        // face authentication against the face just enrolled
        JsonNode auth = body(mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore")
                .param("subjectRef", "usr_happy")).andExpect(status().isOk()).andReturn());
        assertThat(auth.get("decision").asText()).isEqualTo("APPROVED");
    }

    @Test
    void failedAttemptsAreKeptAndReturnTheNextStep() throws Exception {
        String id = startV2("usr_retry");
        // an outage on our side is recorded but does not use up an attempt
        faceServiceDown.set(true);
        JsonNode outage = body(mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore"))
                .andExpect(status().isServiceUnavailable()).andReturn());
        assertThat(outage.get("attemptsRemaining").asInt()).isEqualTo(5);
        faceServiceDown.set(false);

        normalIssues.set(List.of("TOO_DARK"));
        JsonNode err = body(mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore")
                        .header("Accept-Language", "ar"))
                .andExpect(status().isUnprocessableEntity()).andReturn());
        assertThat(err.get("code").asText()).isEqualTo("TOO_DARK");
        assertThat(err.get("attemptsRemaining").asInt()).isEqualTo(4);
        assertThat(err.get("nextStep").asText()).isEqualTo("LIVENESS");
        assertThat(err.get("message").asText()).contains("الإضاءة");

        normalIssues.set(List.of());
        mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore")).andExpect(status().isOk());

        VerificationSession s = sessions.findByPublicId(id).orElseThrow();
        var all = steps.findBySessionIdOrderByIdAsc(s.getId());
        assertThat(all).extracting(st -> st.getStatus().name() + ":" + st.getReasonCode())
                .containsExactly("FAILED:FACE_SERVICE_UNAVAILABLE", "FAILED:TOO_DARK", "PASSED:null");
        assertThat(checks.findByStepIdInOrderByIdAsc(List.of(all.get(1).getId())))
                .anyMatch(c -> c.getCheckCode().equals("IMAGE_QUALITY_NORMAL") && c.getOutcome() == Codes.CheckOutcome.FAIL);
    }

    // ================================================================ selfie verification, face registration

    @Test
    void livenessCheckApprovesALivePersonAndRegistersNothing() throws Exception {
        JsonNode r = body(mvc.perform(liveness("/v2/liveness-checks", "deviceAntispoofScore"))
                .andExpect(status().isOk()).andReturn());
        assertThat(r.get("decision").asText()).isEqualTo("APPROVED");
        assertThat(r.get("reasonCode").isNull()).isTrue();
        Map<String, Object> claims = resultTokens.verify(r.get("resultToken").asText());
        assertThat(claims).containsEntry("flow", "LIVENESS_CHECK").containsEntry("decision", "APPROVED").doesNotContainKey("sub");

        VerificationSession s = sessions.findByPublicId(r.get("sessionId").asText()).orElseThrow();
        assertThat(s.getFlowCode()).isEqualTo("LIVENESS_CHECK");
        assertThat(s.isEnrollFace()).isFalse();
        assertThat(s.getStatus()).isEqualTo(Codes.SessionStatus.COMPLETED);
        assertThat(templates.findBySessionId(s.getId())).as("no biometric template is kept").isEmpty();
        assertThat(steps.findBySessionIdOrderByIdAsc(s.getId())).extracting(st -> st.getStepCode()).containsExactly("LIVENESS");
        assertThat(mediaFiles.findAll()).anyMatch(m -> m.getStorageUri().contains("/liveness-checks/")
                && m.getStorageUri().contains("/" + s.getPublicId() + "/liveness/attempt-1-normal"));

        // a failed liveness is a REJECTED decision, not an error
        normalIssues.set(List.of("TOO_DARK"));
        JsonNode rejected = body(mvc.perform(liveness("/v2/liveness-checks", "deviceAntispoofScore").param("subjectRef", "usr_lc"))
                .andExpect(status().isOk()).andReturn());
        assertThat(rejected.get("decision").asText()).isEqualTo("REJECTED");
        assertThat(rejected.get("reasonCode").asText()).isEqualTo("TOO_DARK");
        assertThat(resultTokens.verify(rejected.get("resultToken").asText())).containsEntry("sub", "usr_lc");
    }

    @Test
    void faceEnrollmentRegistersTheFaceForFaceAuthenticationOnce() throws Exception {
        selfieEmbedding.set(unit(10));
        mvc.perform(liveness("/v2/face-enrollments", "deviceAntispoofScore")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore").param("subjectRef", "usr_enroll"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NO_ENROLLED_FACE"));

        JsonNode r = body(mvc.perform(liveness("/v2/face-enrollments", "deviceAntispoofScore").param("subjectRef", "usr_enroll"))
                .andExpect(status().isOk()).andReturn());
        assertThat(r.get("decision").asText()).isEqualTo("APPROVED");
        assertThat(resultTokens.verify(r.get("resultToken").asText()))
                .containsEntry("flow", "FACE_ENROLLMENT").containsEntry("sub", "usr_enroll");
        VerificationSession s = sessions.findByPublicId(r.get("sessionId").asText()).orElseThrow();
        assertThat(s.isEnrollFace()).isTrue();
        assertThat(s.getPartyId()).isNotNull();
        assertThat(steps.findBySessionIdOrderByIdAsc(s.getId())).extracting(st -> st.getStepCode() + ":" + st.getStatus())
                .containsExactly("LIVENESS:PASSED", "DEDUP_SEARCH:PASSED");
        assertThat(templates.findBySessionId(s.getId())).hasSize(2)
                .allMatch(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED && s.getPartyId().equals(t.getPartyId()));

        // the registered face is recognised
        JsonNode auth = body(mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore").param("subjectRef", "usr_enroll"))
                .andExpect(status().isOk()).andReturn());
        assertThat(auth.get("decision").asText()).isEqualTo("APPROVED");

        // a second registration is refused, before a challenge or the quota is used
        mvc.perform(post("/v2/liveness-challenges").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flow\":\"FACE_ENROLLMENT\",\"subjectRef\":\"usr_enroll\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("FACE_ALREADY_ENROLLED"));
        mvc.perform(liveness("/v2/face-enrollments", "deviceAntispoofScore").param("subjectRef", "usr_enroll"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("FACE_ALREADY_ENROLLED"));
    }

    @Test
    void aFaceRegisteredToAnotherPersonGoesToReviewAndIsRegisteredOnlyWhenApproved() throws Exception {
        selfieEmbedding.set(unit(11));
        enroll("usr_dup_original", unit(11));
        JsonNode r = body(mvc.perform(liveness("/v2/face-enrollments", "deviceAntispoofScore").param("subjectRef", "usr_dup_copy"))
                .andExpect(status().isOk()).andReturn());
        assertThat(r.get("decision").asText()).isEqualTo("REVIEW");
        assertThat(r.get("reasonCode").asText()).isEqualTo("DUPLICATE_IDENTITY");
        VerificationSession s = sessions.findByPublicId(r.get("sessionId").asText()).orElseThrow();
        assertThat(templates.findBySessionId(s.getId())).isNotEmpty().allMatch(t -> t.getStatus() == Codes.TemplateStatus.SESSION);

        String token = adminToken();
        JsonNode queue = body(mvc.perform(admin(get("/v2/admin/review-cases").param("status", "OPEN"), token))
                .andExpect(status().isOk()).andReturn());
        long caseId = -1;
        for (JsonNode c : queue.get("items")) {
            if (c.get("sessionPublicId").asText().equals(s.getPublicId())) {
                caseId = c.get("id").asLong();
            }
        }
        assertThat(caseId).isPositive();
        JsonNode decided = body(mvc.perform(admin(post("/v2/admin/review-cases/" + caseId + "/decide")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"APPROVED\",\"note\":\"Twins, checked\"}"), token))
                .andExpect(status().isOk()).andReturn());
        assertThat(decided.get("session").get("enrollFace").asBoolean()).isTrue();
        assertThat(decided.get("session").get("faceRegistered").asBoolean()).isTrue();
        assertThat(templates.findBySessionId(s.getId())).allMatch(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED);
    }

    @Test
    void selfieIdVerificationRegistersTheFaceOnlyWhenAskedAndAllowed() throws Exception {
        selfieEmbedding.set(unit(12));
        documentEmbedding.set(unit(12));
        JsonNode start = body(mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subjectRef\":\"usr_verify_only\",\"documentType\":\"EMIRATES_ID\",\"enrollFace\":false}"))
                .andExpect(status().isCreated()).andReturn());
        assertThat(start.get("enrollFace").asBoolean()).isFalse();
        String id = start.get("sessionId").asText();
        String token = start.get("sessionToken").asText();
        mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore")
                .header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        mvc.perform(multipart("/v2/selfie-verifications/" + id + "/document")
                        .file(image("document")).param("documentType", "EMIRATES_ID").param("documentNumber", validEid("78419905556667"))
                        .param("expiryDate", LocalDate.now().plusYears(2).toString()).param("fullName", "TEST PERSON VERIFY ONLY")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.decision").value("APPROVED"));
        VerificationSession s = sessions.findByPublicId(id).orElseThrow();
        assertThat(templates.findBySessionId(s.getId())).isNotEmpty()
                .as("verified, but the face is not registered").allMatch(t -> t.getStatus() == Codes.TemplateStatus.SESSION);
        mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore").param("subjectRef", "usr_verify_only"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NO_ENROLLED_FACE"));

        // retention deletes the unregistered templates of ended sessions; registered faces stay
        long registered = templates.findAll().stream().filter(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED).count();
        new org.springframework.transaction.support.TransactionTemplate(txManager).executeWithoutResult(st ->
                templates.deleteUnregisteredEndedBefore(java.time.Instant.now().plusSeconds(60)));
        assertThat(templates.findBySessionId(s.getId())).isEmpty();
        assertThat(templates.findAll().stream().filter(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED).count()).isEqualTo(registered);

        // capabilities say whether the app may register faces; without FACE_ENROLLMENT enrollFace=true is refused
        JsonNode caps = body(mvc.perform(get("/v2/capabilities")).andExpect(status().isOk()).andReturn());
        assertThat(flow(caps, "SELFIE_ID_VERIFICATION").get("settings").get("faceEnrollmentAvailable").asBoolean()).isTrue();
        assertThat(flow(caps, "LIVENESS_CHECK")).isNotNull();
        assertThat(json.convertValue(flow(caps, "FACE_ENROLLMENT").get("steps"), List.class)).containsExactly("LIVENESS", "DEDUP_SEARCH");
        assertThat(flow(caps, "FACE_ENROLLMENT").get("settings").get("livenessMode").asText()).isEqualTo("ACTIVE");

        String admin = adminToken();
        long enrollmentId = -1;
        for (JsonNode e : body(mvc.perform(admin(get("/v2/admin/entitlements"), admin)).andExpect(status().isOk()).andReturn())) {
            if (e.get("featureCode").asText().equals("FACE_ENROLLMENT")) {
                enrollmentId = e.get("id").asLong();
            }
        }
        assertThat(enrollmentId).isPositive();
        mvc.perform(admin(put("/v2/admin/entitlements/" + enrollmentId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false,\"quotaPerDay\":null,\"validUntil\":null}"), admin)).andExpect(status().isOk());
        try {
            mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subjectRef\":\"usr_no_enroll\",\"enrollFace\":true}"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FEATURE_NOT_ENABLED"));
            JsonNode implicit = body(mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"subjectRef\":\"usr_no_enroll\"}")).andExpect(status().isCreated()).andReturn());
            assertThat(implicit.get("enrollFace").asBoolean()).as("omitted = only when allowed").isFalse();
        } finally {
            mvc.perform(admin(put("/v2/admin/entitlements/" + enrollmentId).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"enabled\":true,\"quotaPerDay\":null,\"validUntil\":null}"), admin)).andExpect(status().isOk());
        }
    }

    @Test
    void aChallengeWorksOnlyForTheFlowItWasIssuedFor() throws Exception {
        enroll("usr_challenge_flow", unit(13));
        selfieEmbedding.set(unit(13));
        // both flows start PASSIVE (no challenge): the tenant picks ACTIVE
        for (String f : List.of("LIVENESS_CHECK", "FACE_AUTHENTICATION")) {
            mvc.perform(tenant(put("/v2/tenant/flows/" + f + "/liveness")).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"mode\":\"ACTIVE\",\"actions\":[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"],\"challengeCount\":2}"))
                    .andExpect(status().isOk());
        }
        try {
            challengeOfOneFlowFailsInAnother();
        } finally {
            restoreStartingPolicy(1L, "LIVENESS_CHECK");
            restoreStartingPolicy(1L, "FACE_AUTHENTICATION");
        }
    }

    private void challengeOfOneFlowFailsInAnother() throws Exception {
        JsonNode c = body(mvc.perform(post("/v2/liveness-challenges").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flow\":\"LIVENESS_CHECK\",\"subjectRef\":\"usr_challenge_flow\"}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore").param("subjectRef", "usr_challenge_flow")
                        .param("challengeId", c.get("challengeId").asText()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CHALLENGE_INVALID"));
        mvc.perform(post("/v2/liveness-challenges").contentType(MediaType.APPLICATION_JSON).content("{\"flow\":\"NOPE\"}"))
                .andExpect(status().isBadRequest());

        // the same challenge still works for the flow it was issued for
        List<String> actions = json.convertValue(c.get("actions"), List.class);
        performed.set(actions);
        var upload = (MockMultipartHttpServletRequestBuilder) multipart("/v2/liveness-checks").file(image("normal"))
                .param("subjectRef", "usr_challenge_flow").param("challengeId", c.get("challengeId").asText())
                .param("deviceAntispoofScore", "0.95");
        for (int i = 0; i < performedFrames(actions).size(); i++) {
            upload.file(image("challengeFrames"));
        }
        mvc.perform(upload).andExpect(status().isOk()).andExpect(jsonPath("$.decision").value("APPROVED"));
    }


    // ================================================================ legacy Face Tech + review queue

    @Test
    void legacyFaceTechEndpointsKeepTheirContractAndReviewCasesCanBeDecided() throws Exception {
        JsonNode created = body(mvc.perform(post("/face-tech/sessions")).andExpect(status().isCreated()).andReturn());
        String id = created.get("session_id").asText();
        assertThat(created.get("status").asText()).isEqualTo("CREATED");
        assertThat(created.has("expires_at")).isTrue();

        normalIssues.set(List.of("BLURRY"));
        JsonNode err = body(mvc.perform(liveness("/face-tech/sessions/" + id + "/liveness", "device_antispoof_score"))
                .andExpect(status().isUnprocessableEntity()).andReturn());
        assertThat(err.get("code").asText()).isEqualTo("BLURRY");
        assertThat(err.has("detail")).isTrue();
        normalIssues.set(List.of());

        JsonNode live = body(mvc.perform(liveness("/face-tech/sessions/" + id + "/liveness", "device_antispoof_score"))
                .andExpect(status().isOk()).andReturn());
        assertThat(live.get("status").asText()).isEqualTo("LIVENESS_PASSED");
        assertThat(live.get("closer_area_gain").asDouble()).isGreaterThan(1.1);

        // cosine 0.33 -> review band, three times
        documentEmbedding.set(vector(0.33, Math.sqrt(1 - 0.33 * 0.33)));
        JsonNode v = null;
        for (int i = 0; i < 3; i++) {
            v = body(mvc.perform(multipart("/face-tech/sessions/" + id + "/verify").file(image("document"))
                    .param("document_type", "EMIRATES_ID")).andExpect(status().isOk()).andReturn());
            assertThat(v.get("decision").asText()).isEqualTo("REVIEW");
            assertThat(v.get("attempts_remaining").asInt()).isEqualTo(2 - i);
        }
        mvc.perform(multipart("/face-tech/sessions/" + id + "/verify").file(image("document"))
                .param("document_type", "EMIRATES_ID")).andExpect(status().isTooManyRequests());

        VerificationSession s = sessions.findByPublicId(id).orElseThrow();
        assertThat(s.getDecision()).isEqualTo(Codes.Decision.REVIEW);

        String token = adminToken();
        JsonNode queue = body(mvc.perform(admin(get("/v2/admin/review-cases").param("status", "OPEN"), token))
                .andExpect(status().isOk()).andReturn());
        long caseId = -1;
        for (JsonNode c : queue.get("items")) {
            if (c.get("sessionPublicId").asText().equals(id)) {
                caseId = c.get("id").asLong();
            }
        }
        assertThat(caseId).isPositive();
        mvc.perform(admin(post("/v2/admin/review-cases/" + caseId + "/assign"), token)).andExpect(status().isOk());
        JsonNode decided = body(mvc.perform(admin(post("/v2/admin/review-cases/" + caseId + "/decide")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"APPROVED\",\"note\":\"Same person, glare on card\"}"), token))
                .andExpect(status().isOk()).andReturn());
        assertThat(decided.get("status").asText()).isEqualTo("APPROVED");
        assertThat(decided.get("session").get("decision").get("decidedBy").asText()).isEqualTo("USER");
        assertThat(decided.get("actions")).hasSize(3);
        mvc.perform(admin(post("/v2/admin/review-cases/" + caseId + "/decide").contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"REJECTED\",\"note\":\"x\"}"), token)).andExpect(status().isConflict());
        List<FaceTemplate> enrolled = templates.findBySessionId(s.getId());
        assertThat(enrolled).allMatch(t -> t.getStatus() == Codes.TemplateStatus.ENROLLED);
    }

    @Test
    void tenantReviewersDecideTheirOwnReviewCases() throws Exception {
        JsonNode created = body(mvc.perform(post("/face-tech/sessions")).andExpect(status().isCreated()).andReturn());
        String id = created.get("session_id").asText();
        mvc.perform(liveness("/face-tech/sessions/" + id + "/liveness", "device_antispoof_score")).andExpect(status().isOk());
        documentEmbedding.set(vector(0.33, Math.sqrt(1 - 0.33 * 0.33)));
        for (int i = 0; i < 3; i++) {
            mvc.perform(multipart("/face-tech/sessions/" + id + "/verify").file(image("document"))
                    .param("document_type", "EMIRATES_ID")).andExpect(status().isOk());
        }

        // the tenant sees the case with a match label, never the score
        JsonNode queue = body(mvc.perform(tenant(get("/v2/tenant/review-cases").param("status", "OPEN")))
                .andExpect(status().isOk()).andReturn());
        JsonNode item = null;
        for (JsonNode c : queue.get("items")) {
            if (c.get("sessionPublicId").asText().equals(id)) {
                item = c;
            }
        }
        assertThat(item).isNotNull();
        assertThat(item.get("matchLabel").asText()).isEqualTo("WEAK");
        assertThat(item.has("finalSimilarity")).isFalse();
        long caseId = item.get("id").asLong();
        JsonNode detail = body(mvc.perform(tenant(get("/v2/tenant/review-cases/" + caseId))).andExpect(status().isOk()).andReturn());
        assertThat(detail.get("canDecide").asBoolean()).isTrue();
        assertThat(detail.toString()).doesNotContain("finalSimilarity").doesNotContain("0.33");

        // viewers cannot decide; reviewers can
        String viewer = signIn.signInNewUser("NOQODI", "VIEWER", adminToken());
        mvc.perform(post("/v2/tenant/review-cases/" + caseId + "/decide").header("Authorization", "Bearer " + viewer)
                .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"REJECTED\",\"note\":\"x\"}"))
                .andExpect(status().isForbidden());
        String reviewer = signIn.signInNewUser("NOQODI", "REVIEWER", adminToken());
        mvc.perform(post("/v2/tenant/review-cases/" + caseId + "/assign").header("Authorization", "Bearer " + reviewer)
                .contentType(MediaType.APPLICATION_JSON).content("{\"assignee\":\"someone-at-camtech\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/v2/tenant/review-cases/" + caseId + "/assign").header("Authorization", "Bearer " + reviewer))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("IN_REVIEW"));
        JsonNode decided = body(mvc.perform(post("/v2/tenant/review-cases/" + caseId + "/decide")
                        .header("Authorization", "Bearer " + reviewer).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"REJECTED\",\"note\":\"Different person\"}"))
                .andExpect(status().isOk()).andReturn());
        assertThat(decided.get("status").asText()).isEqualTo("REJECTED");
        assertThat(decided.get("canDecide").asBoolean()).isFalse();
        assertThat(decided.get("evidence")).isEmpty();
        assertThat(decided.get("actions").findValuesAsText("note")).contains("Different person");
        assertThat(sessions.findByPublicId(id).orElseThrow().getDecision()).isEqualTo(Codes.Decision.REJECTED);
        assertThat(outboxEvents.findAll()).anyMatch(e -> "REVIEW_DECIDED".equals(e.getEventType())
                && e.getPayload().contains("\"decidedBy\":\"TENANT\"") && e.getPayload().contains("\"reviewer\""));

        // when camtech reviews, the tenant can only look
        mvc.perform(tenant(put("/v2/tenant/review-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"owner\":\"CAMTECH\"}")).andExpect(status().isOk());
        mvc.perform(post("/v2/tenant/review-cases/" + caseId + "/comment").header("Authorization", "Bearer " + reviewer)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"late\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("REVIEW_OWNED_BY_CAMTECH"));
        mvc.perform(tenant(get("/v2/tenant/review-cases/" + caseId))).andExpect(status().isOk());
        mvc.perform(tenant(put("/v2/tenant/review-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"owner\":\"TENANT\"}")).andExpect(status().isOk());
    }

    // ================================================================ tenant configuration

    @Test
    void entitlementsQuotasAndCapabilitiesAreEnforced() throws Exception {
        String token = adminToken();
        JsonNode ents = body(mvc.perform(admin(get("/v2/admin/entitlements"), token)).andExpect(status().isOk()).andReturn());
        long flowId = -1;
        for (JsonNode e : ents) {
            assertThat(e.get("quotaPerDay").isNull()).as("NOQODI has no quota on " + e.get("featureCode")).isTrue();
            if (e.get("featureCode").asText().equals("FACE_AUTHENTICATION")) {
                flowId = e.get("id").asLong();
            }
        }

        JsonNode caps = body(mvc.perform(get("/v2/capabilities")).andExpect(status().isOk()).andReturn());
        assertThat(caps.get("clientApp").asText()).isEqualTo("MOBILE_APP");
        assertThat(caps.toString()).contains("SELFIE_ID_VERIFICATION").doesNotContain("doc_match_similarity");
        String etag = mvc.perform(get("/v2/capabilities")).andReturn().getResponse().getHeader("ETag");
        mvc.perform(get("/v2/capabilities").header("If-None-Match", etag)).andExpect(status().isNotModified());

        // disable face authentication -> 403, then a quota of 0 -> 429
        mvc.perform(admin(put("/v2/admin/entitlements/" + flowId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false,\"quotaPerDay\":null,\"validUntil\":null}"), token)).andExpect(status().isOk());
        JsonNode denied = body(mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore").param("subjectRef", "nobody"))
                .andExpect(status().isForbidden()).andReturn());
        assertThat(denied.get("code").asText()).isEqualTo("FEATURE_NOT_ENABLED");
        mvc.perform(admin(put("/v2/admin/entitlements/" + flowId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true,\"quotaPerDay\":null,\"validUntil\":null}"), token)).andExpect(status().isOk());

        // a channel override wins over the base value; invalid values are refused
        mvc.perform(admin(post("/v2/admin/config-params").contentType(MediaType.APPLICATION_JSON)
                .content("{\"channel\":\"MOBILE\",\"paramKey\":\"liveness.max_attempts\",\"paramValue\":\"2\"}"), token))
                .andExpect(status().isCreated());
        mvc.perform(admin(post("/v2/admin/config-params").contentType(MediaType.APPLICATION_JSON)
                .content("{\"paramKey\":\"face.doc_match_similarity\",\"flowCode\":\"SELFIE_ID_VERIFICATION\",\"paramValue\":\"7\"}"), token))
                .andExpect(status().isBadRequest());
        JsonNode capsAfter = body(mvc.perform(get("/v2/capabilities")).andExpect(status().isOk()).andReturn());
        assertThat(capsAfter.toString()).contains("\"livenessMaxAttempts\":2");
    }

    // ================================================================ liveness settings per flow

    @Test
    void releasedMobileAppWithoutChallengeIsAcceptedButThePassiveCheckIsRequired() throws Exception {
        // the 1.2.0 migration allows uploads without a challenge on the MOBILE channel (the default app here)
        String id = startV2("usr_old_app");
        mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore")).andExpect(status().isOk());
        VerificationSession s = sessions.findByPublicId(id).orElseThrow();
        assertThat(s.getLivenessMode()).isEqualTo(Codes.LivenessMode.ACTIVE);
        var step = steps.findBySessionIdOrderByIdAsc(s.getId()).get(0);
        var recorded = checks.findByStepIdInOrderByIdAsc(List.of(step.getId()));
        assertThat(recorded).extracting(c -> c.getCheckCode() + ":" + c.getOutcome())
                .contains("ACTIVE_CHALLENGE:SKIPPED", "PASSIVE_ANTISPOOF:PASS", "IMAGE_QUALITY_CLOSER:PASS",
                        "SAME_PERSON_NORMAL_CLOSER:PASS", "CLOSER_AREA_GAIN:PASS");
        assertThat(recorded).filteredOn(c -> c.getCheckCode().equals("ACTIVE_CHALLENGE"))
                .allMatch(c -> c.getDetails().contains("client without challenge support"));

        // without the passive model such an upload cannot pass
        String other = startV2("usr_old_app_2");
        passiveAvailable.set(false);
        JsonNode err = body(mvc.perform(liveness("/v2/selfie-verifications/" + other + "/liveness", "deviceAntispoofScore"))
                .andExpect(status().isServiceUnavailable()).andReturn());
        assertThat(err.get("code").asText()).isEqualTo("LIVENESS_UNAVAILABLE");
        passiveAvailable.set(true);

        // the released app keeps seeing "no challenge required"; the new fields describe the flow's settings
        JsonNode caps = body(mvc.perform(get("/v2/capabilities")).andExpect(status().isOk()).andReturn());
        JsonNode selfie = flow(caps, "SELFIE_ID_VERIFICATION").get("settings");
        assertThat(selfie.get("livenessChallengeRequired").asBoolean()).isFalse();
        assertThat(selfie.get("livenessMode").asText()).isEqualTo("ACTIVE");
        assertThat(json.convertValue(selfie.get("challengeActions"), List.class)).containsExactly("TURN_LEFT", "TURN_RIGHT", "BLINK",
                "LOOK_UP", "LOOK_DOWN", "SMILE", "MOVE_CLOSER");
        assertThat(selfie.get("challengeCount").asInt()).isEqualTo(2);
        JsonNode scan = flow(caps, "DOCUMENT_SCAN");
        if (scan != null) {
            assertThat(scan.get("settings").has("livenessMode")).as("only liveness flows have liveness settings").isFalse();
        }
    }

    @Test
    void challengesAreDrawnFromWhatTheClientSupports() throws Exception {
        JsonNode start = body(mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectRef\":\"usr_draw\"}")).andExpect(status().isCreated()).andReturn());
        String id = start.get("sessionId").asText();
        String token = start.get("sessionToken").asText();
        // an old client (no supportedActions) gets two of the original three
        JsonNode c = body(mvc.perform(challenge(id, token, null)).andExpect(status().isCreated()).andReturn());
        assertThat(json.convertValue(c.get("actions"), List.class)).hasSize(2).doesNotHaveDuplicates()
                .isSubsetOf("TURN_LEFT", "TURN_RIGHT", "BLINK");
        String newActions = "{\"mode\":\"ACTIVE\",\"actions\":[\"BLINK\",\"LOOK_UP\",\"LOOK_DOWN\",\"SMILE\"],\"challengeCount\":2}";
        try {
            // every challenge is allowed by default
            mvc.perform(tenant(put("/v2/tenant/flows/SELFIE_ID_VERIFICATION/liveness"))
                            .contentType(MediaType.APPLICATION_JSON).content(newActions))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.customized").value(true));
            // of that selection, the old client can only show BLINK
            mvc.perform(challenge(id, token, null)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("CHALLENGE_REQUIRED"));
            JsonNode next = body(mvc.perform(challenge(id, token, "[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\",\"LOOK_UP\",\"LOOK_DOWN\",\"SMILE\",\"MOVE_CLOSER\"]"))
                    .andExpect(status().isCreated()).andReturn());
            assertThat(json.convertValue(next.get("actions"), List.class)).hasSize(2).doesNotHaveDuplicates()
                    .isSubsetOf("BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE");
        } finally {
            restoreStartingPolicy(1L, "SELFIE_ID_VERIFICATION");
        }
    }

    @Test
    void moveCloserChallengeReplacesTheCloserSelfie() throws Exception {
        JsonNode start = body(mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectRef\":\"usr_move_closer\"}")).andExpect(status().isCreated()).andReturn());
        String id = start.get("sessionId").asText();
        String token = start.get("sessionToken").asText();
        try {
            putPolicy(1L, "SELFIE_ID_VERIFICATION", "[\"ACTIVE\"]", "[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\",\"LOOK_UP\",\"LOOK_DOWN\",\"SMILE\",\"MOVE_CLOSER\"]", 2, 4, false).andExpect(status().isOk());
            mvc.perform(tenant(put("/v2/tenant/flows/SELFIE_ID_VERIFICATION/liveness")).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"mode\":\"ACTIVE\",\"actions\":[\"TURN_LEFT\",\"MOVE_CLOSER\"],\"challengeCount\":2}"))
                    .andExpect(status().isOk());
            // an old client cannot show MOVE_CLOSER
            mvc.perform(challenge(id, token, null)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("CHALLENGE_REQUIRED"));
            JsonNode c = body(mvc.perform(challenge(id, token, "[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\",\"LOOK_UP\",\"LOOK_DOWN\",\"SMILE\",\"MOVE_CLOSER\"]")).andExpect(status().isCreated()).andReturn());
            @SuppressWarnings("unchecked")
            List<String> actions = json.convertValue(c.get("actions"), List.class);
            assertThat(actions).containsExactlyInAnyOrder("TURN_LEFT", "MOVE_CLOSER");

            performed.set(actions);
            var upload = multipart("/v2/selfie-verifications/" + id + "/liveness").file(image("normal"));
            for (int i = 0; i < performedFrames(actions).size(); i++) {
                upload.file(image("challengeFrames"));
            }
            mvc.perform(upload.param("deviceAntispoofScore", "0.95").param("challengeId", c.get("challengeId").asText())
                    .header("Authorization", "Bearer " + token)).andExpect(status().isOk())
                    .andExpect(jsonPath("$.result").value("PASSED"));
            VerificationSession s = sessions.findByPublicId(id).orElseThrow();
            var recorded = checks.findByStepIdInOrderByIdAsc(List.of(steps.findBySessionIdOrderByIdAsc(s.getId()).get(0).getId()));
            assertThat(recorded).extracting(x -> x.getCheckCode() + ":" + x.getOutcome())
                    .contains("ACTIVE_CHALLENGE:PASS", "PASSIVE_ANTISPOOF:PASS")
                    .as("the challenge covers the closer selfie").noneMatch(x -> x.contains("CLOSER"));
            assertThat(templates.findBySessionId(s.getId())).extracting(FaceTemplate::getPose).containsExactly("normal");
            // the document step works with the normal selfie alone
            mvc.perform(multipart("/v2/selfie-verifications/" + id + "/document").file(image("document"))
                    .param("documentType", "PASSPORT").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        } finally {
            performed.set(null);
            restoreStartingPolicy(1L, "SELFIE_ID_VERIFICATION");
            erase("usr_move_closer");
        }
    }

    @Test
    void tenantSettingsAreCheckedAgainstThePolicy() throws Exception {
        JsonNode flows = body(mvc.perform(tenant(get("/v2/tenant/flows"))).andExpect(status().isOk()).andReturn());
        assertThat(flows).extracting(f -> f.get("flowCode").asText())
                .containsExactly("SELFIE_ID_VERIFICATION", "FACE_AUTHENTICATION", "LIVENESS_CHECK", "FACE_ENROLLMENT");
        JsonNode selfie = flows.get(0);
        assertThat(selfie.get("flowName").asText()).isEqualTo("Selfie ID verification");
        assertThat(selfie.get("policy").get("minActions").asInt()).isEqualTo(2);
        assertThat(selfie.get("policy").get("requireSpareAction").asBoolean()).isTrue();
        assertThat(selfie.get("policy").get("allowedActions")).as("all challenges allowed by default").hasSize(7);
        assertThat(json.convertValue(selfie.get("actions"), List.class)).as("and selected").containsExactly(
                "TURN_LEFT", "TURN_RIGHT", "BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE", "MOVE_CLOSER");
        assertThat(selfie.get("challengeCount").asInt()).isEqualTo(2);
        assertThat(selfie.get("customized").asBoolean()).isFalse();

        String url = "/v2/tenant/flows/SELFIE_ID_VERIFICATION/liveness";
        putPolicy(1L, "SELFIE_ID_VERIFICATION", "[\"ACTIVE\"]", "[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"]", 2, 4, true)
                .andExpect(status().isOk());
        assertThat(saveError(url, "PASSIVE", "\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"", 2)).isEqualTo("MODE_NOT_ALLOWED");
        assertThat(saveError(url, "SOMETIMES", "\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"", 2)).isEqualTo("VALIDATION_ERROR");
        assertThat(saveError(url, "ACTIVE", "\"TURN_LEFT\",\"WINK\"", 1)).isEqualTo("VALIDATION_ERROR");
        assertThat(saveError(url, "ACTIVE", "\"TURN_LEFT\",\"TURN_LEFT\",\"BLINK\"", 2)).isEqualTo("DUPLICATE_ACTION");
        assertThat(saveError(url, "ACTIVE", "\"TURN_LEFT\",\"SMILE\",\"BLINK\"", 2)).isEqualTo("ACTION_NOT_ALLOWED");
        assertThat(saveError(url, "ACTIVE", "\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"", 5)).isEqualTo("COUNT_OUT_OF_RANGE");
        assertThat(saveError(url, "ACTIVE", "\"TURN_LEFT\",\"TURN_RIGHT\"", 3)).isEqualTo("COUNT_EXCEEDS_SELECTION");
        assertThat(saveError(url, "ACTIVE", "\"TURN_LEFT\",\"TURN_RIGHT\"", 2)).isEqualTo("SPARE_ACTION_REQUIRED");
        mvc.perform(tenant(put("/v2/tenant/flows/ONBOARDING/liveness")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"mode\":\"ACTIVE\",\"actions\":[\"BLINK\"],\"challengeCount\":1}")).andExpect(status().isNotFound());

        try {
            JsonNode saved = body(mvc.perform(tenant(put(url)).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"mode\":\"ACTIVE\",\"actions\":[\"BLINK\",\"TURN_LEFT\",\"TURN_RIGHT\"],\"challengeCount\":2}"))
                    .andExpect(status().isOk()).andReturn());
            assertThat(saved.get("customized").asBoolean()).isTrue();
            assertThat(saved.get("updatedAt").isNull()).isFalse();
            assertThat(json.convertValue(saved.get("actions"), List.class)).containsExactly("TURN_LEFT", "TURN_RIGHT", "BLINK");
            assertThat(auditEvents.findAll()).anyMatch(e -> e.getAction().equals("LIVENESS_SETTINGS_UPDATED")
                    && e.getActorType() == Codes.ActorType.TENANT);
        } finally {
            restoreStartingPolicy(1L, "SELFIE_ID_VERIFICATION");
        }
    }

    @Test
    void faceAuthenticationIsPassiveByDefaultAndTheTenantCanSwitchToActive() throws Exception {
        enroll("usr_passive");
        String token = adminToken();
        long allowRow = -1;
        for (JsonNode p : body(mvc.perform(admin(get("/v2/admin/config-params"), token)).andExpect(status().isOk()).andReturn())) {
            if (p.get("paramKey").asText().equals("liveness.allow_without_challenge") && "MOBILE".equals(p.get("channel").asText())) {
                allowRow = p.get("id").asLong();
            }
        }
        assertThat(allowRow).as("seeded by the 1.2.0 migration").isPositive();
        try {
            // the MOBILE app may no longer skip a challenge: face authentication still needs none, it starts PASSIVE
            mvc.perform(admin(put("/v2/admin/config-params/" + allowRow).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"paramValue\":\"false\"}"), token)).andExpect(status().isOk());
            JsonNode caps = body(mvc.perform(get("/v2/capabilities")).andExpect(status().isOk()).andReturn());
            JsonNode settings = flow(caps, "FACE_AUTHENTICATION").get("settings");
            assertThat(settings.get("livenessMode").asText()).isEqualTo("PASSIVE");
            assertThat(settings.get("livenessChallengeRequired").asBoolean()).isFalse();

            mvc.perform(post("/v2/liveness-challenges").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subjectRef\":\"usr_passive\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CHALLENGE_NOT_USED"));
            // PASSIVE: only the normal selfie
            JsonNode ok = body(mvc.perform(multipart("/v2/face-authentications").file(image("normal"))
                            .param("deviceAntispoofScore", "0.95").param("subjectRef", "usr_passive"))
                    .andExpect(status().isOk()).andReturn());
            assertThat(ok.get("decision").asText()).isEqualTo("APPROVED");
            VerificationSession s = sessions.findByPublicId(ok.get("sessionId").asText()).orElseThrow();
            assertThat(s.getLivenessMode()).isEqualTo(Codes.LivenessMode.PASSIVE);
            var recorded = checks.findByStepIdInOrderByIdAsc(steps.findBySessionIdOrderByIdAsc(s.getId()).stream()
                    .map(st -> st.getId()).toList());
            assertThat(recorded).extracting(c -> c.getCheckCode() + ":" + c.getOutcome()).contains("PASSIVE_ANTISPOOF:PASS",
                            "IMAGE_QUALITY_CLOSER:SKIPPED", "SAME_PERSON_NORMAL_CLOSER:SKIPPED", "CLOSER_AREA_GAIN:SKIPPED")
                    .noneMatch(x -> x.startsWith("ACTIVE_CHALLENGE"));
            assertThat(recorded).filteredOn(c -> c.getCheckCode().equals("CLOSER_AREA_GAIN"))
                    .allMatch(c -> c.getDetails().contains("no closer selfie"));

            // without the passive model a PASSIVE authentication cannot pass
            passiveAvailable.set(false);
            JsonNode rejected = body(mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore")
                    .param("subjectRef", "usr_passive")).andExpect(status().isOk()).andReturn());
            assertThat(rejected.get("decision").asText()).isEqualTo("REJECTED");
            assertThat(rejected.get("reasonCode").asText()).isEqualTo("LIVENESS_UNAVAILABLE");
            passiveAvailable.set(true);

            // the tenant switches to ACTIVE: a challenge is then required
            mvc.perform(tenant(put("/v2/tenant/flows/FACE_AUTHENTICATION/liveness")).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"mode\":\"ACTIVE\",\"actions\":[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"],\"challengeCount\":2}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.mode").value("ACTIVE"));
            mvc.perform(liveness("/v2/face-authentications", "deviceAntispoofScore").param("subjectRef", "usr_passive"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CHALLENGE_REQUIRED"));
            caps = body(mvc.perform(get("/v2/capabilities")).andExpect(status().isOk()).andReturn());
            settings = flow(caps, "FACE_AUTHENTICATION").get("settings");
            assertThat(settings.get("livenessMode").asText()).isEqualTo("ACTIVE");
            assertThat(settings.get("livenessChallengeRequired").asBoolean()).isTrue();
        } finally {
            passiveAvailable.set(true);
            mvc.perform(admin(put("/v2/admin/config-params/" + allowRow).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"paramValue\":\"true\"}"), token)).andExpect(status().isOk());
            restoreStartingPolicy(1L, "FACE_AUTHENTICATION");
            erase("usr_passive");
        }
    }

    @Test
    void backOfficeSetsTheLimitsAndResolvesConflictsWithTheTenantSettings() throws Exception {
        String token = adminToken();
        JsonNode all = body(mvc.perform(admin(get("/v2/admin/tenants/1/liveness-policies"), token)).andExpect(status().isOk()).andReturn());
        assertThat(all).extracting(f -> f.get("flowCode").asText())
                .containsExactly("SELFIE_ID_VERIFICATION", "FACE_AUTHENTICATION", "LIVENESS_CHECK", "FACE_ENROLLMENT");
        assertThat(all.get(0).get("policy").get("allowedModes").toString()).isEqualTo("[\"ACTIVE\"]");
        assertThat(all.get(0).get("settings").get("challengeCount").asInt()).isEqualTo(2);
        // face authentication and the liveness check start PASSIVE, and the tenant may switch them to ACTIVE
        for (int i : new int[]{1, 2}) {
            assertThat(all.get(i).get("policy").get("allowedModes").toString()).isEqualTo("[\"ACTIVE\",\"PASSIVE\"]");
            assertThat(all.get(i).get("settings").get("mode").asText()).isEqualTo("PASSIVE");
        }
        assertThat(all.get(2).get("flowName").asText()).isEqualTo("Liveness check");
        assertThat(all.get(3).get("settings").get("mode").asText()).as("face registration stays ACTIVE").isEqualTo("ACTIVE");
        assertThat(all.get(0).get("updatedAt").isNull()).as("the tenant has not saved settings").isTrue();
        mvc.perform(admin(get("/v2/admin/tenants/999999/liveness-policies"), token)).andExpect(status().isNotFound());
        mvc.perform(admin(get("/v2/admin/tenants/1/flows/DOCUMENT_SCAN/liveness-policy"), token)).andExpect(status().isNotFound());

        String three = "[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\"]";
        putPolicy(1L, "SELFIE_ID_VERIFICATION", "[\"ACTIVE\",\"PASSIVE\"]", three, 2, 4, true)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MODE_NOT_ALLOWED"));
        putPolicy(1L, "SELFIE_ID_VERIFICATION", "[]", three, 2, 4, true)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MODE_NOT_ALLOWED"));
        putPolicy(1L, "SELFIE_ID_VERIFICATION", "[\"ACTIVE\"]", three, 4, 2, true)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        putPolicy(1L, "SELFIE_ID_VERIFICATION", "[\"ACTIVE\"]", "[\"TURN_LEFT\",\"NOD\"]", 1, 2, true)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        try {
            mvc.perform(tenant(put("/v2/tenant/flows/SELFIE_ID_VERIFICATION/liveness")).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"mode\":\"ACTIVE\",\"actions\":" + three + ",\"challengeCount\":2}")).andExpect(status().isOk());
            String four = "[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\",\"SMILE\"]";
            // at least 3 per user: the tenant's saved 2 would break it
            putPolicy(1L, "SELFIE_ID_VERIFICATION", "[\"ACTIVE\"]", four, 3, 4, true)
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TENANT_SETTINGS_CONFLICT"));
            JsonNode unchanged = body(mvc.perform(admin(get("/v2/admin/tenants/1/flows/SELFIE_ID_VERIFICATION/liveness-policy"), token))
                    .andExpect(status().isOk()).andReturn());
            assertThat(unchanged.get("policy").get("minActions").asInt()).isEqualTo(2);
            assertThat(unchanged.get("customized").asBoolean()).isTrue();
            assertThat(unchanged.get("updatedAt").isNull()).isFalse();

            JsonNode reset = body(mvc.perform(admin(put("/v2/admin/tenants/1/flows/SELFIE_ID_VERIFICATION/liveness-policy")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"allowedModes\":[\"ACTIVE\"],\"allowedActions\":" + four
                                    + ",\"minActions\":3,\"maxActions\":4,\"requireSpareAction\":true,\"resetTenant\":true}"), token))
                    .andExpect(status().isOk()).andReturn());
            assertThat(reset.get("customized").asBoolean()).isFalse();
            assertThat(reset.get("flowName").asText()).isEqualTo("Selfie ID verification");
            assertThat(reset.get("settings").get("challengeCount").asInt()).isEqualTo(3);
            assertThat(json.convertValue(reset.get("settings").get("actions"), List.class))
                    .containsExactly("TURN_LEFT", "TURN_RIGHT", "BLINK", "SMILE");
            JsonNode tenantView = body(mvc.perform(tenant(get("/v2/tenant/flows"))).andExpect(status().isOk()).andReturn()).get(0);
            assertThat(tenantView.get("challengeCount").asInt()).isEqualTo(3);
            assertThat(tenantView.get("customized").asBoolean()).isFalse();
            assertThat(auditEvents.findAll()).anyMatch(e -> e.getAction().equals("LIVENESS_POLICY_UPDATED")
                    && e.getActorType() == Codes.ActorType.ADMIN);
        } finally {
            restoreStartingPolicy(1L, "SELFIE_ID_VERIFICATION");
        }

        // a new tenant starts with the template's limits for every liveness flow
        JsonNode created = body(mvc.perform(admin(post("/v2/admin/tenants").contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"LIVENESS_NEW\",\"name\":\"Liveness new\"}"), token)).andExpect(status().isCreated()).andReturn());
        JsonNode fresh = body(mvc.perform(admin(get("/v2/admin/tenants/" + created.get("id").asLong() + "/liveness-policies"), token))
                .andExpect(status().isOk()).andReturn());
        assertThat(fresh).hasSize(4).allMatch(f -> f.get("updatedAt").isNull() && f.get("policy").get("minActions").asInt() == 2
                && f.get("policy").get("allowedActions").size() == 7 && !f.get("customized").asBoolean());
    }

    // ================================================================ back-office

    @Test
    void backOfficeShowsSessionsImagesAndCanErasePeople() throws Exception {
        String id = startV2("usr_backoffice");
        mvc.perform(liveness("/v2/selfie-verifications/" + id + "/liveness", "deviceAntispoofScore")).andExpect(status().isOk());
        mvc.perform(multipart("/v2/selfie-verifications/" + id + "/document").file(image("document"))
                .param("documentType", "PASSPORT")).andExpect(status().isOk());

        String token = adminToken();
        JsonNode dash = body(mvc.perform(admin(get("/v2/admin/dashboard").param("days", "7"), token)).andExpect(status().isOk()).andReturn());
        assertThat(dash.get("totals").get("sessions").asInt()).isPositive();
        assertThat(dash.get("daily")).hasSize(7);

        JsonNode list = body(mvc.perform(admin(get("/v2/admin/sessions").param("q", "usr_backoffice"), token))
                .andExpect(status().isOk()).andReturn());
        assertThat(list.get("total").asInt()).isEqualTo(1);

        JsonNode detail = body(mvc.perform(admin(get("/v2/admin/sessions/" + id), token)).andExpect(status().isOk()).andReturn());
        JsonNode step = detail.get("steps").get(0);
        assertThat(step.get("stepCode").asText()).isEqualTo("LIVENESS");
        assertThat(step.get("checks").size()).isGreaterThanOrEqualTo(4);
        long mediaId = step.get("media").get(0).get("id").asLong();
        byte[] img = mvc.perform(admin(get("/v2/admin/media/" + mediaId), token)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(img).isNotEmpty();

        mvc.perform(admin(get("/v2/admin/config-keys"), token)).andExpect(status().isOk());
        mvc.perform(admin(get("/v2/admin/flows"), token)).andExpect(status().isOk());
        mvc.perform(admin(get("/v2/admin/reason-codes"), token)).andExpect(status().isOk());
        mvc.perform(admin(get("/v2/admin/client-apps"), token)).andExpect(status().isOk());
        mvc.perform(admin(get("/v2/admin/audit-events"), token)).andExpect(status().isOk());
        mvc.perform(get("/v2/admin/sessions")).andExpect(status().isUnauthorized());

        // a viewer can read but not change anything
        JsonNode created = body(mvc.perform(admin(post("/v2/admin/users").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"viewer.it\",\"displayName\":\"Viewer\",\"role\":\"VIEWER\"}"), token))
                .andExpect(status().isCreated()).andReturn());
        String viewerToken = login("viewer.it", created.get("temporaryPassword").asText());
        mvc.perform(admin(get("/v2/admin/sessions"), viewerToken)).andExpect(status().isForbidden());
        mvc.perform(admin(post("/v2/admin/auth/change-password").contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"" + created.get("temporaryPassword").asText()
                        + "\",\"newPassword\":\"ViewerPass123\"}"), viewerToken)).andExpect(status().isNoContent());
        mvc.perform(admin(get("/v2/admin/sessions"), viewerToken)).andExpect(status().isOk());
        mvc.perform(admin(post("/v2/admin/webhooks").contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://example.com/hook\",\"events\":[\"SESSION_COMPLETED\"]}"), viewerToken))
                .andExpect(status().isForbidden());

        // erase the person: everything goes, the audit entry stays
        Long partyId = parties.findFirstByTenantIdAndExternalRefOrderByIdAsc(1L, "usr_backoffice").orElseThrow().getId();
        mvc.perform(admin(delete("/v2/admin/parties/" + partyId), token)).andExpect(status().isNoContent());
        assertThat(parties.findById(partyId)).isEmpty();
        assertThat(sessions.findByPublicId(id)).isEmpty();
        assertThat(mediaFiles.findById(mediaId)).isEmpty();
    }

    // ================================================================ helpers

    private String startV2(String subjectRef) throws Exception {
        return body(mvc.perform(post("/v2/selfie-verifications").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subjectRef\":\"" + subjectRef + "\"}"))
                .andExpect(status().isCreated()).andReturn()).get("sessionId").asText();
    }

    private MockMultipartHttpServletRequestBuilder liveness(String url, String scoreParam) throws Exception {
        return (MockMultipartHttpServletRequestBuilder) multipart(url).file(image("normal")).file(image("closer"))
                .param(scoreParam, "0.95");
    }

    private static JsonNode flow(JsonNode capabilities, String code) {
        for (JsonNode f : capabilities.get("flows")) {
            if (f.get("code").asText().equals(code)) {
                return f;
            }
        }
        return null;
    }

    /** What the face service measures for a person doing {@code actions}: neutral, then each action and back to neutral. */
    private static List<FaceEmbeddingClient.FrameMeasure> performedFrames(List<String> actions) {
        List<FaceEmbeddingClient.FrameMeasure> out = new ArrayList<>();
        out.add(new FaceEmbeddingClient.FrameMeasure(out.size(), null, 1, 0.0, 0.3, 0.95, 0.9, 0.0, 0.8, 0.10));
        for (String a : actions) {
            double yaw = a.equals("TURN_LEFT") ? 28 : a.equals("TURN_RIGHT") ? -28 : 0;
            double pitch = a.equals("LOOK_UP") ? 20 : a.equals("LOOK_DOWN") ? -20 : 0;
            double mouth = a.equals("SMILE") ? 0.95 : 0.8;
            double area = a.equals("MOVE_CLOSER") ? 0.16 : 0.10;
            if (a.equals("BLINK")) {
                out.add(new FaceEmbeddingClient.FrameMeasure(out.size(), null, 1, 0.0, 0.07, 0.9, 0.9, 0.0, 0.8, 0.10));
            } else {
                out.add(new FaceEmbeddingClient.FrameMeasure(out.size(), null, 1, yaw, 0.3, 0.9, 0.9, pitch, mouth, area));
            }
            out.add(new FaceEmbeddingClient.FrameMeasure(out.size(), null, 1, 0.0, 0.3, 0.95, 0.9, 0.0, 0.8, 0.10));
        }
        return out;
    }

    private MockHttpServletRequestBuilder tenant(MockHttpServletRequestBuilder b) throws Exception {
        if (signIn == null) {
            signIn = new com.facetech.backend.tenant.TenantSignIn(mvc, json);
        }
        return b.header("Authorization", "Bearer " + signIn.token("NOQODI", adminToken()));
    }

    private com.facetech.backend.tenant.TenantSignIn signIn;

    private static MockHttpServletRequestBuilder challenge(String sessionId, String token, String supportedActions) {
        return post("/v2/liveness-challenges").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sessionId\":\"" + sessionId + "\""
                        + (supportedActions != null ? ",\"supportedActions\":" + supportedActions : "") + "}");
    }

    private String saveError(String url, String mode, String actions, int count) throws Exception {
        MvcResult r = mvc.perform(tenant(put(url)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"mode\":\"" + mode + "\",\"actions\":[" + actions + "],\"challengeCount\":" + count + "}")).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(400);
        return body(r).get("code").asText();
    }

    private org.springframework.test.web.servlet.ResultActions putPolicy(Long tenantId, String flow, String modes,
                                                                         String actions, int min, int max,
                                                                         boolean spare) throws Exception {
        return mvc.perform(admin(put("/v2/admin/tenants/" + tenantId + "/flows/" + flow + "/liveness-policy")
                .contentType(MediaType.APPLICATION_JSON).content("{\"allowedModes\":" + modes + ",\"allowedActions\":" + actions
                        + ",\"minActions\":" + min + ",\"maxActions\":" + max + ",\"requireSpareAction\":" + spare + "}"), adminToken()));
    }

    /** Back to the flow's starting policy, without tenant settings. */
    private void restoreStartingPolicy(Long tenantId, String flow) throws Exception {
        String modes = LivenessSettingsService.PASSIVE_DEFAULT_FLOWS.contains(flow) ? "[\"ACTIVE\",\"PASSIVE\"]" : "[\"ACTIVE\"]";
        mvc.perform(admin(put("/v2/admin/tenants/" + tenantId + "/flows/" + flow + "/liveness-policy")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"allowedModes\":" + modes + ","
                                + "\"allowedActions\":[\"TURN_LEFT\",\"TURN_RIGHT\",\"BLINK\",\"LOOK_UP\",\"LOOK_DOWN\",\"SMILE\","
                                + "\"MOVE_CLOSER\"],\"minActions\":2,\"maxActions\":4,"
                                + "\"requireSpareAction\":true,\"resetTenant\":true}"), adminToken()))
                .andExpect(status().isOk());
    }

    /** Erases a person enrolled by a test, so other tests' duplicate searches do not find them. */
    private void erase(String subjectRef) throws Exception {
        var party = parties.findFirstByTenantIdAndExternalRefOrderByIdAsc(1L, subjectRef).orElse(null);
        if (party != null) {
            mvc.perform(admin(delete("/v2/admin/parties/" + party.getId()), adminToken())).andExpect(status().isNoContent());
        }
    }

    /** A person with an enrolled selfie (as after a selfie ID verification), for face authentication. */
    private void enroll(String subjectRef) {
        enroll(subjectRef, SELFIE);
    }

    private void enroll(String subjectRef, List<Double> embedding) {
        com.facetech.backend.domain.Party p = new com.facetech.backend.domain.Party();
        p.setPublicId(java.util.UUID.randomUUID().toString());
        p.setTenantId(1L);
        p.setPartyType(Codes.PartyType.PERSON);
        p.setExternalRef(subjectRef);
        p.setStatus("ACTIVE");
        parties.save(p);
        FaceTemplate t = new FaceTemplate();
        t.setTenantId(1L);
        t.setPartyId(p.getId());
        t.setRole(Codes.TemplateRole.SELFIE);
        t.setPose("normal");
        t.setModelVersion("test-model");
        t.setDimension(embedding.size());
        t.setVector(com.facetech.backend.platform.EmbeddingCodec.encode(embedding));
        t.setStatus(Codes.TemplateStatus.ENROLLED);
        templates.save(t);
    }

    private synchronized String adminToken() throws Exception {
        if (adminToken != null) {
            return adminToken;
        }
        MvcResult r = mvc.perform(post("/v2/admin/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"" + ADMIN_PASSWORD + "\"}")).andReturn();
        if (r.getResponse().getStatus() == 200) {
            adminToken = body(r).get("token").asText();
            return adminToken;
        }
        String first = login("admin", "FirstPass123");
        mvc.perform(admin(get("/v2/admin/dashboard"), first)).andExpect(status().isForbidden());
        mvc.perform(admin(post("/v2/admin/auth/change-password").contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"FirstPass123\",\"newPassword\":\"" + ADMIN_PASSWORD + "\"}"), first))
                .andExpect(status().isNoContent());
        adminToken = first;
        return adminToken;
    }

    private String login(String username, String password) throws Exception {
        return body(mvc.perform(post("/v2/admin/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk()).andReturn()).get("token").asText();
    }

    private static MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder b, String token) {
        return b.header("Authorization", "Bearer " + token);
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsByteArray());
    }

    private static MockMultipartFile image(String field) throws Exception {
        BufferedImage img = new BufferedImage(32, 24, BufferedImage.TYPE_INT_RGB);
        img.setRGB(3, 3, 0xFFFFFF);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "jpeg", out);
        return new MockMultipartFile(field, field + ".jpg", "image/jpeg", out.toByteArray());
    }

    /** 512-d unit-ish vector starting with (a, b), rest zero. */
    private static List<Double> vector(double a, double b) {
        List<Double> v = new ArrayList<>(Collections.nCopies(512, 0.0));
        v.set(0, a);
        v.set(1, b);
        return v;
    }

    /** 512-d vector with a single 1 at {@code index}: orthogonal to every other face, so it matches only itself. */
    private static List<Double> unit(int index) {
        List<Double> v = new ArrayList<>(Collections.nCopies(512, 0.0));
        v.set(index, 1.0);
        return v;
    }

    /** Appends the Luhn check digit to 14 digits. */
    private static String validEid(String fourteen) {
        for (int d = 0; d <= 9; d++) {
            String candidate = fourteen + d;
            int sum = 0;
            boolean dbl = false;
            for (int i = candidate.length() - 1; i >= 0; i--) {
                int x = candidate.charAt(i) - '0';
                if (dbl) {
                    x *= 2;
                    if (x > 9) {
                        x -= 9;
                    }
                }
                sum += x;
                dbl = !dbl;
            }
            if (sum % 10 == 0) {
                return candidate;
            }
        }
        throw new IllegalStateException();
    }

    @SuppressWarnings("unused")
    private static String today() {
        return LocalDate.now().format(DateTimeFormatter.ISO_DATE);
    }
}
