package com.facetech.backend.platform.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Writes the standard error body from servlet filters, where @ControllerAdvice does not apply. */
public final class ErrorWriter {

    private ErrorWriter() {
    }

    public static void write(HttpServletResponse response, ObjectMapper mapper, int status, String code, String message)
            throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("message", message);
        // Legacy clients read "detail".
        body.put("detail", message);
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        mapper.writeValue(response.getOutputStream(), body);
    }
}
