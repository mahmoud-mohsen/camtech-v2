package com.facetech.backend.jobs;

import com.facetech.backend.service.DocumentExpiryService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;

/** Daily: DOCUMENT_EXPIRING for documents entering their tenant's warning period. */
@Component
@EnableScheduling
@ConditionalOnProperty(name = "camtech.jobs.enabled", havingValue = "true", matchIfMissing = true)
@Slf4j
public class DocumentExpiryJob {

    private static final ZoneId ZONE = ZoneId.of("Asia/Dubai");

    private final DocumentExpiryService service;

    public DocumentExpiryJob(DocumentExpiryService service) {
        this.service = service;
    }

    @Scheduled(cron = "${camtech.jobs.document-expiry-cron:0 0 6 * * *}", zone = "Asia/Dubai")
    @SchedulerLock(name = "notifyExpiringDocuments", lockAtMostFor = "PT30M", lockAtLeastFor = "PT5M")
    public void notifyExpiring() {
        try {
            int sent = service.notifyExpiring(LocalDate.now(ZONE));
            log.info("Document expiry check done: {} DOCUMENT_EXPIRING events queued", sent);
        } catch (RuntimeException e) {
            log.error("Document expiry check failed: {}", e.getMessage(), e);
        }
    }
}
