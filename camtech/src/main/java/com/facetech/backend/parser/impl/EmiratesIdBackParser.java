package com.facetech.backend.parser.impl;

import com.facetech.backend.model.DocumentType;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import org.springframework.stereotype.Component;

@Component
public class EmiratesIdBackParser extends EmiratesIdParser {

    public EmiratesIdBackParser(ArabicTextProcessor arabicTextProcessor) {
        super(arabicTextProcessor);
    }

    @Override
    protected EmiratesIdResolver.Side side() {
        return EmiratesIdResolver.Side.BACK;
    }

    @Override
    public DocumentType getSupportedDocumentType() {
        return DocumentType.EMIRATES_ID_BACK;
    }

    @Override
    public boolean canParse(String ocrText) {
        return looksLikeBackSide(ocrText);
    }
}
