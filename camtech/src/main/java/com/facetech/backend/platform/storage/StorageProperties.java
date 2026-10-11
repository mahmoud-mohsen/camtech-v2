package com.facetech.backend.platform.storage;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * OCI Object Storage settings ({@code storage.*} in application.yml), used through the
 * S3-compatible API. Every object camtech writes lives under {@link #rootFolder} in the bucket.
 */
@Data
@ConfigurationProperties(prefix = "storage")
public class StorageProperties {

    /** Top-level folder in the bucket that holds everything camtech stores. */
    private String rootFolder = "camtech";

    /** "oci" (default, every server) or "local" (a folder on a developer machine). */
    private String type = "oci";
    /** Folder used when type is "local". */
    private String localFolder = "target/local-storage";

    private Bucket bucket = new Bucket();
    private String host;
    private String accessKey;
    private String secretKey;
    private String region;

    @Data
    public static class Bucket {
        private String name;
    }
}
