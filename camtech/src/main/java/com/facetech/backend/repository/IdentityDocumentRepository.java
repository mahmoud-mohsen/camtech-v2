package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.IdentityDocument;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface IdentityDocumentRepository extends JpaRepository<IdentityDocument, Long> {

    Optional<IdentityDocument> findByPublicId(String publicId);

    Optional<IdentityDocument> findByTenantIdAndDocTypeIdAndIssuingCountryAndDocumentNumber(Long tenantId, Long docTypeId, String issuingCountry, String documentNumber);

    Optional<IdentityDocument> findByTenantIdAndDocTypeIdAndIssuingCountryIsNullAndDocumentNumber(Long tenantId, Long docTypeId, String documentNumber);

    List<IdentityDocument> findByTenantIdAndDocumentNumber(Long tenantId, String documentNumber);

    List<IdentityDocument> findByPartyIdOrderByCreatedAtDesc(Long partyId);

    List<IdentityDocument> findByPartyIdInOrderByCreatedAtDesc(Collection<Long> partyIds);

    List<IdentityDocument> findByIdIn(Collection<Long> ids);

    @Query("select d from IdentityDocument d where d.tenantId = :tenantId"
            + " and (:docTypeId is null or d.docTypeId = :docTypeId)"
            + " and (:status is null or d.status = :status)"
            + " and (:expiringBefore is null or d.expiryDate < :expiringBefore)"
            + " and (:q is null or lower(d.documentNumber) like :q escape '\\'"
            + "   or exists (select 1 from PartyPerson pp where pp.partyId = d.partyId and lower(pp.fullNameEn) like :q escape '\\'))")
    Page<IdentityDocument> search(@Param("tenantId") Long tenantId, @Param("docTypeId") Long docTypeId, @Param("status") Codes.DocumentStatus status,
                                  @Param("expiringBefore") LocalDate expiringBefore, @Param("q") String q, Pageable pageable);

    /** Documents of a tenant expiring between the dates (inclusive) whose expiry event was not sent yet. */
    @Query("select d from IdentityDocument d where d.tenantId = :tenantId and d.expiryNotifiedAt is null"
            + " and d.expiryDate >= :from and d.expiryDate <= :to")
    List<IdentityDocument> findExpiringNotNotified(@Param("tenantId") Long tenantId, @Param("from") LocalDate from,
                                                   @Param("to") LocalDate to);

    @Query("select count(d) from IdentityDocument d where d.tenantId = :tenantId"
            + " and d.expiryDate >= :from and d.expiryDate <= :to")
    long countExpiring(@Param("tenantId") Long tenantId, @Param("from") LocalDate from, @Param("to") LocalDate to);
}
