package com.facetech.backend.exception;

import com.facetech.backend.dto.response.ValidationErrorResponse;
import com.facetech.backend.platform.ReasonCatalog;
import com.facetech.backend.platform.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Error bodies. /v2 endpoints always answer
 * {@code {"code", "message", ...extra}} with the message in the caller's
 * language (Accept-Language: ar). Legacy endpoints keep their old shapes
 * ({@code {"code", "detail"}} or ValidationErrorResponse).
 */
@ControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    private final ReasonCatalog reasons;

    public GlobalExceptionHandler(ReasonCatalog reasons) {
        this.reasons = reasons;
    }

    @ExceptionHandler(FaceMatchException.class)
    public ResponseEntity<Map<String, Object>> handleFaceMatch(FaceMatchException ex, HttpServletRequest request) {
        if (ex.getStatus().is5xxServerError()) {
            log.error("{} {}: {}", ex.getCode(), request.getRequestURI(), ex.getMessage(), ex.getCause());
        } else {
            log.warn("Rejected {} {}: {} {} - {}", request.getMethod(), request.getRequestURI(), ex.getStatus().value(),
                    ex.getCode(), ex.getMessage());
        }
        if (isV2(request)) {
            return v2(ex.getStatus(), ex.getCode(), ex.getMessage(), ex.getExtra());
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", ex.getCode());
        body.put("detail", ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(body);
    }

    @ExceptionHandler(InvalidDocumentException.class)
    public ResponseEntity<?> handleInvalidDocument(InvalidDocumentException ex, HttpServletRequest request, WebRequest web) {
        log.warn("Invalid document on {}: {}", request.getRequestURI(), ex.getMessage());
        if (isV2(request)) {
            return v2(HttpStatus.BAD_REQUEST, "INVALID_DOCUMENT", ex.getMessage(), null);
        }
        return legacy(HttpStatus.BAD_REQUEST, "Invalid document", ex.getMessage(), web);
    }

    @ExceptionHandler(OcrProcessingException.class)
    public ResponseEntity<?> handleOcrProcessing(OcrProcessingException ex, HttpServletRequest request, WebRequest web) {
        log.error("OCR processing failed on {}: {}", request.getRequestURI(), ex.getMessage(), ex);
        if (isV2(request)) {
            return v2(HttpStatus.INTERNAL_SERVER_ERROR, "OCR_FAILED", ex.getMessage(), null);
        }
        return legacy(HttpStatus.INTERNAL_SERVER_ERROR, "OCR processing failed", ex.getMessage(), web);
    }

    @ExceptionHandler(UnsupportedDocumentTypeException.class)
    public ResponseEntity<?> handleUnsupportedDocumentType(UnsupportedDocumentTypeException ex, HttpServletRequest request,
                                                           WebRequest web) {
        log.warn("Unsupported document type on {}: {}", request.getRequestURI(), ex.getMessage());
        if (isV2(request)) {
            return v2(HttpStatus.BAD_REQUEST, "BAD_DOCUMENT_TYPE", ex.getMessage(), null);
        }
        return legacy(HttpStatus.BAD_REQUEST, "Unsupported document type", ex.getMessage(), web);
    }

    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<Map<String, Object>> handleBadRequest(RuntimeException ex, HttpServletRequest request) {
        log.warn("Bad request {} {}: {}", request.getMethod(), request.getRequestURI(), ex.getMessage());
        if (isV2(request)) {
            return v2(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", ex.getMessage(), null);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("detail", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingServletRequestPartException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> handleMissingInput(Exception ex, HttpServletRequest request) {
        log.warn("Invalid input {} {}: {}", request.getMethod(), request.getRequestURI(), ex.getMessage());
        if (isV2(request)) {
            return v2(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", ex.getMessage(), null);
        }
        return ResponseEntity.badRequest().body(Map.of("detail", String.valueOf(ex.getMessage())));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleTooLarge(MaxUploadSizeExceededException ex, HttpServletRequest request) {
        log.warn("Upload too large on {}: {}", request.getRequestURI(), ex.getMessage());
        return v2(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", "The uploaded file is too large (max 10 MB).", null);
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<Map<String, Object>> handleConcurrentUpdate(ObjectOptimisticLockingFailureException ex) {
        log.warn("Concurrent update: {}", ex.getMessage());
        return v2(HttpStatus.CONFLICT, "CONCURRENT_UPDATE", "The record was changed by someone else. Reload and try again.", null);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException ex, HttpServletRequest request) {
        log.warn("{} {} answered {}: {}", request.getMethod(), request.getRequestURI(), ex.getStatusCode().value(),
                ex.getReason());
        if (isV2(request)) {
            return v2(HttpStatus.valueOf(ex.getStatusCode().value()), "ERROR", ex.getReason(), null);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("detail", ex.getReason());
        return ResponseEntity.status(ex.getStatusCode()).body(body);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(NoResourceFoundException ex) {
        return v2(HttpStatus.NOT_FOUND, "NOT_FOUND", "No endpoint " + ex.getResourcePath(), null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGeneric(Exception ex, HttpServletRequest request, WebRequest web) {
        log.error("Unexpected exception on {} {}: {}", request.getMethod(), request.getRequestURI(), ex.getMessage(), ex);
        if (isV2(request)) {
            return v2(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Something went wrong. Please try again.", null);
        }
        return legacy(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error", "An unexpected error occurred", web);
    }

    private ResponseEntity<Map<String, Object>> v2(HttpStatus status, String code, String fallback, Map<String, Object> extra) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        String localized = reasons.message(code, RequestContext.get().getLang());
        body.put("message", localized != null ? localized : fallback);
        if (extra != null) {
            body.putAll(extra);
        }
        return ResponseEntity.status(status).body(body);
    }

    private static ResponseEntity<ValidationErrorResponse> legacy(HttpStatus status, String message, String error, WebRequest web) {
        return ResponseEntity.status(status).body(ValidationErrorResponse.builder()
                .success(false)
                .message(message)
                .errors(List.of(error))
                .timestamp(LocalDateTime.now())
                .path(web.getDescription(false).replace("uri=", ""))
                .build());
    }

    private static boolean isV2(HttpServletRequest request) {
        return request.getRequestURI().startsWith(request.getContextPath() + "/v2/");
    }
}
