package com.facetech.backend.platform;

import com.facetech.backend.domain.RefReasonCode;
import com.facetech.backend.repository.RefReasonCodeRepository;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/** User-facing messages for reason codes, in English or Arabic (ref_reason_code). */
@Service
public class ReasonCatalog {

    private static final long CACHE_MILLIS = 60_000;

    private final RefReasonCodeRepository repository;
    private volatile Map<String, RefReasonCode> byCode = Map.of();
    private volatile long loadedAt;

    public ReasonCatalog(RefReasonCodeRepository repository) {
        this.repository = repository;
    }

    /** The message for {@code code} in {@code lang} ("ar" falls back to English), or null if unknown. */
    public String message(String code, String lang) {
        if (code == null) {
            return null;
        }
        RefReasonCode rc = codes().get(code);
        if (rc == null) {
            return null;
        }
        if ("ar".equals(lang) && rc.getMessageAr() != null && !rc.getMessageAr().isBlank()) {
            return rc.getMessageAr();
        }
        return rc.getMessageEn();
    }

    public String message(String code) {
        return message(code, RequestContext.get().getLang());
    }

    public void evict() {
        loadedAt = 0;
    }

    private Map<String, RefReasonCode> codes() {
        long now = System.currentTimeMillis();
        if (now - loadedAt > CACHE_MILLIS) {
            Map<String, RefReasonCode> map = new HashMap<>();
            for (RefReasonCode rc : repository.findAll()) {
                map.put(rc.getCode(), rc);
            }
            byCode = map;
            loadedAt = now;
        }
        return byCode;
    }
}
