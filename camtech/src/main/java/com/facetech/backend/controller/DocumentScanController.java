package com.facetech.backend.controller;

import com.facetech.backend.dto.response.DocumentScanResponse;
import com.facetech.backend.model.DocumentType;
import com.facetech.backend.model.TradeLicenceFormat;
import com.facetech.backend.service.DocumentScanService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import com.facetech.backend.platform.RequestContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping({"/api/v1/documents", "/v2/documents"})
@RequiredArgsConstructor
@Slf4j
public class DocumentScanController {

    private final DocumentScanService documentScanService;

    @PostMapping(value = "/scan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DocumentScanResponse> scanDocument(
            @RequestParam("image") MultipartFile image,
            @RequestParam("documentType") DocumentType documentType,
            @RequestParam(value = "format", required = false) TradeLicenceFormat format,
            @RequestParam(value = "userId", required = false) String userId,
            HttpServletRequest request) {

        log.debug("Received document scan request: documentType={}, format={}, userId={}, fileSize={}, contentType={}",
                documentType, format, userId, image.getSize(), image.getContentType());

        if (image.isEmpty()) {
            log.warn("Document scan rejected: empty image (documentType={})", documentType);
            return ResponseEntity.badRequest().body(
                    DocumentScanResponse.builder()
                            .success(false)
                            .message("Image file is required")
                            .build()
            );
        }

        DocumentScanResponse response = documentScanService.scanDocument(
                image, documentType, format, RequestContext.get().subjectRefFor(userId), request);

        return ResponseEntity.ok(response);
    }

    @PostMapping(value = "/scan-only", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DocumentScanResponse> scanDocumentOnly(
            @RequestParam("image") MultipartFile image,
            @RequestParam("documentType") DocumentType documentType,
            @RequestParam(value = "format", required = false) TradeLicenceFormat format) {

        log.debug("Received document scan-only request (no DB save): documentType={}, format={}, fileSize={}, contentType={}",
                documentType, format, image.getSize(), image.getContentType());

        if (image.isEmpty()) {
            log.warn("Document scan-only rejected: empty image (documentType={})", documentType);
            return ResponseEntity.badRequest().body(
                    DocumentScanResponse.builder()
                            .success(false)
                            .message("Image file is required")
                            .build()
            );
        }

        DocumentScanResponse response = documentScanService.scanDocumentOnly(image, documentType, format);

        return ResponseEntity.ok(response);
    }

    @GetMapping("/scan/{scanId}")
    public ResponseEntity<Map<String, Object>> getScanRecord(@PathVariable String scanId) {
        log.debug("Retrieving scan record: scanId={}", scanId);

        return ResponseEntity.ok(documentScanService.getScanRecord(scanId));
    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<Map<String, Object>> getUserScans(@PathVariable String userId) {
        log.debug("Retrieving scans for user: userId={}", userId);

        List<Map<String, Object>> records = documentScanService.getUserScans(userId);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("count", records.size());
        response.put("scans", records);

        return ResponseEntity.ok(response);
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", "UP");
        response.put("service", "OCR Document Scanning Service");
        response.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/supported-types")
    public ResponseEntity<Map<String, Object>> getSupportedTypes() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("supportedTypes", List.of(
                DocumentType.EMIRATES_ID_FRONT,
                DocumentType.EMIRATES_ID_BACK,
                DocumentType.PASSPORT,
                DocumentType.TRADE_LICENCE
        ));
        response.put("tradeLicenceFormats", List.of(
                TradeLicenceFormat.DET,
                TradeLicenceFormat.SHARJAH_DED,
                TradeLicenceFormat.JAFZA,
                TradeLicenceFormat.ABU_DHABI_DED,
                TradeLicenceFormat.AJMAN_DED,
                TradeLicenceFormat.AJMAN_FZA,
                TradeLicenceFormat.AJMAN_ANCFZ,
                TradeLicenceFormat.RAS_AL_KHAIMAH_DED,
                TradeLicenceFormat.RAS_AL_KHAIMAH_ECONOMIC_ZONE_RAKEZ,
                TradeLicenceFormat.UMM_AL_QUWAIN_DED,
                TradeLicenceFormat.UMM_AL_QUWAIN_FREE_ZONE,
                TradeLicenceFormat.FUJAIRAH_DED,
                TradeLicenceFormat.FUJAIRAH_DIBBA_DED,
                TradeLicenceFormat.FUJAIRAH_MEDIA_ZONE_CREATIVE_CITY,
                TradeLicenceFormat.SHARJAH_AIRPORT_INTERNATIONAL_FREE_ZONE,
                TradeLicenceFormat.SHARJAH_MEDIA_CITY_FREE_ZONE,
                TradeLicenceFormat.SHARJAH_PUBLISHING_CITY,
                TradeLicenceFormat.SHARJAH_RESEARCH_TECHNOLOGY_AND_INNOVATION_PARK
        ));
        return ResponseEntity.ok(response);
    }
}
