package com.facetech.backend.platform.storage;

import com.facetech.backend.exception.FaceMatchException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Keeps objects in a folder on this machine. For local development only
 * ({@code storage.type=local}): servers always use OCI Object Storage.
 */
@Slf4j
public class LocalFolderObjectStore implements ObjectStore {

    static final String SCHEME = "file-store://";

    private final Path root;

    public LocalFolderObjectStore(Path root) {
        this.root = root.toAbsolutePath().normalize();
        log.warn("Image storage: LOCAL folder {} (development only, never use on a server)", this.root);
    }

    @Override
    public String put(String key, byte[] bytes, String contentType) {
        Path file = resolve(key);
        try {
            Files.createDirectories(file.getParent());
            Files.write(file, bytes);
            log.debug("Local store put {}: {} bytes", key, bytes.length);
            return SCHEME + key;
        } catch (IOException e) {
            log.warn("Could not write {} to local store: {}", key, e.toString());
            throw new FaceMatchException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_ERROR", "Failed to store the image", e);
        }
    }

    @Override
    public byte[] get(String uri) {
        try {
            byte[] bytes = Files.readAllBytes(resolve(key(uri)));
            log.debug("Local store get {}: {} bytes", uri, bytes.length);
            return bytes;
        } catch (IOException e) {
            log.warn("Could not read {} from local store: {}", uri, e.toString());
            throw new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Image not found", e);
        }
    }

    @Override
    public void delete(String uri) {
        try {
            boolean deleted = Files.deleteIfExists(resolve(key(uri)));
            log.debug("Local store delete {}: {}", uri, deleted ? "deleted" : "not found");
        } catch (IOException e) {
            log.warn("Could not delete {}: {}", uri, e.toString());
        }
    }

    private static String key(String uri) {
        if (uri == null || !uri.startsWith(SCHEME)) {
            throw new FaceMatchException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Image not found");
        }
        return uri.substring(SCHEME.length());
    }

    /** The file for {@code key}, refusing keys that would leave the root folder. */
    private Path resolve(String key) {
        Path file = root.resolve(key).normalize();
        if (!file.startsWith(root)) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invalid storage key");
        }
        return file;
    }
}
