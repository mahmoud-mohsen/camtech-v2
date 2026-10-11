package com.facetech.backend.platform;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.OutboxEvent;
import com.facetech.backend.repository.OutboxEventRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Transactional outbox: events are written in the same transaction as the
 * change they describe, then delivered to webhooks by WebhookRelayJob.
 */
@Service
@Slf4j
public class OutboxService {

    private final OutboxEventRepository repository;
    private final TenantService tenantService;
    private final ObjectMapper objectMapper;

    public OutboxService(OutboxEventRepository repository, TenantService tenantService, ObjectMapper objectMapper) {
        this.repository = repository;
        this.tenantService = tenantService;
        this.objectMapper = objectMapper;
    }

    public OutboxEvent publish(String aggregateType, String aggregateId, String eventType, Map<String, ?> data) {
        return publish(tenantService.currentTenantId(), aggregateType, aggregateId, eventType, data);
    }

    /** For work that runs outside a tenant's request (background jobs, async processing). */
    public OutboxEvent publish(Long tenantId, String aggregateType, String aggregateId, String eventType,
                               Map<String, ?> data) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("eventType", eventType);
        payload.put("occurredAt", Instant.now().toString());
        payload.put("data", data);
        OutboxEvent e = new OutboxEvent();
        e.setTenantId(tenantId);
        e.setAggregateType(aggregateType);
        e.setAggregateId(aggregateId);
        e.setEventType(eventType);
        e.setStatus(Codes.OutboxStatus.PENDING);
        try {
            e.setPayload(objectMapper.writeValueAsString(payload));
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialise event " + eventType, ex);
        }
        OutboxEvent saved = repository.save(e);
        log.info("Queued outbox event {} {} for {} {} (tenant {})", saved.getId(), eventType, aggregateType,
                aggregateId, saved.getTenantId());
        return saved;
    }
}
