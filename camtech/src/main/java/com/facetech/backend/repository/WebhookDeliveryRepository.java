package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.WebhookDelivery;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface WebhookDeliveryRepository extends JpaRepository<WebhookDelivery, Long> {

    List<WebhookDelivery> findTop100ByStatusInAndNextRetryAtBeforeOrderByNextRetryAtAsc(Collection<Codes.DeliveryStatus> statuses, Instant before);

    Page<WebhookDelivery> findBySubscriptionIdOrderByCreatedAtDesc(Long subscriptionId, Pageable pageable);

    Optional<WebhookDelivery> findTopBySubscriptionIdOrderByCreatedAtDesc(Long subscriptionId);

    @Modifying
    @Query("delete from WebhookDelivery d where d.subscriptionId = :subscriptionId")
    int deleteBySubscription(@Param("subscriptionId") Long subscriptionId);
}
