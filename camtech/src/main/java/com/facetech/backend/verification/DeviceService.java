package com.facetech.backend.verification;

import com.facetech.backend.domain.ClientApp;
import com.facetech.backend.domain.Device;
import com.facetech.backend.repository.DeviceRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;

/** Records the device a verification runs on (X-Device-Id, X-Platform, X-OS-Version, X-App-Version, X-Device-Model). */
@Service
@Slf4j
public class DeviceService {

    private final DeviceRepository repository;

    public DeviceService(DeviceRepository repository) {
        this.repository = repository;
    }

    public record DeviceInfo(String deviceRef, String platform, String osVersion, String appVersion, String model,
                             String attestationStatus) {
        public boolean isEmpty() {
            return deviceRef == null || deviceRef.isBlank();
        }
    }

    /** @return the device id, or null when the app sent no device id */
    public Long upsert(ClientApp app, DeviceInfo info) {
        if (app == null || info == null || info.isEmpty()) {
            log.debug("No device id sent by client app {}: device not recorded", app == null ? null : app.getId());
            return null;
        }
        Instant now = Instant.now();
        Device d = repository.findByClientAppIdAndDeviceRef(app.getId(), cut(info.deviceRef(), 200)).orElseGet(() -> {
            Device n = new Device();
            n.setTenantId(app.getTenantId());
            n.setClientAppId(app.getId());
            n.setDeviceRef(cut(info.deviceRef(), 200));
            n.setFirstSeenAt(now);
            return n;
        });
        if (info.platform() != null) {
            d.setPlatform(cut(info.platform().toUpperCase(), 20));
        }
        if (info.osVersion() != null) {
            d.setOsVersion(cut(info.osVersion(), 50));
        }
        if (info.appVersion() != null) {
            d.setAppVersion(cut(info.appVersion(), 50));
        }
        if (info.model() != null) {
            d.setModel(cut(info.model(), 100));
        }
        d.setAttestationStatus(info.attestationStatus() != null ? info.attestationStatus() : "NOT_PROVIDED");
        d.setLastSeenAt(now);
        boolean isNew = d.getId() == null;
        Long id = repository.save(d).getId();
        log.debug("Device {} {}: platform={} os={} app={} model={} attestation={}", id, isNew ? "registered" : "seen again",
                d.getPlatform(), d.getOsVersion(), d.getAppVersion(), d.getModel(), d.getAttestationStatus());
        return id;
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
