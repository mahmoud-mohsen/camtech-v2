package com.facetech.backend.platform.storage;

import com.facetech.backend.exception.FaceMatchException;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.GetObjectResponse;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;

import java.io.ByteArrayInputStream;

/** OCI Object Storage through the S3-compatible endpoint, using the MinIO client. */
@Slf4j
public class OciObjectStore implements ObjectStore {

    static final String SCHEME = "oci://";

    private final MinioClient client;
    private final String bucket;

    public OciObjectStore(StorageProperties props) {
        require(props.getHost(), "storage.host (CAMTECH_OCI_HOST)");
        require(props.getBucket().getName(), "storage.bucket.name (CAMTECH_OCI_BUCKET)");
        require(props.getAccessKey(), "storage.access-key (CAMTECH_OCI_ACCESS_KEY)");
        require(props.getSecretKey(), "storage.secret-key (CAMTECH_OCI_SECRET_KEY)");
        this.bucket = props.getBucket().getName();
        MinioClient.Builder builder = MinioClient.builder()
                .endpoint(props.getHost())
                .credentials(props.getAccessKey(), props.getSecretKey());
        if (props.getRegion() != null && !props.getRegion().isBlank()) {
            builder.region(props.getRegion());
        }
        this.client = builder.build();
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                log.warn("OCI bucket {} does not exist or is not visible with these credentials", bucket);
            } else {
                log.info("Image storage: OCI bucket {} at {}", bucket, props.getHost());
            }
        } catch (Exception e) {
            log.warn("Could not reach OCI bucket {} at startup: {}", bucket, e.getMessage());
        }
    }

    @Override
    public String put(String key, byte[] bytes, String contentType) {
        long start = System.currentTimeMillis();
        try {
            client.putObject(PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(key)
                    .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                    .contentType(contentType)
                    .build());
            log.debug("OCI put {} in bucket {}: {} bytes, {} ms", key, bucket, bytes.length,
                    System.currentTimeMillis() - start);
            return SCHEME + bucket + "/" + key;
        } catch (Exception e) {
            log.warn("Could not put {} in OCI bucket {}: {}", key, bucket, e.toString());
            throw new FaceMatchException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_ERROR",
                    "Failed to store the image", e);
        }
    }

    @Override
    public byte[] get(String uri) {
        Location loc = parse(uri);
        long start = System.currentTimeMillis();
        try (GetObjectResponse in = client.getObject(GetObjectArgs.builder().bucket(loc.bucket).object(loc.key).build())) {
            byte[] bytes = in.readAllBytes();
            log.debug("OCI get {} from bucket {}: {} bytes, {} ms", loc.key, loc.bucket, bytes.length,
                    System.currentTimeMillis() - start);
            return bytes;
        } catch (Exception e) {
            log.warn("Could not get {} from OCI bucket {} after {} ms: {}", loc.key, loc.bucket,
                    System.currentTimeMillis() - start, e.toString());
            throw new FaceMatchException(HttpStatus.GONE, "MEDIA_PURGED", "The image file is no longer available", e);
        }
    }

    @Override
    public void delete(String uri) {
        Location loc = parse(uri);
        long start = System.currentTimeMillis();
        try {
            client.removeObject(RemoveObjectArgs.builder().bucket(loc.bucket).object(loc.key).build());
            log.debug("OCI delete {} from bucket {}: {} ms", loc.key, loc.bucket, System.currentTimeMillis() - start);
        } catch (Exception e) {
            log.warn("Could not delete {}: {}", uri, e.toString());
        }
    }

    private static Location parse(String uri) {
        if (uri == null || !uri.startsWith(SCHEME)) {
            throw new FaceMatchException(HttpStatus.GONE, "MEDIA_PURGED", "The image is stored elsewhere: " + uri);
        }
        String rest = uri.substring(SCHEME.length());
        int slash = rest.indexOf('/');
        return new Location(rest.substring(0, slash), rest.substring(slash + 1));
    }

    private static void require(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is not set. Configure OCI Object Storage.");
        }
    }

    private record Location(String bucket, String key) {
    }
}
