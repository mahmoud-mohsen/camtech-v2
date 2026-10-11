package com.facetech.backend.tenant;

import com.facetech.backend.admin.AdminWebhookController;
import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.platform.TenantSettingsService;
import com.facetech.backend.repository.ClientAppRepository;
import com.facetech.backend.repository.ClientCredentialRepository;
import com.facetech.backend.repository.DocumentScanRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.ReviewCaseRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/** What a tenant should look at on its Overview: work waiting, endpoints failing, keys and documents expiring. */
@Service
public class TenantAttentionService {

    static final int CREDENTIAL_WARNING_DAYS = 14;
    private static final ZoneId ZONE = ZoneId.of("Asia/Dubai");

    private final DocumentScanRepository scanRepository;
    private final ReviewCaseRepository reviewCaseRepository;
    private final AdminWebhookController webhooks;
    private final ClientAppRepository clientAppRepository;
    private final ClientCredentialRepository credentialRepository;
    private final IdentityDocumentRepository documentRepository;
    private final TenantSettingsService settings;

    public TenantAttentionService(DocumentScanRepository scanRepository, ReviewCaseRepository reviewCaseRepository,
                                  AdminWebhookController webhooks, ClientAppRepository clientAppRepository,
                                  ClientCredentialRepository credentialRepository,
                                  IdentityDocumentRepository documentRepository, TenantSettingsService settings) {
        this.scanRepository = scanRepository;
        this.reviewCaseRepository = reviewCaseRepository;
        this.webhooks = webhooks;
        this.clientAppRepository = clientAppRepository;
        this.credentialRepository = credentialRepository;
        this.documentRepository = documentRepository;
        this.settings = settings;
    }

    public record FailingWebhook(Long id, String url, int consecutiveFailures, Instant lastDeliveryAt) {
    }

    public record ExpiringCredential(String clientAppCode, String keyId, Instant expiresAt) {
    }

    /**
     * @param verificationsToReview open review cases the tenant decides (0 when camtech reviews them)
     * @param documentsExpiring     documents expiring within the tenant's warning period
     */
    public record Attention(long scansToReview, long verificationsToReview, List<FailingWebhook> failingWebhooks,
                            List<ExpiringCredential> credentialsExpiring, long documentsExpiring,
                            int expiryWarningDays) {
    }

    @Transactional(readOnly = true)
    public Attention attention(Long tenantId) {
        long scans = scanRepository.countByTenantIdAndStatus(tenantId, Codes.ScanStatus.NEEDS_REVIEW);
        long cases = settings.tenantReviews(tenantId) ? reviewCaseRepository.countByTenantIdAndStatusIn(tenantId,
                List.of(Codes.ReviewStatus.OPEN, Codes.ReviewStatus.IN_REVIEW)) : 0;
        List<FailingWebhook> failing = webhooks.webhooks().stream()
                .filter(w -> "ACTIVE".equals(w.status()) && w.failing())
                .map(w -> new FailingWebhook(w.id(), w.url(), w.consecutiveFailures(), w.lastDeliveryAt())).toList();
        Instant soon = Instant.now().plus(CREDENTIAL_WARNING_DAYS, ChronoUnit.DAYS);
        List<ExpiringCredential> keys = new ArrayList<>();
        for (ClientApp app : clientAppRepository.findByTenantIdOrderByCode(tenantId)) {
            credentialRepository.findByClientAppIdOrderByCreatedAtDesc(app.getId()).stream()
                    .filter(c -> c.getStatus() == Codes.CredentialStatus.ACTIVE && c.getExpiresAt() != null
                            && c.getExpiresAt().isBefore(soon))
                    .forEach(c -> keys.add(new ExpiringCredential(app.getCode(), c.getKeyId(), c.getExpiresAt())));
        }
        int days = settings.expiryWarningDays(tenantId);
        LocalDate today = LocalDate.now(ZONE);
        long documents = documentRepository.countExpiring(tenantId, today, today.plusDays(days));
        return new Attention(scans, cases, failing, keys, documents, days);
    }
}
