package com.facetech.backend.admin;

import com.facetech.backend.domain.AuditEvent;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.AuditEventRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

/** The audit log: who did what, when, from where. */
@RestController
@RequestMapping("/v2/admin")
public class AdminAuditController {

    private final AuditEventRepository repository;
    private final AdminViews views;

    public AdminAuditController(AuditEventRepository repository, AdminViews views) {
        this.repository = repository;
        this.views = views;
    }

    public record AuditView(Long id, String actorType, String actor, String action, String entity, String entityId,
                            String ipAddress, Map<String, Object> details, Instant at) {
    }

    @GetMapping("/audit-events")
    @Transactional(readOnly = true)
    public AdminViews.PageView<AuditView> events(@RequestParam(required = false) String actor,
                                                 @RequestParam(required = false) String actorType,
                                                 @RequestParam(required = false) String action,
                                                 @RequestParam(required = false) String entity,
                                                 @RequestParam(required = false) String from,
                                                 @RequestParam(required = false) String to,
                                                 @RequestParam(defaultValue = "0") int page,
                                                 @RequestParam(defaultValue = "50") int size) {
        Page<AuditEvent> result = repository.search(RequestContext.get().getTenantId(), AdminParams.blankToNull(actor),
                AdminParams.enumOrNull(Codes.ActorType.class, actorType),
                AdminParams.blankToNull(action), AdminParams.blankToNull(entity), AdminParams.startOfDay(from),
                AdminParams.endOfDay(to), AdminParams.page(page, size, Sort.by(Sort.Direction.DESC, "occurredAt")));
        return AdminViews.PageView.of(result, result.getContent().stream().map(e -> new AuditView(e.getId(),
                e.getActorType().name(), e.getActor(), e.getAction(), e.getEntity(), e.getEntityId(), e.getIpAddress(),
                views.json(e.getDetails()), e.getOccurredAt())).toList());
    }
}
