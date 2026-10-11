package com.facetech.backend.platform.storage;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Path;

/**
 * Images are kept in OCI Object Storage, never on the pod's disk. {@code storage.type=local}
 * keeps them in a folder instead, for running camtech on a developer machine.
 */
@Configuration
@EnableConfigurationProperties(StorageProperties.class)
public class StorageConfiguration {

    @Bean
    public ObjectStore objectStore(StorageProperties props) {
        if ("local".equalsIgnoreCase(props.getType())) {
            return new LocalFolderObjectStore(Path.of(props.getLocalFolder()));
        }
        return new OciObjectStore(props);
    }
}
