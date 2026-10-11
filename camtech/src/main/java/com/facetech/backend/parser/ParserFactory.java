package com.facetech.backend.parser;

import com.facetech.backend.model.DocumentType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
@Slf4j
public class ParserFactory {

    private final List<DocumentParser> parsers;

    public DocumentParser getParser(DocumentType documentType) {
        DocumentParser selected = parsers.stream()
                .filter(parser -> parser.getSupportedDocumentType() == documentType)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No parser found for document type: " + documentType));
        log.debug("Selected parser {} for requested document type {}", selected.getClass().getSimpleName(), documentType);
        return selected;
    }

    public DocumentParser detectParser(String ocrText) {
        DocumentParser detected = parsers.stream()
                .filter(parser -> parser.canParse(ocrText))
                .findFirst()
                .orElse(null);
        if (detected != null) {
            log.debug("Auto-detected parser {} (document type {}) from OCR text of length {} among {} parsers",
                    detected.getClass().getSimpleName(), detected.getSupportedDocumentType(),
                    ocrText != null ? ocrText.length() : 0, parsers.size());
        } else {
            log.debug("No parser recognised the OCR text (length {}) among {} parsers",
                    ocrText != null ? ocrText.length() : 0, parsers.size());
        }
        return detected;
    }
}
