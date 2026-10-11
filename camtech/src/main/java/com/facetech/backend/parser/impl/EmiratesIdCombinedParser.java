package com.facetech.backend.parser.impl;

import com.facetech.backend.model.DocumentType;
import com.facetech.backend.parser.util.ArabicTextProcessor;
import org.springframework.stereotype.Component;

@Component
public class EmiratesIdCombinedParser extends EmiratesIdParser {

    public EmiratesIdCombinedParser(ArabicTextProcessor arabicTextProcessor) {
        super(arabicTextProcessor);
    }

    @Override
    protected EmiratesIdResolver.Side side() {
        return EmiratesIdResolver.Side.COMBINED;
    }

    @Override
    public DocumentType getSupportedDocumentType() {
        return DocumentType.EMIRATES_ID;
    }

    @Override
    public boolean canParse(String ocrText) {
        return looksLikeFrontSide(ocrText) || looksLikeBackSide(ocrText);
    }
}
