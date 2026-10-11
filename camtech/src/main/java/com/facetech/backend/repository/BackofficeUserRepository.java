package com.facetech.backend.repository;

import com.facetech.backend.domain.BackofficeUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BackofficeUserRepository extends JpaRepository<BackofficeUser, Long> {

    Optional<BackofficeUser> findByUsernameIgnoreCase(String username);

    List<BackofficeUser> findAllByOrderByUsernameAsc();
}
