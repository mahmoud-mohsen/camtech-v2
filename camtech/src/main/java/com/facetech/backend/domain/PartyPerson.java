package com.facetech.backend.domain;

import jakarta.persistence.Entity;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Entity
@Getter
@Setter
public class PartyPerson extends BaseEntity {

    private Long partyId;

    private String fullNameEn;

    private String fullNameAr;

    private LocalDate dateOfBirth;

    private String gender;

    private String nationality;
}
