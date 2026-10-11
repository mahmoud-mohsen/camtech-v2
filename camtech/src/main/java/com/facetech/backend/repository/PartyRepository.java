package com.facetech.backend.repository;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.Party;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface PartyRepository extends JpaRepository<Party, Long> {

    Optional<Party> findByPublicId(String publicId);

    Optional<Party> findFirstByTenantIdAndExternalRefOrderByIdAsc(Long tenantId, String externalRef);

    @Query("select p from Party p where p.tenantId = :tenantId"
            + " and (:partyType is null or p.partyType = :partyType)"
            + " and (:q is null or lower(p.externalRef) like :q escape '\\' or p.publicId like :q escape '\\'"
            + "   or exists (select 1 from PartyPerson pp where pp.partyId = p.id and (lower(pp.fullNameEn) like :q escape '\\' or pp.fullNameAr like :q escape '\\'))"
            + "   or exists (select 1 from PartyOrganization po where po.partyId = p.id and lower(po.legalNameEn) like :q escape '\\')"
            + "   or exists (select 1 from IdentityDocument d where d.partyId = p.id and lower(d.documentNumber) like :q escape '\\'))")
    Page<Party> search(@Param("tenantId") Long tenantId, @Param("partyType") Codes.PartyType partyType, @Param("q") String q, Pageable pageable);
}
