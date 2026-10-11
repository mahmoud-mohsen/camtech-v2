package com.facetech.backend.tenant;

import com.facetech.backend.domain.DocumentScan;
import com.facetech.backend.ocr.OcrProvider;
import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.ocr.dto.OcrResult;
import com.facetech.backend.repository.DocumentScanRepository;
import com.facetech.backend.repository.OutboxEventRepository;
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

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Server OCR scans that fail a check wait for review; the tenant corrects and approves (or rejects) them
 * in the portal, and decides how strict the review policy is.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:camtech_scan_review_it;MODE=Oracle;DB_CLOSE_DELAY=-1;DEFAULT_NULL_ORDERING=HIGH",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "camtech.jobs.enabled=false",
        "camtech.backoffice.admin-password=FirstPass123",
        "ocr.provider=none"
})
@AutoConfigureMockMvc
class DocumentScanReviewIntegrationTest {

    private static final String TENANT = "NOQODI";
    private static final String FRONT = "UNITED ARAB EMIRATES\nResident Identity Card\nID Number\n%s\nName: Ahmed Ali Hassan\n"
            + "Date of Birth\n01/02/1990\nExpiry Date\n05/06/2030\n";
    private static final String VALID_ID = "784-1990-1234567-6";
    private static final String BAD_CHECK_DIGIT = "784-1990-1234567-1";

    @Autowired
    MockMvc mvc;
    @Autowired
    ObjectMapper json;
    @Autowired
    DocumentScanRepository scans;
    @Autowired
    OutboxEventRepository outbox;
    @Autowired
    com.facetech.backend.service.DocumentExpiryService expiry;

    @MockBean
    FaceEmbeddingClient faceClient;
    @MockBean
    OcrService ocrService;
    @MockBean
    com.facetech.backend.platform.storage.ObjectStore objectStore;

    @BeforeEach
    void ocr() throws Exception {
        when(ocrService.isAvailable()).thenReturn(true);
        when(ocrService.getProvider()).thenReturn(OcrProvider.GOOGLE_DOCUMENT_AI);
        when(objectStore.put(anyString(), any(), anyString())).thenAnswer(inv -> "mem://" + inv.getArgument(0));
        mvc.perform(tenant(delete("/v2/tenant/document-ocr-settings"))).andExpect(status().isOk());
    }

    @Test
    void scanWithBadCheckDigitWaitsForReviewAndIsLinkedOnlyAfterCorrection() throws Exception {
        JsonNode scan = scan(FRONT.formatted(BAD_CHECK_DIGIT), "cust-review-1");
        assertThat(scan.get("status").asText()).isEqualTo("NEEDS_REVIEW");
        assertThat(scan.get("reviewRequired").asBoolean()).isTrue();
        assertThat(scan.get("validations").get("emiratesIdNumber").get("status").asText()).isEqualTo("INVALID");
        assertThat(codes(scan.get("reviewReasons"))).contains("FIELD_INVALID");
        DocumentScan stored = scans.findByPublicId(scan.get("scanId").asText()).orElseThrow();
        assertThat(stored.getDocumentId()).as("not linked before review").isNull();

        long id = stored.getId();
        JsonNode list = body(mvc.perform(tenant(get("/v2/tenant/document-scans").param("status", "NEEDS_REVIEW")))
                .andExpect(status().isOk()).andReturn());
        assertThat(list.get("items").findValuesAsText("publicId")).contains(stored.getPublicId());
        JsonNode detail = body(mvc.perform(tenant(get("/v2/tenant/document-scans/" + id))).andExpect(status().isOk()).andReturn());
        JsonNode idField = field(detail, "emiratesIdNumber");
        assertThat(idField.get("validationStatus").asText()).isEqualTo("INVALID");
        assertThat(idField.get("source").asText()).isNotBlank();
        assertThat(detail.get("reviewReasons").get(0).get("code").asText()).isNotBlank();

        // the invalid OCR value cannot be approved as it is, nor replaced with another invalid one
        review(id, "{\"decision\":\"APPROVE\"}").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        review(id, "{\"decision\":\"APPROVE\",\"corrections\":{\"emiratesIdNumber\":\"" + BAD_CHECK_DIGIT + "\"}}")
                .andExpect(status().isBadRequest());
        review(id, "{\"decision\":\"MAYBE\"}").andExpect(status().isBadRequest());

        JsonNode approved = body(review(id, "{\"decision\":\"APPROVE\",\"note\":\"Read from the photo\","
                + "\"corrections\":{\"emiratesIdNumber\":\"784199012345676\"}}").andExpect(status().isOk()).andReturn());
        assertThat(approved.get("status").asText()).isEqualTo("COMPLETED");
        JsonNode corrected = field(approved, "emiratesIdNumber");
        assertThat(corrected.get("value").asText()).isEqualTo(VALID_ID);
        assertThat(corrected.get("ocrValue").asText()).isEqualTo(BAD_CHECK_DIGIT);
        assertThat(corrected.get("reviewedValue").asText()).isEqualTo(VALID_ID);
        assertThat(approved.get("reviewedBy").isNull()).isFalse();
        assertThat(approved.get("reviewNote").asText()).isEqualTo("Read from the photo");
        assertThat(scans.findById(id).orElseThrow().getDocumentId()).as("linked after approval").isNotNull();

        // a decided scan cannot be decided again
        review(id, "{\"decision\":\"REJECT\"}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SCAN_NOT_IN_REVIEW"));
    }

    @Test
    void cleanScanIsAcceptedAndLinkedRightAway() throws Exception {
        JsonNode scan = scan(FRONT.formatted(VALID_ID), "cust-review-2");

        assertThat(scan.get("status").asText()).isEqualTo("COMPLETED");
        assertThat(scan.get("reviewRequired").asBoolean()).isFalse();
        assertThat(scan.get("validations").get("emiratesIdNumber").get("status").asText()).isEqualTo("VALID");
        assertThat(scan.get("validations").get("dateOfBirth").get("status").asText()).isEqualTo("VALID");
        assertThat(scans.findByPublicId(scan.get("scanId").asText()).orElseThrow().getDocumentId()).isNotNull();
    }

    @Test
    void rejectedScanIsNeverLinked() throws Exception {
        JsonNode scan = scan(FRONT.formatted(BAD_CHECK_DIGIT), "cust-review-3");
        long id = scans.findByPublicId(scan.get("scanId").asText()).orElseThrow().getId();

        JsonNode rejected = body(review(id, "{\"decision\":\"REJECT\",\"note\":\"Photo of a screen\"}")
                .andExpect(status().isOk()).andReturn());

        assertThat(rejected.get("status").asText()).isEqualTo("REJECTED");
        assertThat(scans.findById(id).orElseThrow().getDocumentId()).isNull();
    }

    @Test
    void tenantDecidesHowStrictTheReviewIs() throws Exception {
        JsonNode defaults = body(mvc.perform(tenant(get("/v2/tenant/document-ocr-settings"))).andExpect(status().isOk()).andReturn());
        assertThat(defaults.get("settings").get("reviewMode").asText()).isEqualTo("AUTO");
        assertThat(defaults.get("customized").asBoolean()).isFalse();

        mvc.perform(tenant(put("/v2/tenant/document-ocr-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"reviewMode\":\"SOMETIMES\"}")).andExpect(status().isBadRequest());
        mvc.perform(tenant(put("/v2/tenant/document-ocr-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"autoAcceptConfidence\":1.5}")).andExpect(status().isBadRequest());
        mvc.perform(tenant(put("/v2/tenant/document-ocr-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"requiredFields\":[\"not a field!\"]}")).andExpect(status().isBadRequest());

        JsonNode saved = body(mvc.perform(tenant(put("/v2/tenant/document-ocr-settings")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reviewMode\":\"always\",\"requiredFields\":[\"emiratesIdNumber\",\"fullNameEn\",\"issueDate\"]}"))
                .andExpect(status().isOk()).andReturn());
        assertThat(saved.get("settings").get("reviewMode").asText()).isEqualTo("ALWAYS");
        assertThat(saved.get("customized").asBoolean()).isTrue();

        // ALWAYS: even a clean scan waits; the tenant's required issue date is missing from this card
        JsonNode scan = scan(FRONT.formatted(VALID_ID), "cust-review-4");
        assertThat(scan.get("status").asText()).isEqualTo("NEEDS_REVIEW");
        assertThat(codes(scan.get("reviewReasons"))).contains("FIELD_MISSING");

        JsonNode reset = body(mvc.perform(tenant(delete("/v2/tenant/document-ocr-settings"))).andExpect(status().isOk()).andReturn());
        assertThat(reset.get("settings").get("reviewMode").asText()).isEqualTo("AUTO");
        assertThat(scan(FRONT.formatted(VALID_ID), "cust-review-5").get("status").asText()).isEqualTo("COMPLETED");
    }

    @Test
    void reviewedScanBecomesADocumentWithImagesAPersonToExportAndErase() throws Exception {
        byte[] image = png();
        when(objectStore.get(anyString())).thenReturn(image);
        JsonNode scan = scan(FRONT.formatted("784-1985-7654321-4"), "cust-records-1");
        DocumentScan stored = scans.findByPublicId(scan.get("scanId").asText()).orElseThrow();
        assertThat(eventTypes("DOCUMENT_SCAN", stored.getPublicId())).containsExactly("SCAN_REVIEW_REQUIRED");

        // work waiting shows on the overview
        mvc.perform(tenant(get("/v2/tenant/reviews/summary"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.owner").value("TENANT"));
        JsonNode dash = body(mvc.perform(tenant(get("/v2/tenant/dashboard"))).andExpect(status().isOk()).andReturn());
        assertThat(dash.get("attention").get("scansToReview").asLong()).isPositive();
        assertThat(dash.get("attention").get("expiryWarningDays").asInt()).isEqualTo(30);

        // the reviewer sees the document image next to the fields
        JsonNode detail = body(mvc.perform(tenant(get("/v2/tenant/document-scans/" + stored.getId())))
                .andExpect(status().isOk()).andReturn());
        long mediaId = detail.get("media").get(0).get("id").asLong();
        mvc.perform(tenant(get("/v2/tenant/media/" + mediaId))).andExpect(status().isOk())
                .andExpect(r -> assertThat(r.getResponse().getContentAsByteArray()).isEqualTo(image))
                .andExpect(r -> assertThat(r.getResponse().getHeader("Cache-Control")).contains("no-store"));
        mvc.perform(tenant(get("/v2/tenant/media/999999999"))).andExpect(status().isNotFound());

        review(stored.getId(), "{\"decision\":\"APPROVE\",\"corrections\":{\"emiratesIdNumber\":\"784198576543213\"}}")
                .andExpect(status().isOk());
        assertThat(eventTypes("DOCUMENT_SCAN", stored.getPublicId()))
                .containsExactly("SCAN_REVIEW_REQUIRED", "SCAN_REVIEW_DECIDED");
        assertThat(outbox.findByAggregateTypeAndAggregateIdOrderByCreatedAtAsc("DOCUMENT_SCAN", stored.getPublicId())
                .get(1).getPayload()).contains("\"decidedBy\":\"TENANT\"").contains("\"decision\":\"APPROVED\"");

        // the approved scan is now the person's document, with its image
        long documentId = scans.findById(stored.getId()).orElseThrow().getDocumentId();
        JsonNode docs = body(mvc.perform(tenant(get("/v2/tenant/documents").param("expiringBefore", "2031-01-01")))
                .andExpect(status().isOk()).andReturn());
        assertThat(docs.get("items").findValuesAsText("id")).contains(String.valueOf(documentId));
        JsonNode doc = body(mvc.perform(tenant(get("/v2/tenant/documents/" + documentId))).andExpect(status().isOk()).andReturn());
        assertThat(doc.get("media")).isNotEmpty();
        assertThat(doc.get("scans").get(0).has("ocrProvider")).isFalse();
        long partyId = doc.get("partyId").asLong();

        JsonNode person = body(mvc.perform(tenant(get("/v2/tenant/parties/" + partyId))).andExpect(status().isOk())
                .andExpect(jsonPath("$.subjectRef").value("cust-records-1")).andReturn());
        String partyPublicId = person.get("publicId").asText();

        // only owners export or erase
        String viewer = signIn.signInNewUser(TENANT, "VIEWER", adminToken());
        mvc.perform(get("/v2/tenant/parties/" + partyId + "/export").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/v2/tenant/parties/" + partyId).header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());

        MvcResult export = mvc.perform(tenant(get("/v2/tenant/parties/" + partyId + "/export"))).andExpect(status().isOk())
                .andExpect(r -> assertThat(r.getResponse().getContentType()).isEqualTo("application/zip")).andReturn();
        List<String> entries = new ArrayList<>();
        String personJson = null;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(export.getResponse().getContentAsByteArray()))) {
            for (ZipEntry e = zip.getNextEntry(); e != null; e = zip.getNextEntry()) {
                entries.add(e.getName());
                if (e.getName().equals("person.json")) {
                    personJson = new String(zip.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                }
            }
        }
        assertThat(entries).contains("person.json").anyMatch(n -> n.startsWith("documents/" + documentId + "/"));
        JsonNode exported = json.readTree(personJson);
        assertThat(exported.get("person").get("subjectRef").asText()).isEqualTo("cust-records-1");
        assertThat(exported.get("documents").get(0).get("fields")).isNotEmpty();
        assertThat(personJson).doesNotContain("finalSimilarity");

        // erasing removes everything and tells the tenant's backend
        mvc.perform(tenant(delete("/v2/tenant/parties/" + partyId))).andExpect(status().isNoContent());
        mvc.perform(tenant(get("/v2/tenant/documents/" + documentId))).andExpect(status().isNotFound());
        assertThat(eventTypes("PARTY", partyPublicId)).containsExactly("PARTY_ERASED");
    }

    @Test
    void tenantSettingsForDocumentsReviewsAndRetention() throws Exception {
        mvc.perform(tenant(get("/v2/tenant/document-settings"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.expiryWarningDays").value(30)).andExpect(jsonPath("$.max").value(365));
        mvc.perform(tenant(put("/v2/tenant/document-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"expiryWarningDays\":0}")).andExpect(status().isBadRequest());
        mvc.perform(tenant(put("/v2/tenant/document-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"expiryWarningDays\":45}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.expiryWarningDays").value(45));

        mvc.perform(tenant(get("/v2/tenant/review-settings"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.owner").value("TENANT"));
        String reviewer = signIn.signInNewUser(TENANT, "REVIEWER", adminToken());
        mvc.perform(put("/v2/tenant/review-settings").header("Authorization", "Bearer " + reviewer)
                .contentType(MediaType.APPLICATION_JSON).content("{\"owner\":\"CAMTECH\"}")).andExpect(status().isForbidden());
        mvc.perform(tenant(put("/v2/tenant/review-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"owner\":\"NOBODY\"}")).andExpect(status().isBadRequest());
        mvc.perform(tenant(put("/v2/tenant/review-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"owner\":\"camtech\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.owner").value("CAMTECH"));
        mvc.perform(tenant(put("/v2/tenant/review-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"owner\":\"TENANT\"}")).andExpect(status().isOk());

        mvc.perform(tenant(get("/v2/tenant/retention-policies"))).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].dataCategory").exists());
        mvc.perform(tenant(put("/v2/tenant/document-settings")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"expiryWarningDays\":30}")).andExpect(status().isOk());
    }

    @Test
    void documentsEnteringTheWarningPeriodAreAnnouncedOnce() throws Exception {
        // the card in FRONT expires on 05/06/2030
        JsonNode scan = scan(FRONT.formatted("784-1990-1111111-" + checkDigit("78419901111111")), "cust-expiry-1");
        long documentId = scans.findByPublicId(scan.get("scanId").asText()).orElseThrow().getDocumentId();
        String aggregate = String.valueOf(documentId);

        expiry.notifyExpiring(java.time.LocalDate.of(2030, 4, 1));
        assertThat(eventTypes("DOCUMENT", aggregate)).as("65 days before: outside the 30-day window").isEmpty();
        expiry.notifyExpiring(java.time.LocalDate.of(2030, 5, 20));
        expiry.notifyExpiring(java.time.LocalDate.of(2030, 5, 21));
        assertThat(eventTypes("DOCUMENT", aggregate)).containsExactly("DOCUMENT_EXPIRING");
        assertThat(outbox.findByAggregateTypeAndAggregateIdOrderByCreatedAtAsc("DOCUMENT", aggregate).get(0).getPayload())
                .contains("\"subjectRef\":\"cust-expiry-1\"").contains("\"expiresOn\":\"2030-06-05\"").contains("\"daysLeft\":16");
    }

    private static int checkDigit(String first14) {
        int total = 0;
        for (int i = 0; i < first14.length(); i++) {
            int n = first14.charAt(first14.length() - 1 - i) - '0';
            if (i % 2 == 0) {
                n *= 2;
                if (n > 9) {
                    n -= 9;
                }
            }
            total += n;
        }
        return (10 - total % 10) % 10;
    }

    private List<String> eventTypes(String aggregateType, String aggregateId) {
        return outbox.findByAggregateTypeAndAggregateIdOrderByCreatedAtAsc(aggregateType, aggregateId).stream()
                .map(com.facetech.backend.domain.OutboxEvent::getEventType).toList();
    }

    // ------------------------------------------------------------------ helpers

    private JsonNode scan(String ocrText, String subjectRef) throws Exception {
        when(ocrService.processImage(any(), anyString())).thenReturn(OcrResult.ofText(ocrText));
        MockMultipartFile image = new MockMultipartFile("image", "card.png", "image/png", png());
        return body(mvc.perform(multipart("/api/v1/documents/scan").file(image)
                        .param("documentType", "EMIRATES_ID_FRONT").param("userId", subjectRef))
                .andExpect(status().isOk()).andReturn());
    }

    private org.springframework.test.web.servlet.ResultActions review(long id, String body) throws Exception {
        return mvc.perform(tenant(post("/v2/tenant/document-scans/" + id + "/review"))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static JsonNode field(JsonNode detail, String code) {
        for (JsonNode f : detail.get("fields")) {
            if (code.equals(f.get("fieldCode").asText())) {
                return f;
            }
        }
        throw new AssertionError("No field " + code + " in " + detail);
    }

    private static List<String> codes(JsonNode reasons) {
        List<String> out = new ArrayList<>();
        reasons.forEach(r -> out.add(r.get("code").asText()));
        return out;
    }

    private static byte[] png() throws Exception {
        BufferedImage img = new BufferedImage(320, 200, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < img.getWidth(); x++) {
            for (int y = 0; y < img.getHeight(); y++) {
                img.setRGB(x, y, ((x * 7) ^ (y * 13)) & 0xFFFFFF);
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }

    private MockHttpServletRequestBuilder tenant(MockHttpServletRequestBuilder b) throws Exception {
        if (signIn == null) {
            signIn = new TenantSignIn(mvc, json);
        }
        return b.header("Authorization", "Bearer " + signIn.token(TENANT, adminToken()));
    }

    private static String adminToken;
    private static TenantSignIn signIn;

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


    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsByteArray());
    }
}
