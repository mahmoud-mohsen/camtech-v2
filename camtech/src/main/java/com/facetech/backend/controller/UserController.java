package com.facetech.backend.controller;

import com.facetech.backend.domain.Codes;
import com.facetech.backend.domain.DocumentField;
import com.facetech.backend.domain.DocumentMedia;
import com.facetech.backend.domain.FaceTemplate;
import com.facetech.backend.domain.IdentityDocument;
import com.facetech.backend.domain.MediaFile;
import com.facetech.backend.domain.Party;
import com.facetech.backend.domain.RefDocumentType;
import com.facetech.backend.platform.MediaStorageService;
import com.facetech.backend.platform.RequestContext;
import com.facetech.backend.repository.DocumentFieldRepository;
import com.facetech.backend.repository.DocumentMediaRepository;
import com.facetech.backend.repository.FaceTemplateRepository;
import com.facetech.backend.repository.IdentityDocumentRepository;
import com.facetech.backend.repository.MediaFileRepository;
import com.facetech.backend.repository.PartyRepository;
import com.facetech.backend.repository.RefDocumentTypeRepository;
import com.facetech.backend.verification.ErasureService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Legacy user endpoints, served from the person (party) model. A "user" is
 * a person; "name" / "username" is the app's own reference for them.
 * The back-office uses /v2/admin/parties instead.
 */
@Slf4j
@RestController
@RequestMapping("/user")
public class UserController {

    private final PartyRepository partyRepository;
    private final IdentityDocumentRepository documentRepository;
    private final DocumentFieldRepository fieldRepository;
    private final DocumentMediaRepository documentMediaRepository;
    private final FaceTemplateRepository templateRepository;
    private final MediaFileRepository mediaRepository;
    private final RefDocumentTypeRepository docTypeRepository;
    private final MediaStorageService media;
    private final ErasureService erasure;

    public UserController(PartyRepository partyRepository, IdentityDocumentRepository documentRepository,
                          DocumentFieldRepository fieldRepository, DocumentMediaRepository documentMediaRepository,
                          FaceTemplateRepository templateRepository, MediaFileRepository mediaRepository,
                          RefDocumentTypeRepository docTypeRepository, MediaStorageService media,
                          ErasureService erasure) {
        this.partyRepository = partyRepository;
        this.documentRepository = documentRepository;
        this.fieldRepository = fieldRepository;
        this.documentMediaRepository = documentMediaRepository;
        this.templateRepository = templateRepository;
        this.mediaRepository = mediaRepository;
        this.docTypeRepository = docTypeRepository;
        this.media = media;
        this.erasure = erasure;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<List<Map<String, Object>>> listUsers() {
        List<Party> people = partyRepository.search(RequestContext.get().getTenantId(), Codes.PartyType.PERSON, null,
                PageRequest.of(0, 1000, Sort.by(Sort.Direction.DESC, "createdAt"))).getContent();
        // All documents of the page in one query (newest first), instead of two queries per person.
        Long eidType = docTypeRepository.findByCode("EMIRATES_ID").map(RefDocumentType::getId).orElse(-1L);
        Long passportType = docTypeRepository.findByCode("PASSPORT").map(RefDocumentType::getId).orElse(-1L);
        Map<Long, String> eid = new HashMap<>();
        Map<Long, String> passport = new HashMap<>();
        if (!people.isEmpty()) {
            for (IdentityDocument d : documentRepository.findByPartyIdInOrderByCreatedAtDesc(
                    people.stream().map(Party::getId).toList())) {
                if (d.getDocTypeId().equals(eidType)) {
                    eid.putIfAbsent(d.getPartyId(), d.getDocumentNumber());
                } else if (d.getDocTypeId().equals(passportType)) {
                    passport.putIfAbsent(d.getPartyId(), d.getDocumentNumber());
                }
            }
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Party p : people) {
            Map<String, Object> row = new HashMap<>();
            row.put("id", p.getId());
            row.put("name", p.getExternalRef());
            row.put("username", p.getExternalRef());
            row.put("created_at", p.getCreatedAt());
            row.put("emirates_id_number", eid.get(p.getId()));
            row.put("passport_number", passport.get(p.getId()));
            result.add(row);
        }
        return ResponseEntity.ok(result);
    }

    @GetMapping("/image/{imageId}")
    @Transactional(readOnly = true)
    public ResponseEntity<byte[]> getUserImage(@PathVariable("imageId") Long imageId) {
        MediaFile m = mediaRepository.findById(imageId)
                .filter(x -> x.getTenantId().equals(RequestContext.get().getTenantId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found"));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(m.getMimeType()))
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                .header("Cross-Origin-Resource-Policy", "cross-origin")
                .body(media.read(m));
    }

    @GetMapping("/{userId}")
    @Transactional(readOnly = true)
    public ResponseEntity<?> getUserProfile(@PathVariable("userId") Long userId) {
        Party p = partyRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "User not found"));
        Map<String, Object> body = new HashMap<>();
        body.put("user_id", p.getId());
        body.put("name", p.getExternalRef());
        body.put("username", p.getExternalRef());
        body.put("created_at", p.getCreatedAt());
        body.put("updated_at", p.getUpdatedAt());
        body.put("emirates_id", latest(p, "EMIRATES_ID").map(d -> emiratesIdBody(d)).orElse(null));
        body.put("passport", latest(p, "PASSPORT").map(d -> passportBody(d)).orElse(null));

        Map<Long, String> imageTypes = new HashMap<>();
        for (IdentityDocument d : documentRepository.findByPartyIdOrderByCreatedAtDesc(p.getId())) {
            String type = docTypeRepository.findById(d.getDocTypeId()).map(RefDocumentType::getCode).orElse("document");
            for (DocumentMedia dm : documentMediaRepository.findByDocumentIdOrderByIdAsc(d.getId())) {
                imageTypes.put(dm.getMediaId(), legacyImageType(type, dm.getRole()));
            }
        }
        for (FaceTemplate t : templateRepository.findByPartyIdOrderByCreatedAtDesc(p.getId())) {
            if (t.getSourceMediaId() != null && t.getRole() == Codes.TemplateRole.SELFIE) {
                imageTypes.putIfAbsent(t.getSourceMediaId(), "face_pose_" + (t.getPose() != null ? t.getPose() : "front"));
            }
        }
        List<Map<String, Object>> images = new ArrayList<>();
        for (MediaFile m : mediaRepository.findByIdIn(imageTypes.keySet())) {
            if (m.getPurgedAt() != null) {
                continue;
            }
            String type = imageTypes.get(m.getId());
            Map<String, Object> img = new HashMap<>();
            img.put("id", m.getId());
            img.put("image_type", type);
            img.put("title", formatImageTitle(type));
            img.put("url", "/user/image/" + m.getId());
            img.put("content_type", m.getMimeType());
            img.put("created_at", m.getCreatedAt());
            images.add(img);
        }
        body.put("images", images);
        return ResponseEntity.ok(body);
    }

    @DeleteMapping("/{userId}")
    public ResponseEntity<Map<String, Object>> deleteUser(@PathVariable("userId") Long userId) {
        log.info("Legacy user erasure requested: partyId={} tenantId={} app={}", userId,
                RequestContext.get().getTenantId(), RequestContext.get().clientAppCode());
        try {
            erasure.erase(userId);
        } catch (com.facetech.backend.exception.FaceMatchException e) {
            log.warn("Legacy user erasure failed for partyId={}: {} (answered 404)", userId, e.getMessage());
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found", e);
        }
        log.info("Legacy user erased: partyId={}", userId);
        Map<String, Object> body = new HashMap<>();
        body.put("success", true);
        body.put("message", "User and all attached data deleted");
        body.put("user_id", userId);
        return ResponseEntity.ok(body);
    }

    private Optional<IdentityDocument> latest(Party p, String typeCode) {
        Long typeId = docTypeRepository.findByCode(typeCode).map(RefDocumentType::getId).orElse(-1L);
        return documentRepository.findByPartyIdOrderByCreatedAtDesc(p.getId()).stream()
                .filter(d -> d.getDocTypeId().equals(typeId)).findFirst();
    }

    private Map<String, String> fields(IdentityDocument d) {
        Map<String, String> out = new HashMap<>();
        for (DocumentField f : fieldRepository.findByDocumentIdOrderByIdAsc(d.getId())) {
            String key = f.getFieldCode() + ("ar".equals(f.getLang()) ? "_AR" : "");
            out.put(key, f.getValueText() != null ? f.getValueText() : f.getValueDate() != null ? f.getValueDate().toString() : null);
        }
        return out;
    }

    private Map<String, Object> emiratesIdBody(IdentityDocument d) {
        Map<String, String> f = fields(d);
        Map<String, Object> b = new HashMap<>();
        b.put("id", d.getId());
        b.put("emiratesIdNumber", d.getDocumentNumber());
        b.put("uidNumber", f.get("UID_NUMBER"));
        b.put("fullNameEn", f.get("FULL_NAME"));
        b.put("fullNameAr", f.get("FULL_NAME_AR"));
        b.put("dateOfBirth", f.get("DATE_OF_BIRTH"));
        b.put("issueDate", d.getIssueDate() != null ? d.getIssueDate().toString() : null);
        b.put("expiryDate", d.getExpiryDate() != null ? d.getExpiryDate().toString() : null);
        b.put("gender", f.get("GENDER"));
        b.put("genderAr", f.get("GENDER_AR"));
        b.put("nationality", f.get("NATIONALITY"));
        b.put("nationalityAr", f.get("NATIONALITY_AR"));
        b.put("occupation", f.get("OCCUPATION"));
        b.put("occupationAr", f.get("OCCUPATION_AR"));
        b.put("employer", f.get("EMPLOYER"));
        b.put("employerAr", f.get("EMPLOYER_AR"));
        b.put("issuingPlace", f.get("ISSUING_PLACE"));
        b.put("issuingPlaceAr", f.get("ISSUING_PLACE_AR"));
        return b;
    }

    private Map<String, Object> passportBody(IdentityDocument d) {
        Map<String, String> f = fields(d);
        Map<String, Object> b = new HashMap<>();
        b.put("id", d.getId());
        b.put("passportNumber", d.getDocumentNumber());
        b.put("documentNumber", d.getDocumentNumber());
        b.put("issuingCountry", d.getIssuingCountry() != null ? d.getIssuingCountry() : f.get("ISSUING_COUNTRY"));
        b.put("documentType", "P");
        b.put("fullNameEn", f.get("FULL_NAME"));
        b.put("surname", f.get("SURNAME"));
        b.put("givenNames", f.get("GIVEN_NAMES"));
        b.put("dateOfBirth", f.get("DATE_OF_BIRTH"));
        b.put("expiryDate", d.getExpiryDate() != null ? d.getExpiryDate().toString() : null);
        b.put("nationality", f.get("NATIONALITY"));
        b.put("sex", f.get("GENDER"));
        return b;
    }

    private static String legacyImageType(String docType, String role) {
        if ("PASSPORT".equals(docType)) {
            return "passport";
        }
        return switch (role) {
            case "FRONT" -> "emirates_id_front";
            case "BACK" -> "emirates_id_back";
            case "FACE_PHOTO" -> "emirates_id_face";
            case "SIGNATURE" -> "emirates_id_signature";
            default -> docType.toLowerCase() + "_" + role.toLowerCase();
        };
    }

    private static final Set<String> KNOWN_POSES = new LinkedHashSet<>(List.of("front", "back", "left", "right", "up", "down"));

    private static String formatImageTitle(String imageType) {
        if (imageType == null || imageType.isBlank()) {
            return "Image";
        }
        if (imageType.startsWith("face_pose_")) {
            String pose = imageType.substring("face_pose_".length());
            return "Face Pose - " + (KNOWN_POSES.contains(pose) ? Character.toUpperCase(pose.charAt(0)) + pose.substring(1) : pose);
        }
        return switch (imageType) {
            case "emirates_id_front" -> "Emirates ID - Front";
            case "emirates_id_back" -> "Emirates ID - Back";
            case "emirates_id_face" -> "Emirates ID - Portrait";
            case "emirates_id_signature" -> "Emirates ID - Signature";
            case "passport" -> "Passport";
            default -> imageType.replace('_', ' ');
        };
    }
}
