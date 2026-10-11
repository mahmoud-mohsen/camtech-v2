package com.facetech.backend.api;

import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.verification.DeviceService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

/** Small helpers shared by the controllers. */
@Slf4j
public final class ApiSupport {

    private ApiSupport() {
    }

    /** Device headers sent by the mobile and web SDKs. All optional. */
    public static DeviceService.DeviceInfo deviceInfo(HttpServletRequest request) {
        return new DeviceService.DeviceInfo(
                header(request, "X-Device-Id"),
                header(request, "X-Platform"),
                header(request, "X-OS-Version"),
                header(request, "X-App-Version"),
                header(request, "X-Device-Model"),
                null);
    }

    /** The bytes of an optional part, or null when it was not sent. */
    public static byte[] optionalBytes(MultipartFile file, String field) {
        return file == null || file.isEmpty() ? null : bytes(file, field);
    }

    public static byte[] bytes(MultipartFile file, String field) {
        if (file == null || file.isEmpty()) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "EMPTY_IMAGE", "Upload the image in field '" + field + "'.");
        }
        try {
            byte[] bytes = file.getBytes();
            log.debug("Upload received: field={} bytes={} contentType={}", field, bytes.length, file.getContentType());
            return bytes;
        } catch (IOException e) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "BAD_UPLOAD",
                    "Failed to read uploaded image: " + e.getMessage(), e);
        }
    }

    /** Most frames one active-liveness upload may carry, and the largest frame. */
    static final int MAX_CHALLENGE_FRAMES = 16;
    static final long MAX_CHALLENGE_FRAME_BYTES = 1_000_000;

    /** Active-liveness frames in capture order (empty when none were sent). */
    public static List<byte[]> frames(List<MultipartFile> files) {
        if (files == null || files.isEmpty()) {
            return List.of();
        }
        if (files.size() > MAX_CHALLENGE_FRAMES) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                    "Send at most " + MAX_CHALLENGE_FRAMES + " challenge frames");
        }
        List<byte[]> out = new ArrayList<>();
        for (MultipartFile f : files) {
            if (f.getSize() > MAX_CHALLENGE_FRAME_BYTES) {
                throw new FaceMatchException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE",
                        "Each challenge frame must be under 1 MB");
            }
            out.add(bytes(f, "challengeFrames"));
        }
        log.debug("Challenge frames received: count={} totalBytes={}", out.size(),
                out.stream().mapToLong(b -> b.length).sum());
        return out;
    }

    public static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }

    private static String header(HttpServletRequest request, String name) {
        String v = request.getHeader(name);
        return v == null || v.isBlank() ? null : v.trim();
    }
}
