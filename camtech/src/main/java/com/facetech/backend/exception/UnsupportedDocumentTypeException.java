package com.facetech.backend.exception;

public class UnsupportedDocumentTypeException extends RuntimeException {
    public UnsupportedDocumentTypeException(String message) {
        super(message);
    }

    public UnsupportedDocumentTypeException(String message, Throwable cause) {
        super(message, cause);
    }
}
