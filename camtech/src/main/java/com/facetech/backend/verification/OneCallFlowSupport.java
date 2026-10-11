package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.VerificationDecision;
import com.facetech.backend.domain.VerificationSession;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.service.FaceEmbeddingClient;
import com.facetech.backend.platform.ConfigKey;
import com.facetech.backend.platform.ConfigService;
import com.facetech.backend.platform.EmbeddingCodec;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.platform.ResultTokenService;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.VerificationSessionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Building blocks of the flows that run in one call (liveness check, face registration): the session
 * with its liveness step, the stored selfies and challenge frames, face templates and the signed result.
 * Callers own the transaction; nothing here starts one.
 */
@Service
@Slf4j
public class OneCallFlowSupport {

    private final VerificationSessionRepository sessionRepository;
    private final FaceTemplateRepository templateRepository;
    private final SessionSupport support;
    private final ConfigService config;
    private final SessionMedia sessionMedia;
    private final DeviceService devices;
    private final ResultTokenService resultTokens;

    public OneCallFlowSupport(VerificationSessionRepository sessionRepository, FaceTemplateRepository templateRepository,
                              SessionSupport support, ConfigService config, SessionMedia sessionMedia,
                              DeviceService devices, ResultTokenService resultTokens) {
        this.sessionRepository = sessionRepository;
        this.templateRepository = templateRepository;
        this.support = support;
        this.config = config;
        this.sessionMedia = sessionMedia;
        this.devices = devices;
        this.resultTokens = resultTokens;
    }

    /** What the second transaction of a one-call flow needs from the first. */
    public record Opened(Long sessionId, String publicId, Long stepId, String flow, Instant createdAt) {
    }

    /** The outcome returned to the app; never any score. */
    public record Result(VerificationSession session, Codes.Decision decision, String reasonCode, String message,
                         String resultToken, Instant resultTokenExpiresAt) {
    }

    /** A new IN_PROGRESS session of {@code flow} with its first LIVENESS step. */
    public Opened open(String flow, Long partyId, String subjectRef, Codes.LivenessMode mode, boolean enrollFace,
                       DeviceService.DeviceInfo device) {
        RequestContext ctx = RequestContext.get();
        VerificationSession s = new VerificationSession();
        s.setTenantId(ctx.getTenantId());
        s.setPublicId(UUID.randomUUID().toString());
        s.setFlowCode(flow);
        s.setPartyId(partyId);
        s.setClientAppId(ctx.getClientApp().getId());
        s.setChannel(ctx.getClientApp().getChannel());
        s.setSubjectRef(subjectRef);
        s.setStatus(Codes.SessionStatus.IN_PROGRESS);
        s.setStage(Codes.Stage.CREATED);
        s.setLivenessMode(mode);
        s.setEnrollFace(enrollFace);
        s.setIpAddress(ctx.getIpAddress());
        s.setUserAgent(ctx.getUserAgent());
        s.setExpiresAt(Instant.now().plusSeconds(
                config.getInt(ConfigKey.SESSION_TTL_MINUTES, ConfigService.Scope.of(flow), 15) * 60L));
        s.setDeviceId(devices.upsert(ctx.getClientApp(), device));
        sessionRepository.save(s);
        VerificationStep step = support.startStep(s, Codes.LIVENESS, 1);
        return new Opened(s.getId(), s.getPublicId(), step.getId(), flow, s.getCreatedAt());
    }

    public VerificationSession session(Opened o) {
        return sessionRepository.findById(o.sessionId()).orElseThrow();
    }

    /**
     * Uploads the selfies and challenge frames of the session's liveness step; call it before the transaction and
     * record them with {@link #storeMedia} inside it. Failed-attempt media is best effort; verified selfies must be
     * stored.
     */
    public SessionMedia.Uploads uploadMedia(Opened o, byte[] normal, byte[] closer, List<byte[]> frames,
                                            Codes.MediaCategory category) {
        return sessionMedia.upload(o.flow(), o.createdAt(), o.publicId(), 1, normal, closer, frames, category);
    }

    /** Keeps the uploaded media with the step: {@code [normal, closer]} (closer null when not sent, empty when not kept). */
    public MediaFile[] storeMedia(VerificationStep step, SessionMedia.Uploads uploads, Codes.MediaCategory category) {
        return sessionMedia.save(step, uploads, category);
    }

    /** A SESSION-status selfie template; {@link SessionSupport#decide} registers it when the session is approved. */
    public void saveSelfieTemplate(VerificationSession s, MediaFile source, String pose, FaceEmbeddingClient.EmbedResult embed) {
        FaceTemplate t = new FaceTemplate();
        t.setTenantId(s.getTenantId());
        t.setPartyId(s.getPartyId());
        t.setSessionId(s.getId());
        t.setSourceMediaId(source != null ? source.getId() : null);
        t.setRole(Codes.TemplateRole.SELFIE);
        t.setPose(pose);
        t.setModelVersion(embed.modelVersion() != null ? embed.modelVersion() : "unknown");
        t.setDimension(embed.embedding().size());
        t.setVector(EmbeddingCodec.encode(embed.embedding()));
        t.setQualityScore(embed.detScore() > 0 ? BigDecimal.valueOf(embed.detScore()).setScale(6, RoundingMode.HALF_UP) : null);
        t.setStatus(Codes.TemplateStatus.SESSION);
        templateRepository.save(t);
    }

    /** Signs the result (same claims as the other flows) and links it to the decision. */
    public Result finish(VerificationSession s, Codes.Decision decision, String reasonCode, String message) {
        Map<String, Object> claims = new LinkedHashMap<>();
        if (s.getSubjectRef() != null) {
            claims.put("sub", s.getSubjectRef());
        }
        claims.put("sid", s.getPublicId());
        claims.put("flow", s.getFlowCode());
        claims.put("decision", decision.name());
        ResultTokenService.Issued token = resultTokens.issue(claims);
        VerificationDecision d = support.decisionOf(s);
        if (d != null) {
            d.setResultTokenJti(token.jti());
        }
        return new Result(s, decision, reasonCode, message, token.token(), token.expiresAt());
    }
}
