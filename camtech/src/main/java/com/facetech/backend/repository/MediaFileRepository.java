package com.facetech.backend.repository;

import com.facetech.backend.domain.MediaFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface MediaFileRepository extends JpaRepository<MediaFile, Long> {

    List<MediaFile> findTop500ByPurgeAfterBeforeAndPurgedAtIsNull(Instant before);

    List<MediaFile> findByIdIn(Collection<Long> ids);
}
