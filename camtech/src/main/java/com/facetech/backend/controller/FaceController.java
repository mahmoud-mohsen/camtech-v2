package com.facetech.backend.controller;

import com.facetech.backend.dto.FaceDtos;
import com.facetech.backend.service.FaceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;

@Slf4j
@RestController
@RequestMapping("/")
public class FaceController {

    private final FaceService faceService;
    private final ObjectMapper objectMapper;

    public FaceController(FaceService faceService, ObjectMapper objectMapper) {
        this.faceService = faceService;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        return ResponseEntity.ok().body(new java.util.HashMap<String, Object>() {{
            put("status", "ok");
        }});
    }

    /**
     * Identify a person from a live image against all registrations.
     * The embedding is generated server-side from the uploaded image -
     * no embedding is accepted from the client.
     */
    @PostMapping("/face/identify")
    public ResponseEntity<FaceDtos.FaceIdentifyResponse> identify(
            @RequestParam("image") MultipartFile image) {
        byte[] imageBytes = readBytes(image);
        return ResponseEntity.ok(faceService.identifyFace(imageBytes, image.getOriginalFilename()));
    }

    /**
     * Verify a live image against a specific user (by Emirates ID or
     * username). The embedding is generated server-side from the uploaded
     * image - no embedding is accepted from the client.
     */
    @PostMapping("/face/verify")
    public ResponseEntity<FaceDtos.FaceVerifyResponse> verifyByIdentifier(
            @RequestParam("data") String dataJson,
            @RequestParam("image") MultipartFile image) {
        try {
            FaceDtos.FaceVerifyByIdentifierRequest request =
                    objectMapper.readValue(dataJson, FaceDtos.FaceVerifyByIdentifierRequest.class);
            byte[] imageBytes = readBytes(image);
            return ResponseEntity.ok(
                    faceService.verifyByEmiratesIdOrUsername(request, imageBytes, image.getOriginalFilename()));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Failed to process request: " + e.getMessage(), e);
        }
    }

    /**
     * Stateless pairwise comparison of two images (e.g. a live selfie and an
     * Emirates ID portrait) - no stored registration involved. Used by flows
     * like Face Tech that check two captures match each other.
     */
    @PostMapping("/face/compare")
    public ResponseEntity<FaceDtos.FaceCompareResponse> compare(
            @RequestParam("image_a") MultipartFile imageA,
            @RequestParam("image_b") MultipartFile imageB) {
        byte[] bytesA = readBytes(imageA);
        byte[] bytesB = readBytes(imageB);
        return ResponseEntity.ok(faceService.compareFaces(
                bytesA, imageA.getOriginalFilename(), bytesB, imageB.getOriginalFilename()));
    }

    private byte[] readBytes(MultipartFile file) {
        try {
            byte[] bytes = file.getBytes();
            log.debug("Upload received: field={} bytes={} contentType={}", file.getName(), bytes.length,
                    file.getContentType());
            return bytes;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Failed to read uploaded image: " + e.getMessage(), e);
        }
    }
}
