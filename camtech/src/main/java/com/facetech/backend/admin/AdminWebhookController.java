package com.facetech.backend.admin;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.OutboxEvent;
import com.facetech.backend.domain.WebhookDelivery;
import com.facetech.backend.domain.WebhookSubscription;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.AuditService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.Secrets;
import com.facetech.backend.platform.WebhookSender;
import com.facetech.backend.repository.OutboxEventRepository;
import com.facetech.backend.repository.WebhookDeliveryRepository;
import com.facetech.backend.repository.WebhookSubscriptionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
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

import java.net.URI;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Webhook subscriptions for result events, and their delivery history. */
@Slf4j
@RestController
@RequestMapping("/v2/admin")
public class AdminWebhookController {

    static final Set<String> EVENTS = Set.of(Codes.EVENT_SESSION_COMPLETED, Codes.EVENT_SESSION_EXPIRED,
            Codes.EVENT_REVIEW_OPENED, Codes.EVENT_REVIEW_DECIDED, Codes.EVENT_SCAN_REVIEW_REQUIRED,
            Codes.EVENT_SCAN_REVIEW_DECIDED, Codes.EVENT_DOCUMENT_EXPIRING, Codes.EVENT_PARTY_ERASED);

    private final WebhookSubscriptionRepository subscriptionRepository;
    private final WebhookDeliveryRepository deliveryRepository;
    private final OutboxEventRepository outboxRepository;
    private final WebhookSender sender;
    private final AuditService audit;
    private final ObjectMapper objectMapper;

    public AdminWebhookController(WebhookSubscriptionRepository subscriptionRepository,
                                  WebhookDeliveryRepository deliveryRepository, OutboxEventRepository outboxRepository,
                                  WebhookSender sender, AuditService audit, ObjectMapper objectMapper) {
        this.subscriptionRepository = subscriptionRepository;
        this.deliveryRepository = deliveryRepository;
        this.outboxRepository = outboxRepository;
        this.sender = sender;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    /**
     * @param consecutiveFailures failed deliveries in a row, newest first (up to {@link #FAILING_AFTER})
     * @param failing             the last {@link #FAILING_AFTER} deliveries all failed
     */
    public record WebhookView(Long id, String url, List<String> events, String status, Instant createdAt,
                              Instant lastDeliveryAt, String lastStatus, int consecutiveFailures, boolean failing) {
    }

    /** Deliveries in a row that must fail before an endpoint is flagged as failing. */
    public static final int FAILING_AFTER = 5;

    public record WebhookRequest(String url, List<String> events, String status) {
    }

    public record WithSecret(WebhookView webhook, String secret) {
    }

    public record DeliveryView(Long id, Long webhookId, String eventType, Long eventId, int attempt, Integer httpStatus,
                               String status, String error, Instant nextRetryAt, Instant createdAt) {
    }

    @GetMapping("/webhooks")
    @Transactional(readOnly = true)
    public List<WebhookView> webhooks() {
        return subscriptionRepository.findByTenantIdOrderByCreatedAtAsc(tenantId()).stream().map(this::view).toList();
    }

    @PostMapping("/webhooks")
    @Transactional
    public ResponseEntity<WithSecret> create(@RequestBody WebhookRequest body) {
        WebhookSubscription s = new WebhookSubscription();
        s.setTenantId(tenantId());
        s.setUrl(url(body.url()));
        s.setEvents(events(body.events()));
        s.setSecret("whsec_" + Secrets.token(24));
        s.setStatus(Codes.ActiveStatus.ACTIVE);
        subscriptionRepository.save(s);
        audit.record("WEBHOOK_CREATED", "webhook_subscription", s.getId(), Map.of("url", s.getUrl()));
        log.info("Webhook created by {}: tenantId={} webhookId={} host={} events={}",
                actor(), tenantId(), s.getId(), host(s.getUrl()), s.getEvents());
        return ResponseEntity.status(HttpStatus.CREATED).body(new WithSecret(view(s), s.getSecret()));
    }

    @PutMapping("/webhooks/{id}")
    @Transactional
    public WebhookView update(@PathVariable Long id, @RequestBody WebhookRequest body) {
        WebhookSubscription s = subscription(id);
        Codes.ActiveStatus oldStatus = s.getStatus();
        String oldHost = host(s.getUrl());
        String oldEvents = s.getEvents();
        if (body.url() != null) {
            s.setUrl(url(body.url()));
        }
        if (body.events() != null) {
            s.setEvents(events(body.events()));
        }
        if (body.status() != null) {
            s.setStatus(AdminParams.enumOrNull(Codes.ActiveStatus.class, body.status()));
        }
        audit.record("WEBHOOK_UPDATED", "webhook_subscription", s.getId(), Map.of("status", s.getStatus().name()));
        log.info("Webhook updated by {}: webhookId={} host {}->{} events {}->{} status {}->{}",
                actor(), s.getId(), oldHost, host(s.getUrl()), oldEvents, s.getEvents(), oldStatus, s.getStatus());
        return view(s);
    }

    @DeleteMapping("/webhooks/{id}")
    @Transactional
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        WebhookSubscription s = subscription(id);
        deliveryRepository.deleteBySubscription(s.getId());
        subscriptionRepository.delete(s);
        audit.record("WEBHOOK_DELETED", "webhook_subscription", id, Map.of("url", s.getUrl()));
        log.info("Webhook deleted by {}: tenantId={} webhookId={} host={} (delivery history removed)",
                actor(), tenantId(), id, host(s.getUrl()));
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/webhooks/{id}/rotate-secret")
    @Transactional
    public WithSecret rotate(@PathVariable Long id) {
        WebhookSubscription s = subscription(id);
        s.setSecret("whsec_" + Secrets.token(24));
        audit.record("WEBHOOK_SECRET_ROTATED", "webhook_subscription", s.getId(), null);
        log.info("Webhook secret rotated by {}: webhookId={}", actor(), s.getId());
        return new WithSecret(view(s), s.getSecret());
    }

    /** Sends a test event now and returns the delivery result. */
    @PostMapping("/webhooks/{id}/test")
    @Transactional
    public DeliveryView test(@PathVariable Long id) {
        WebhookSubscription s = subscription(id);
        WebhookDelivery d = new WebhookDelivery();
        d.setTenantId(s.getTenantId());
        d.setSubscriptionId(s.getId());
        d.setEventType(Codes.EVENT_WEBHOOK_TEST);
        d.setStatus(Codes.DeliveryStatus.PENDING);
        deliveryRepository.save(d);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("eventType", Codes.EVENT_WEBHOOK_TEST);
        payload.put("occurredAt", Instant.now().toString());
        payload.put("data", Map.of("message", "Test event from camtech"));
        try {
            sender.send(s, d, objectMapper.writeValueAsString(payload));
        } catch (Exception e) {
            throw new FaceMatchException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Could not build the test event");
        }
        if (d.getStatus() == Codes.DeliveryStatus.RETRYING) {
            d.setStatus(Codes.DeliveryStatus.FAILED);
            d.setNextRetryAt(null);
        }
        log.info("Webhook test sent by {}: webhookId={} deliveryId={} status={} httpStatus={}",
                actor(), s.getId(), d.getId(), d.getStatus(), d.getHttpStatus());
        return delivery(d);
    }

    @GetMapping("/webhooks/{id}/deliveries")
    @Transactional(readOnly = true)
    public AdminViews.PageView<DeliveryView> deliveries(@PathVariable Long id, @RequestParam(defaultValue = "0") int page,
                                                        @RequestParam(defaultValue = "20") int size) {
        subscription(id);
        Page<WebhookDelivery> result = deliveryRepository.findBySubscriptionIdOrderByCreatedAtDesc(id,
                AdminParams.page(page, size, Sort.unsorted()));
        return AdminViews.PageView.of(result, result.getContent().stream().map(AdminWebhookController::delivery).toList());
    }

    @PostMapping("/webhook-deliveries/{id}/retry")
    @Transactional
    public DeliveryView retry(@PathVariable Long id) {
        WebhookDelivery d = deliveryRepository.findById(id).filter(x -> x.getTenantId().equals(tenantId()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Delivery not found"));
        if (d.getOutboxEventId() == null) {
            throw new FaceMatchException(HttpStatus.CONFLICT, "NOT_RETRYABLE", "Test deliveries cannot be retried; send a new test");
        }
        WebhookSubscription s = subscription(d.getSubscriptionId());
        OutboxEvent event = outboxRepository.findById(d.getOutboxEventId()).orElseThrow();
        sender.send(s, d, event.getPayload());
        audit.record("WEBHOOK_RETRIED", "webhook_delivery", d.getId(), Map.of("status", d.getStatus().name()));
        log.info("Webhook delivery retried by {}: deliveryId={} webhookId={} eventType={} status={} httpStatus={}",
                actor(), d.getId(), s.getId(), d.getEventType(), d.getStatus(), d.getHttpStatus());
        return delivery(d);
    }

    private WebhookView view(WebhookSubscription s) {
        List<WebhookDelivery> recent = s.getId() == null ? List.of() : deliveryRepository
                .findBySubscriptionIdOrderByCreatedAtDesc(s.getId(), PageRequest.of(0, FAILING_AFTER)).getContent();
        WebhookDelivery last = recent.isEmpty() ? null : recent.get(0);
        int failures = 0;
        for (WebhookDelivery d : recent) {
            if (d.getStatus() != Codes.DeliveryStatus.FAILED && d.getStatus() != Codes.DeliveryStatus.RETRYING) {
                break;
            }
            failures++;
        }
        return new WebhookView(s.getId(), s.getUrl(), Arrays.stream(s.getEvents().split(",")).map(String::trim).toList(),
                s.getStatus().name(), s.getCreatedAt(), last != null ? last.getCreatedAt() : null,
                last != null ? last.getStatus().name() : null, failures, failures >= FAILING_AFTER);
    }

    static DeliveryView delivery(WebhookDelivery d) {
        return new DeliveryView(d.getId(), d.getSubscriptionId(), d.getEventType(), d.getOutboxEventId(), d.getAttempt(),
                d.getHttpStatus(), d.getStatus().name(), d.getErrorMessage(), d.getNextRetryAt(), d.getCreatedAt());
    }

    private WebhookSubscription subscription(Long id) {
        return subscriptionRepository.findById(id).filter(s -> s.getTenantId().equals(tenantId()))
                .orElseThrow(() -> new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Webhook not found"));
    }

    private static String url(String raw) {
        String v = AdminParams.required(raw, "url");
        try {
            URI u = URI.create(v);
            if (!"https".equalsIgnoreCase(u.getScheme()) && !"http".equalsIgnoreCase(u.getScheme()) || u.getHost() == null) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException e) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Enter a full http(s) URL");
        }
        if (v.length() > 1000) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "The URL is too long");
        }
        return v;
    }

    private static String events(List<String> events) {
        if (events == null || events.isEmpty()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Choose at least one event");
        }
        for (String e : events) {
            if (!EVENTS.contains(e)) {
                throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Unknown event " + e);
            }
        }
        return String.join(",", events.stream().distinct().toList());
    }

    private static Long tenantId() {
        return RequestContext.get().getTenantId();
    }

    /** Who made a change, for the log: a back-office user, or the tenant portal (which reuses these handlers). */
    private static String actor() {
        RequestContext ctx = RequestContext.get();
        if (ctx.getAdminUser() != null) {
            return "adminUserId=" + ctx.getAdminUser().getId();
        }
        return "portalTenant=" + ctx.getPortalTenantCode();
    }

    /** Only the host of a webhook URL is logged: paths and query strings may carry the receiver's keys. */
    private static String host(String url) {
        try {
            return url == null ? null : URI.create(url).getHost();
        } catch (IllegalArgumentException e) {
            return "?";
        }
    }
}
