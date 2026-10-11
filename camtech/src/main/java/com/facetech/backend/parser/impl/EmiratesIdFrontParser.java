package com.facetech.backend.parser.impl;

import com.facetech.backend.model.DocumentType;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import org.springframework.stereotype.Component;

@Component
public class EmiratesIdFrontParser extends EmiratesIdParser {

    public EmiratesIdFrontParser(ArabicTextProcessor arabicTextProcessor) {
        super(arabicTextProcessor);
    }

    @Override
    protected EmiratesIdResolver.Side side() {
        return EmiratesIdResolver.Side.FRONT;
    }

    @Override
    public DocumentType getSupportedDocumentType() {
        return DocumentType.EMIRATES_ID_FRONT;
    }

    @Override
    public boolean canParse(String ocrText) {
        return looksLikeFrontSide(ocrText);
    }
}
