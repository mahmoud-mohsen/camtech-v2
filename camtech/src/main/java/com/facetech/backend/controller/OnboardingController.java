package com.facetech.backend.controller;

import com.facetech.backend.dto.EmiratesIdOcrDtos;
import com.facetech.backend.dto.FaceDtos;
import com.facetech.backend.dto.OnboardingSessionDtos;
import com.facetech.backend.dto.PassportDtos;
import com.facetech.backend.service.FaceService;
import com.facetech.backend.service.OnboardingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Legacy onboarding: start a session, register face poses, attach the
 * Emirates ID and passport read by the app. Requests and responses are
 * unchanged; the data now lives in party / identity_document / face_template.
 */
@Slf4j
@RestController
@RequestMapping("/onboarding")
public class OnboardingController {

    private final FaceService faceService;
    private final OnboardingService onboardingService;
    private final ObjectMapper objectMapper;

    public OnboardingController(FaceService faceService, OnboardingService onboardingService, ObjectMapper objectMapper) {
        this.faceService = faceService;
        this.onboardingService = onboardingService;
        this.objectMapper = objectMapper;
    }

    /** Start onboarding session (sequence-agnostic). Returns session_id and user_id. */
    @PostMapping("/session")
    public ResponseEntity<?> startOnboardingSession(
            @RequestBody(required = false) OnboardingSessionDtos.CreateSessionRequest request) {
        OnboardingService.Session session = onboardingService.createSession(request != null ? request.getName() : null);
        Map<String, Object> response = new HashMap<>();
        response.put("session_id", session.sessionKey());
        response.put("user_id", session.userId());
        response.put("status", session.status());
        return ResponseEntity.ok(response);
    }

    /** Register a face from an image; the embedding is generated server-side. */
    @PostMapping("/face/register")
    public ResponseEntity<?> registerFaceWithImage(@RequestParam("data") String dataJson,
                                                   @RequestParam("image") MultipartFile imageFile) {
        log.debug("Onboarding face register upload: image bytes={}", size(imageFile));
        try {
            FaceDtos.FaceRegisterRequest request = objectMapper.readValue(dataJson, FaceDtos.FaceRegisterRequest.class);
            if (request.getSessionId() != null && request.getUserId() == null) {
                request.setUserId(onboardingService.userIdBySessionKey(request.getSessionId()));
            }
            FaceService.Registered r = faceService.registerFace(request, imageFile.getBytes(), imageFile.getOriginalFilename());
            Map<String, Object> response = new HashMap<>();
            response.put("user_id", r.party().getId());
            response.put("embedding_id", r.template().getId());
            response.put("image_id", r.media().getId());
            response.put("image_path", r.media().getStorageUri());
            response.put("pose", request.getPose());
            return ResponseEntity.ok(response);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Failed to process request: " + e.getMessage(), e);
        }
    }

    @PostMapping("/{userId}/emirates-id")
    public ResponseEntity<?> attachEmiratesIdWithImages(
            @PathVariable("userId") Long userId,
            @RequestParam("data") String dataJson,
            @RequestParam("front_image") MultipartFile frontImage,
            @RequestParam(value = "back_image", required = false) MultipartFile backImage,
            @RequestParam(value = "face_image", required = false) MultipartFile faceImage,
            @RequestParam(value = "signature_image", required = false) MultipartFile signatureImage) {
        return emiratesId(userId, dataJson, frontImage, backImage, faceImage, signatureImage);
    }

    @PostMapping("/session/{sessionId}/emirates-id")
    public ResponseEntity<?> attachEmiratesIdWithImagesBySession(
            @PathVariable("sessionId") String sessionId,
            @RequestParam("data") String dataJson,
            @RequestParam("front_image") MultipartFile frontImage,
            @RequestParam(value = "back_image", required = false) MultipartFile backImage,
            @RequestParam(value = "face_image", required = false) MultipartFile faceImage,
            @RequestParam(value = "signature_image", required = false) MultipartFile signatureImage) {
        return emiratesId(onboardingService.userIdBySessionKey(sessionId), dataJson, frontImage, backImage, faceImage,
                signatureImage);
    }

    @PostMapping("/{userId}/passport")
    public ResponseEntity<?> attachPassportWithImage(@PathVariable("userId") Long userId,
                                                     @RequestParam("data") String dataJson,
                                                     @RequestParam("image") MultipartFile passportImage) {
        return passport(userId, dataJson, passportImage);
    }

    @PostMapping("/session/{sessionId}/passport")
    public ResponseEntity<?> attachPassportWithImageBySession(@PathVariable("sessionId") String sessionId,
                                                              @RequestParam("data") String dataJson,
                                                              @RequestParam("image") MultipartFile passportImage) {
        return passport(onboardingService.userIdBySessionKey(sessionId), dataJson, passportImage);
    }

    private ResponseEntity<?> emiratesId(Long userId, String dataJson, MultipartFile front, MultipartFile back,
                                         MultipartFile face, MultipartFile signature) {
        log.debug("Onboarding Emirates ID upload for partyId={}: front={} back={} face={} signature={} bytes",
                userId, size(front), size(back), size(face), size(signature));
        try {
            EmiratesIdOcrDtos.EmiratesIdOcrResponse data =
                    objectMapper.readValue(dataJson, EmiratesIdOcrDtos.EmiratesIdOcrResponse.class);
            return ResponseEntity.ok(onboardingService.attachEmiratesId(userId, data, front, back, face, signature));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Failed to process request: " + e.getMessage(), e);
        }
    }

    private ResponseEntity<?> passport(Long userId, String dataJson, MultipartFile image) {
        log.debug("Onboarding passport upload for partyId={}: image bytes={}", userId, size(image));
        try {
            PassportDtos.PassportMrzRequest data = objectMapper.readValue(dataJson, PassportDtos.PassportMrzRequest.class);
            return ResponseEntity.ok(onboardingService.attachPassport(userId, data, image));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Failed to process request: " + e.getMessage(), e);
        }
    }

    private static long size(MultipartFile file) {
        return file == null ? 0 : file.getSize();
    }
}
