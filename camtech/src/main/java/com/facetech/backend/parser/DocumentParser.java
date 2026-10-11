package com.facetech.backend.parser;

import com.facetech.backend.dto.DocumentFieldsDto;
import com.facetech.backend.model.DocumentType;
import com.facetech.backend.ocr.dto.OcrResult;

public interface DocumentParser {

    DocumentFieldsDto parse(String ocrText);

    /** Parses with the OCR layout when the parser uses it; by default only the text is read. */
    default DocumentFieldsDto parse(OcrResult ocr) {
        return parse(ocr.getFullText());
    }

    DocumentType getSupportedDocumentType();

    boolean canParse(String ocrText);
}
