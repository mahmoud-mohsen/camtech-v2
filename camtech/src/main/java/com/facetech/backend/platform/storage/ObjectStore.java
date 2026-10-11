package com.facetech.backend.platform.storage;

/** Stores and reads objects by key (a path relative to the bucket). */
public interface ObjectStore {

    /** @return the URI saved in media_file.storage_uri, e.g. {@code oci://noqodi-dev01/camtech/...} */
    String put(String key, byte[] bytes, String contentType);

    byte[] get(String uri);

    void delete(String uri);
}
