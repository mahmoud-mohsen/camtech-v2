package com.facetech.backend.repository;

import com.facetech.backend.domain.Device;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DeviceRepository extends JpaRepository<Device, Long> {

    Optional<Device> findByClientAppIdAndDeviceRef(Long clientAppId, String deviceRef);
}
