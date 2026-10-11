package com.facetech.backend.verification;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.VerificationStep;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.storage.MediaKeys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;

/**
 * The selfies and challenge frames of a liveness attempt, uploaded in two phases: {@link #upload} puts the objects in
 * the store in parallel before the transaction (no database connection is held during the uploads), and
 * {@link #save} records the media_file rows and attaches them to the step inside it.
 * <p>
 * Same rules as before: verified selfies must be stored (the upload error is thrown), failed-attempt selfies and all
 * challenge frames are best effort.
 */
@Service
@Slf4j
public class SessionMedia {

    /** Uploaded selfies ({@code normal} null when they could not be kept) and frames (null entries were not kept). */
    public record Uploads(String publicId, MediaStorageService.Upload normal, MediaStorageService.Upload closer,
                          List<MediaStorageService.Upload> frames) {

        /** Nothing to record, e.g. failed media are not kept. */
        public static Uploads none(String publicId) {
            return new Uploads(publicId, null, null, List.of());
        }
    }

    private final MediaStorageService media;
    private final SessionSupport support;
    private final Executor executor;

    public SessionMedia(MediaStorageService media, SessionSupport support,
                        @Qualifier("mediaUploadExecutor") Executor executor) {
        this.media = media;
        this.support = support;
        this.executor = executor;
    }

    /** Uploads the selfies ({@code closer} and {@code frames} optional) under the session's liveness folder. */
    public Uploads upload(String flow, Instant createdAt, String publicId, int attempt, byte[] normal, byte[] closer,
                          List<byte[]> frames, Codes.MediaCategory category) {
        CompletableFuture<MediaStorageService.Upload> n = put(normal,
                MediaKeys.sessionFile(flow, createdAt, publicId, "liveness", attempt, "normal"));
        CompletableFuture<MediaStorageService.Upload> c = closer == null ? CompletableFuture.completedFuture(null)
                : put(closer, MediaKeys.sessionFile(flow, createdAt, publicId, "liveness", attempt, "closer"));
        List<CompletableFuture<MediaStorageService.Upload>> f = new ArrayList<>();
        for (int i = 0; frames != null && i < frames.size(); i++) {
            f.add(put(frames.get(i), MediaKeys.sessionFile(flow, createdAt, publicId, "liveness", attempt,
                    "challenge-" + (i + 1))));
        }

        List<MediaStorageService.Upload> keptFrames = new ArrayList<>();
        for (int i = 0; i < f.size(); i++) {
            try {
                keptFrames.add(join(f.get(i)));
            } catch (FaceMatchException e) {
                log.warn("Could not keep challenge frame {} of {}: {} (cause: {})", i + 1, publicId, e.getMessage(),
                        String.valueOf(e.getCause()));
                keptFrames.add(null);
            }
        }
        try {
            return new Uploads(publicId, join(n), join(c), keptFrames);
        } catch (FaceMatchException e) {
            if (category != Codes.MediaCategory.FAILED_ATTEMPT_MEDIA) {
                throw e;
            }
            log.warn("Could not keep failed selfies of {}: {} (cause: {})", publicId, e.getMessage(),
                    String.valueOf(e.getCause()));
            return new Uploads(publicId, null, null, keptFrames);
        }
    }

    /** Records the uploads with the step: returns {@code [normal, closer]}, or an empty array when not kept. */
    public MediaFile[] save(VerificationStep step, Uploads u, Codes.MediaCategory category) {
        MediaFile[] stored = new MediaFile[0];
        if (u.normal() != null) {
            MediaFile n = media.save(u.normal(), category);
            support.attachMedia(step, n, "SELFIE_NORMAL");
            MediaFile c = null;
            if (u.closer() != null) {
                c = media.save(u.closer(), category);
                support.attachMedia(step, c, "SELFIE_CLOSER");
            }
            stored = new MediaFile[]{n, c};
        }
        for (MediaStorageService.Upload frame : u.frames()) {
            if (frame != null) {
                support.attachMedia(step, media.save(frame, category), "CHALLENGE_FRAME");
            }
        }
        return stored;
    }

    private CompletableFuture<MediaStorageService.Upload> put(byte[] bytes, String key) {
        return CompletableFuture.supplyAsync(() -> media.upload(bytes, false, key), executor);
    }

    private static <T> T join(CompletableFuture<T> f) {
        try {
            return f.join();
        } catch (CompletionException e) {
            if (e.getCause() instanceof RuntimeException r) {
                throw r;
            }
            throw e;
        }
    }
}
