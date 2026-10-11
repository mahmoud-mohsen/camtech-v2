package com.facetech.backend.jobs;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.OutboxEvent;
import com.facetech.backend.domain.RetentionPolicy;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.WebhookDelivery;
import com.facetech.backend.domain.WebhookSubscription;
import com.facetech.backend.platform.EntitlementService;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.TenantService;
import com.facetech.backend.platform.WebhookSender;
import com.facetech.backend.repository.AuditEventRepository;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.OutboxEventRepository;
import com.facetech.backend.repository.RetentionPolicyRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import com.facetech.backend.repository.WebhookDeliveryRepository;
import com.facetech.backend.repository.WebhookSubscriptionRepository;
import com.facetech.backend.verification.SessionSupport;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Background work: close expired sessions, deliver outbox events to
 * webhooks (and retry failed deliveries), and purge data past its
 * retention period. Each run is a short transaction; with several
 * instances, optimistic locking (row_version) stops two instances from
 * updating the same row.
 */
@Component
@EnableScheduling
@ConditionalOnProperty(name = "camtech.jobs.enabled", havingValue = "true", matchIfMissing = true)
@Slf4j
public class BackgroundJobs {

    private final VerificationSessionRepository sessionRepository;
    private final OutboxEventRepository outboxRepository;
    private final WebhookSubscriptionRepository subscriptionRepository;
    private final WebhookDeliveryRepository deliveryRepository;
    private final MediaFileRepository mediaRepository;
    private final RetentionPolicyRepository retentionRepository;
    private final AuditEventRepository auditRepository;
    private final FaceTemplateRepository templateRepository;
    private final SessionSupport support;
    private final WebhookSender sender;
    private final MediaStorageService media;
    private final EntitlementService entitlements;
    private final TenantService tenantService;
    private final TransactionTemplate tx;

    /** A webhook relay run stops sending after this long, so the job lock is never held for long. */
    private static final long RELAY_BUDGET_MS = 60_000;

    private record Pending(WebhookDelivery delivery, WebhookSubscription subscription, String payload) {
    }

    public BackgroundJobs(VerificationSessionRepository sessionRepository, OutboxEventRepository outboxRepository,
                          WebhookSubscriptionRepository subscriptionRepository, WebhookDeliveryRepository deliveryRepository,
                          MediaFileRepository mediaRepository, RetentionPolicyRepository retentionRepository,
                          AuditEventRepository auditRepository, FaceTemplateRepository templateRepository,
                          SessionSupport support, WebhookSender sender,
                          MediaStorageService media, EntitlementService entitlements, TenantService tenantService,
                          PlatformTransactionManager txManager) {
        this.sessionRepository = sessionRepository;
        this.outboxRepository = outboxRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.deliveryRepository = deliveryRepository;
        this.mediaRepository = mediaRepository;
        this.retentionRepository = retentionRepository;
        this.auditRepository = auditRepository;
        this.templateRepository = templateRepository;
        this.support = support;
        this.sender = sender;
        this.media = media;
        this.entitlements = entitlements;
        this.tenantService = tenantService;
        this.tx = new TransactionTemplate(txManager);
    }

    /** Marks open sessions past their TTL as EXPIRED (and emits SESSION_EXPIRED). */
    @Scheduled(fixedDelayString = "${camtech.jobs.session-expiry-ms:60000}", initialDelay = 30_000)
    @SchedulerLock(name = "expireSessions", lockAtMostFor = "PT5M")
    public void expireSessions() {
        long start = System.currentTimeMillis();
        try {
            Integer n = tx.execute(st -> {
                List<VerificationSession> due = sessionRepository.findTop200ByStatusInAndExpiresAtBefore(
                        List.of(Codes.SessionStatus.CREATED, Codes.SessionStatus.IN_PROGRESS), Instant.now());
                due.forEach(support::expire);
                return due.size();
            });
            if (n != null && n > 0) {
                log.info("Expired {} verification sessions in {} ms", n, System.currentTimeMillis() - start);
            } else {
                log.debug("Session expiry run: nothing to expire ({} ms)", System.currentTimeMillis() - start);
            }
        } catch (Exception e) {
            log.warn("Session expiry run failed after {} ms: {}", System.currentTimeMillis() - start, e.toString());
        }
    }

    /** Turns pending outbox events into webhook deliveries, then sends due deliveries. */
    @Scheduled(fixedDelayString = "${camtech.jobs.webhook-relay-ms:5000}", initialDelay = 15_000)
    @SchedulerLock(name = "relayWebhooks", lockAtMostFor = "PT5M")
    public void relayWebhooks() {
        long start = System.currentTimeMillis();
        int[] counts = new int[4]; // events relayed, deliveries created, deliveries delivered, deliveries failed/retrying
        try {
            tx.executeWithoutResult(st -> {
                List<OutboxEvent> events = outboxRepository.findTop100ByStatusOrderByCreatedAtAsc(Codes.OutboxStatus.PENDING);
                if (events.isEmpty()) {
                    return;
                }
                counts[0] = events.size();
                boolean enabled = entitlements.isEnabled(Codes.FeatureType.FEATURE, Codes.FEATURE_WEBHOOKS);
                List<WebhookSubscription> subs = enabled
                        ? subscriptionRepository.findByTenantIdAndStatus(tenantService.defaultTenantId(), Codes.ActiveStatus.ACTIVE)
                        : List.of();
                for (OutboxEvent e : events) {
                    for (WebhookSubscription s : subs) {
                        if (Arrays.stream(s.getEvents().split(",")).map(String::trim).anyMatch(e.getEventType()::equals)) {
                            WebhookDelivery d = new WebhookDelivery();
                            d.setTenantId(e.getTenantId());
                            d.setSubscriptionId(s.getId());
                            d.setOutboxEventId(e.getId());
                            d.setEventType(e.getEventType());
                            d.setStatus(Codes.DeliveryStatus.PENDING);
                            d.setNextRetryAt(Instant.now());
                            deliveryRepository.save(d);
                            counts[1]++;
                        }
                    }
                    e.setStatus(Codes.OutboxStatus.SENT);
                    e.setProcessedAt(Instant.now());
                }
            });
            List<Long> due = tx.execute(st -> deliveryRepository.findTop100ByStatusInAndNextRetryAtBeforeOrderByNextRetryAtAsc(
                    List.of(Codes.DeliveryStatus.PENDING, Codes.DeliveryStatus.RETRYING), Instant.now().plusMillis(1))
                    .stream().map(WebhookDelivery::getId).toList());
            // The HTTP call runs between two short transactions, so no database connection waits on a slow
            // endpoint. Deliveries left over when the time budget is used up go out on the next run.
            long budgetEnd = System.currentTimeMillis() + RELAY_BUDGET_MS;
            for (Long id : due == null ? List.<Long>of() : due) {
                if (System.currentTimeMillis() > budgetEnd) {
                    log.info("Webhook relay run: time budget used, remaining deliveries wait for the next run");
                    break;
                }
                Pending p = tx.execute(st -> deliveryRepository.findById(id).map(d -> {
                    WebhookSubscription s = subscriptionRepository.findById(d.getSubscriptionId()).orElse(null);
                    OutboxEvent e = d.getOutboxEventId() != null ? outboxRepository.findById(d.getOutboxEventId()).orElse(null) : null;
                    if (s == null || e == null || s.getStatus() != Codes.ActiveStatus.ACTIVE) {
                        d.setStatus(Codes.DeliveryStatus.FAILED);
                        d.setErrorMessage("Webhook disabled or event missing");
                        d.setNextRetryAt(null);
                        counts[3]++;
                        log.info("Webhook delivery {} given up: webhook disabled or event missing", d.getId());
                        return null;
                    }
                    return new Pending(d, s, e.getPayload());
                }).orElse(null));
                if (p == null) {
                    continue;
                }
                sender.send(p.subscription(), p.delivery(), p.payload());
                tx.executeWithoutResult(st -> deliveryRepository.save(p.delivery()));
                if (p.delivery().getStatus() == Codes.DeliveryStatus.DELIVERED) {
                    counts[2]++;
                } else {
                    counts[3]++;
                }
            }
            long ms = System.currentTimeMillis() - start;
            if (counts[0] > 0 || counts[2] > 0 || counts[3] > 0) {
                log.info("Webhook relay run: {} outbox events relayed into {} deliveries; {} delivered, {} failed in {} ms",
                        counts[0], counts[1], counts[2], counts[3], ms);
            } else {
                log.debug("Webhook relay run: nothing to do ({} ms)", ms);
            }
        } catch (Exception e) {
            log.warn("Webhook relay run failed after {} ms: {}", System.currentTimeMillis() - start, e.toString());
        }
    }

    /**
     * Deletes images past purge_after, audit entries older than their retention, and face templates that were never
     * registered once their session has been over for a day.
     */
    @Scheduled(cron = "${camtech.jobs.retention-cron:0 30 2 * * *}")
    @SchedulerLock(name = "applyRetention", lockAtMostFor = "PT2H", lockAtLeastFor = "PT5M")
    public void applyRetention() {
        long start = System.currentTimeMillis();
        int purged = 0;
        while (true) {
            // Object deletes happen outside the transaction; the rows are marked purged afterwards. A file whose
            // delete fails stays unmarked and is tried again on the next run.
            List<MediaFile> due = tx.execute(st -> mediaRepository.findTop500ByPurgeAfterBeforeAndPurgedAtIsNull(Instant.now()));
            if (due == null || due.isEmpty()) {
                break;
            }
            List<MediaFile> done = new ArrayList<>();
            for (MediaFile m : due) {
                try {
                    media.purge(m);
                    done.add(m);
                } catch (RuntimeException e) {
                    log.warn("Retention: could not delete media {}: {}", m.getId(), e.toString());
                }
            }
            tx.executeWithoutResult(st -> mediaRepository.saveAll(done));
            purged += done.size();
            if (due.size() < 500 || done.isEmpty()) {
                break;
            }
        }
        Integer templates = tx.execute(st -> templateRepository.deleteUnregisteredEndedBefore(Instant.now().minus(1, ChronoUnit.DAYS)));
        Long tenantId = tenantService.defaultTenantId();
        int auditDays = retentionRepository.findByTenantIdAndDataCategory(tenantId, "AUDIT_EVENTS")
                .map(RetentionPolicy::getRetentionDays).orElse(730);
        Integer deleted = tx.execute(st -> auditRepository.deleteOlderThan(tenantId, Instant.now().minus(auditDays, ChronoUnit.DAYS)));
        long ms = System.currentTimeMillis() - start;
        if (purged > 0 || (deleted != null && deleted > 0) || (templates != null && templates > 0)) {
            log.info("Retention run: purged {} images, {} unregistered face templates, deleted {} audit entries older than {} days in {} ms",
                    purged, templates, deleted, auditDays, ms);
        } else {
            log.debug("Retention run: nothing to purge (audit retention {} days, {} ms)", auditDays, ms);
        }
    }
}
