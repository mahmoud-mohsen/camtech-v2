package com.facetech.backend.platform;

import com.facetech.backend.domain.AuditEvent;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.repository.AuditEventRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;

/** Append-only record of who did what to which record (audit_event). */
@Service
@Slf4j
public class AuditService {

    private final AuditEventRepository repository;
    private final TenantService tenantService;
    private final ObjectMapper objectMapper;

    public AuditService(AuditEventRepository repository, TenantService tenantService, ObjectMapper objectMapper) {
        this.repository = repository;
        this.tenantService = tenantService;
        this.objectMapper = objectMapper;
    }

    /** Records in the caller's transaction, so the entry disappears if the change is rolled back. */
    @Transactional(propagation = Propagation.REQUIRED)
    public void record(String action, String entity, Object entityId, Map<String, ?> details) {
        RequestContext ctx = RequestContext.get();
        AuditEvent e = new AuditEvent();
        e.setTenantId(tenantService.currentTenantId());
        if (ctx.getAdminUser() != null) {
            e.setActorType(Codes.ActorType.ADMIN);
            e.setActor(ctx.getAdminUser().getUsername());
        } else if (ctx.getPortalTenantCode() != null) {
            e.setActorType(Codes.ActorType.TENANT);
            e.setActor(com.facetech.backend.domain.Actor.current());
        } else if (ctx.getClientApp() != null) {
            e.setActorType(Codes.ActorType.CLIENT);
            e.setActor(ctx.getClientApp().getCode());
        } else {
            e.setActorType(Codes.ActorType.SYSTEM);
            e.setActor(com.facetech.backend.domain.Actor.current());
        }
        e.setAction(action);
        e.setEntity(entity);
        e.setEntityId(entityId != null ? String.valueOf(entityId) : null);
        e.setIpAddress(ctx.getIpAddress());
        e.setDetails(toJson(details));
        e.setOccurredAt(Instant.now());
        repository.save(e);
        log.debug("Audit {} on {} {} by {} {}", action, entity, e.getEntityId(), e.getActorType(), e.getActor());
    }

    /** Records even when the caller's transaction later fails (e.g. a rejected login). */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordAlways(String action, String entity, Object entityId, Map<String, ?> details) {
        record(action, entity, entityId, details);
    }

    private String toJson(Map<String, ?> details) {
        if (details == null || details.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(details);
        } catch (JsonProcessingException ex) {
            log.warn("Could not serialise audit details: {}", ex.getMessage());
            return null;
        }
    }
}
