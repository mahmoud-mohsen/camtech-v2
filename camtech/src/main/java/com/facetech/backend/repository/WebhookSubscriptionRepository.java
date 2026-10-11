package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.WebhookSubscription;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WebhookSubscriptionRepository extends JpaRepository<WebhookSubscription, Long> {

    List<WebhookSubscription> findByTenantIdAndStatus(Long tenantId, Codes.ActiveStatus status);

    List<WebhookSubscription> findByTenantIdOrderByCreatedAtAsc(Long tenantId);
}
