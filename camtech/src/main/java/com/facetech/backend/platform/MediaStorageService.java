package com.facetech.backend.platform;

import com.drew.imaging.ImageMetadataReader;
import com.drew.metadata.Metadata;
import com.drew.metadata.exif.ExifIFD0Directory;
import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.RetentionPolicy;
import com.facetech.backend.exception.FaceMatchException;
import com.facetech.backend.platform.storage.ObjectStore;
import com.facetech.backend.platform.storage.StorageProperties;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.RetentionPolicyRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.awt.Graphics2D;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Iterator;

/**
 * Stores uploaded images in the object store (OCI Object Storage) under the
 * camtech root folder, using the per-case layout from MediaKeys, and records
 * each one in media_file with its SHA-256, size, dimensions and the date it
 * must be purged (from retention_policy).
 */
@Service
@Slf4j
public class MediaStorageService {

    private final ObjectStore store;
    private final String rootFolder;
    private final MediaFileRepository mediaRepository;
    private final RetentionPolicyRepository retentionRepository;
    private final TenantService tenantService;

    public MediaStorageService(ObjectStore store, StorageProperties storageProperties,
                               MediaFileRepository mediaRepository,
                               RetentionPolicyRepository retentionRepository,
                               TenantService tenantService) {
        this.store = store;
        String folder = storageProperties.getRootFolder();
        this.rootFolder = folder == null || folder.isBlank() ? "camtech" : folder.replaceAll("^/+|/+$", "");
        this.mediaRepository = mediaRepository;
        this.retentionRepository = retentionRepository;
        this.tenantService = tenantService;
        log.info("Media root folder: {}", rootFolder);
    }

    /** An object already in the store whose media_file row is not saved yet, see {@link #upload} and {@link #save}. */
    public record Upload(String uri, String mime, String sha256, int byteCount, int[] size) {
    }

    /**
     * Uploads the bytes and saves the media_file row.
     *
     * @param key            object key without root folder and extension, from {@link com.facetech.backend.platform.storage.MediaKeys}
     * @param fixOrientation rotate according to EXIF orientation first (document photos from galleries)
     */
    public MediaFile store(byte[] bytes, Codes.MediaCategory category, boolean fixOrientation, String key) {
        return save(upload(bytes, fixOrientation, key), category);
    }

    /**
     * Only the upload part of {@link #store}: no database work, so it can run before a transaction (and on another
     * thread) and no connection is held while the object store works.
     */
    public Upload upload(byte[] bytes, boolean fixOrientation, String key) {
        if (bytes == null || bytes.length == 0) {
            throw new FaceMatchException(HttpStatus.BAD_REQUEST, "EMPTY_IMAGE", "Empty image upload");
        }
        byte[] data = fixOrientation ? correctOrientation(bytes) : bytes;
        String mime = detectMime(data);
        String uri = store.put(rootFolder + "/" + key + extension(mime), data, mime);
        return new Upload(uri, mime, Secrets.sha256Hex(data), data.length, dimensions(data));
    }

    /** Saves the media_file row of an {@link #upload}. */
    public MediaFile save(Upload u, Codes.MediaCategory category) {
        MediaFile m = new MediaFile();
        m.setTenantId(tenantService.currentTenantId());
        m.setSha256(u.sha256());
        m.setMimeType(u.mime());
        m.setByteCount(u.byteCount());
        int[] size = u.size();
        if (size != null) {
            m.setWidth(size[0]);
            m.setHeight(size[1]);
        }
        m.setStorageUri(u.uri());
        setCategory(m, category);
        MediaFile saved = mediaRepository.save(m);
        log.debug("Stored media {} ({}, {}, {} bytes, {}x{}) purge after {}", saved.getId(), category, u.mime(),
                u.byteCount(), size != null ? size[0] : "?", size != null ? size[1] : "?", saved.getPurgeAfter());
        return saved;
    }

    /** Moves a file to another retention category, e.g. once its attempt failed. */
    public void setCategory(MediaFile m, Codes.MediaCategory category) {
        m.setDataCategory(category);
        int days = retentionRepository.findByTenantIdAndDataCategory(m.getTenantId(), category.name())
                .map(RetentionPolicy::getRetentionDays).orElse(365);
        m.setPurgeAfter(Instant.now().plus(days, ChronoUnit.DAYS));
        log.debug("Media {} category {} retained {} days", m.getId(), category, days);
    }

    public byte[] read(MediaFile m) {
        if (m.getPurgedAt() != null) {
            throw new FaceMatchException(HttpStatus.GONE, "MEDIA_PURGED", "This image was deleted by the retention policy");
        }
        return store.get(m.getStorageUri());
    }

    /** Deletes the object; the row stays with purged_at set so history still shows an image existed. */
    public void purge(MediaFile m) {
        store.delete(m.getStorageUri());
        m.setPurgedAt(Instant.now());
        log.debug("Purged media {} ({})", m.getId(), m.getDataCategory());
    }

    static String detectMime(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) {
            return "image/jpeg";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
            return "image/png";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        if (b.length >= 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') {
            return "application/pdf";
        }
        if (b.length >= 12 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
            return "image/heic";
        }
        return "application/octet-stream";
    }

    private static String extension(String mime) {
        return switch (mime) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            case "application/pdf" -> ".pdf";
            case "image/heic" -> ".heic";
            default -> ".bin";
        };
    }

    private static int[] dimensions(byte[] data) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
            if (in == null) {
                return null;
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in);
                return new int[]{reader.getWidth(0), reader.getHeight(0)};
            } finally {
                reader.dispose();
            }
        } catch (Exception e) {
            log.debug("Could not read image dimensions: {}", e.toString());
            return null;
        }
    }

    /** Applies the EXIF orientation so the stored image is upright. Returns the input on any problem. */
    private static byte[] correctOrientation(byte[] bytes) {
        try {
            Metadata metadata = ImageMetadataReader.readMetadata(new ByteArrayInputStream(bytes));
            ExifIFD0Directory exif = metadata.getFirstDirectoryOfType(ExifIFD0Directory.class);
            if (exif == null || !exif.containsTag(ExifIFD0Directory.TAG_ORIENTATION)) {
                return bytes;
            }
            int orientation = exif.getInt(ExifIFD0Directory.TAG_ORIENTATION);
            if (orientation == 1) {
                return bytes;
            }
            BufferedImage src = ImageIO.read(new ByteArrayInputStream(bytes));
            if (src == null) {
                return bytes;
            }
            int w = src.getWidth();
            int h = src.getHeight();
            AffineTransform t = new AffineTransform();
            int nw = w;
            int nh = h;
            switch (orientation) {
                case 2 -> { t.scale(-1.0, 1.0); t.translate(-w, 0); }
                case 3 -> { t.translate(w, h); t.rotate(Math.PI); }
                case 4 -> { t.scale(1.0, -1.0); t.translate(0, -h); }
                case 5 -> { nw = h; nh = w; t.rotate(Math.PI / 2); t.scale(-1.0, 1.0); }
                case 6 -> { nw = h; nh = w; t.translate(h, 0); t.rotate(Math.PI / 2); }
                case 7 -> { nw = h; nh = w; t.scale(-1.0, 1.0); t.translate(-h, 0); t.translate(0, w); t.rotate(3 * Math.PI / 2); }
                case 8 -> { nw = h; nh = w; t.translate(0, w); t.rotate(3 * Math.PI / 2); }
                default -> {
                    return bytes;
                }
            }
            int type = src.getType() == 0 ? BufferedImage.TYPE_INT_RGB : src.getType();
            BufferedImage out = new BufferedImage(nw, nh, type);
            Graphics2D g = out.createGraphics();
            g.setTransform(t);
            g.drawImage(src, 0, 0, null);
            g.dispose();
            ByteArrayOutputStream os = new ByteArrayOutputStream();
            ImageIO.write(out, "jpeg", os);
            return os.toByteArray();
        } catch (Exception e) {
            log.debug("Could not correct image orientation, keeping the original: {}", e.toString());
            return bytes;
        }
    }
}
