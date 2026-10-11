package com.facetech.backend.ocr.impl;

import com.facetech.backend.ocr.OcrProvider;
import com.facetech.backend.ocr.OcrService;
import com.facetech.backend.ocr.dto.OcrResult;
import com.google.api.gax.core.FixedCredentialsProvider;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.documentai.v1.*;
import com.google.protobuf.ByteString;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Service
@ConditionalOnProperty(name = "ocr.provider", havingValue = "google-documentai")
@Slf4j
public class GoogleDocumentAIService implements OcrService {

    @Value("${ocr.google.project-id}")
    private String projectId;

    @Value("${ocr.google.location}")
    private String location;

    @Value("${ocr.google.processor-id}")
    private String processorId;

    @Value("${ocr.google.credentials-path}")
    private String credentialsPath;

    /** Upper bound for one OCR call, retries included (the library's default is 120 s). */
    @Value("${ocr.google.timeout-seconds:20}")
    private int timeoutSeconds;

    /**
     * One client for the whole application: it keeps its gRPC connection and access token, so DNS lookup,
     * TLS handshake and token fetch happen once instead of on every scan. Created on first use.
     */
    private volatile DocumentProcessorServiceClient client;

    @PostConstruct
    void logConfiguration() {
        log.info("OCR provider configured: {} (location={}, available={})",
                getProvider().getProviderName(), location, isAvailable());
    }

    @PreDestroy
    void close() {
        DocumentProcessorServiceClient c = client;
        if (c != null) {
            c.close();
        }
    }

    private DocumentProcessorServiceClient client() throws IOException {
        DocumentProcessorServiceClient c = client;
        if (c == null) {
            synchronized (this) {
                c = client;
                if (c == null) {
                    c = createClient();
                    client = c;
                }
            }
        }
        return c;
    }

    private DocumentProcessorServiceClient createClient() throws IOException {
        GoogleCredentials credentials;
        try (FileInputStream credentialsStream = new FileInputStream(credentialsPath)) {
            credentials = GoogleCredentials.fromStream(credentialsStream);
        }
        DocumentProcessorServiceSettings.Builder settings = DocumentProcessorServiceSettings.newBuilder()
                .setCredentialsProvider(FixedCredentialsProvider.create(credentials));
        // Fail fast when Google cannot be reached (e.g. DNS errors are retried until the total timeout).
        Duration total = Duration.ofSeconds(timeoutSeconds);
        settings.processDocumentSettings().setRetrySettings(settings.processDocumentSettings().getRetrySettings().toBuilder()
                .setTotalTimeoutDuration(total)
                .setInitialRpcTimeoutDuration(total)
                .setMaxRpcTimeoutDuration(total)
                .build());
        log.info("{} client created (timeout={}s)", getProvider().getProviderName(), timeoutSeconds);
        return DocumentProcessorServiceClient.create(settings.build());
    }

    @Override
    public OcrResult processImage(byte[] imageData) {
        return processImage(imageData, "ar,en");
    }

    @Override
    public OcrResult processImage(byte[] imageData, String languageHint) {
        long startTime = System.currentTimeMillis();
        
        try {
            String name = String.format("projects/%s/locations/%s/processors/%s",
                    projectId, location, processorId);

            String mimeType = detectMimeType(imageData);
            log.debug("Calling {}: imageSizeBytes={}, mimeType={}, languageHint={}",
                    getProvider().getProviderName(), imageData.length, mimeType, languageHint);

            RawDocument rawDocument = RawDocument.newBuilder()
                    .setContent(ByteString.copyFrom(imageData))
                    .setMimeType(mimeType)
                    .build();

            ProcessRequest request = ProcessRequest.newBuilder()
                    .setName(name)
                    .setRawDocument(rawDocument)
                    .build();

            Document document = client().processDocument(request).getDocument();
            String text = document.getText();

            List<OcrResult.OcrBlock> blocks = new ArrayList<>();
            List<OcrResult.OcrLine> lines = new ArrayList<>();
            for (int p = 0; p < document.getPagesCount(); p++) {
                Document.Page page = document.getPages(p);
                for (Document.Page.Block block : page.getBlocksList()) {
                    blocks.add(OcrResult.OcrBlock.builder()
                            .text(getText(text, block.getLayout()))
                            .confidence(BigDecimal.valueOf(block.getLayout().getConfidence()))
                            .build());
                }
                for (Document.Page.Line line : page.getLinesList()) {
                    OcrResult.OcrLine l = toLine(text, line.getLayout(), page, p);
                    if (l != null) {
                        lines.add(l);
                    }
                }
            }

            long processingTime = System.currentTimeMillis() - startTime;

            OcrResult result = OcrResult.builder()
                    .fullText(text)
                    .confidence(calculateOverallConfidence(blocks))
                    .blocks(blocks)
                    .lines(lines)
                    .provider(getProvider().getProviderName())
                    .processingTimeMs(processingTime)
                    .build();

            log.debug("{} returned in {}ms: pages={}, blocks={}, lines={}, textLength={}, confidence={}",
                    getProvider().getProviderName(), processingTime, document.getPagesCount(), blocks.size(),
                    lines.size(), text.length(), result.getConfidence());
            return result;

        } catch (IOException e) {
            log.error("Error processing document with Google Document AI after {}ms: {}",
                    System.currentTimeMillis() - startTime, e.getMessage(), e);
            throw new RuntimeException("OCR processing failed", e);
        } catch (RuntimeException e) {
            log.error("Google Document AI call failed after {}ms (imageSizeBytes={}): {}",
                    System.currentTimeMillis() - startTime, imageData.length, e.toString());
            throw e;
        }
    }

    /** The layout's text: its anchor segments are offsets into the document text. */
    private static String getText(String text, Document.Page.Layout layout) {
        if (!layout.hasTextAnchor()) {
            return "";
        }
        StringBuilder b = new StringBuilder();
        for (Document.TextAnchor.TextSegment segment : layout.getTextAnchor().getTextSegmentsList()) {
            int start = (int) Math.max(0, segment.getStartIndex());
            int end = (int) Math.min(text.length(), segment.getEndIndex());
            if (end > start) {
                b.append(text, start, end);
            }
        }
        return b.toString().strip();
    }

    /** A line with its box normalized to the page (0..1); null when it has no text or no position. */
    private static OcrResult.OcrLine toLine(String text, Document.Page.Layout layout, Document.Page page, int pageIndex) {
        String lineText = getText(text, layout);
        if (lineText.isEmpty() || !layout.hasBoundingPoly()) {
            return null;
        }
        BoundingPoly poly = layout.getBoundingPoly();
        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxX = -1;
        double maxY = -1;
        if (poly.getNormalizedVerticesCount() > 0) {
            for (NormalizedVertex v : poly.getNormalizedVerticesList()) {
                minX = Math.min(minX, v.getX());
                minY = Math.min(minY, v.getY());
                maxX = Math.max(maxX, v.getX());
                maxY = Math.max(maxY, v.getY());
            }
        } else if (poly.getVerticesCount() > 0 && page.getDimension().getWidth() > 0 && page.getDimension().getHeight() > 0) {
            double w = page.getDimension().getWidth();
            double h = page.getDimension().getHeight();
            for (Vertex v : poly.getVerticesList()) {
                minX = Math.min(minX, v.getX() / w);
                minY = Math.min(minY, v.getY() / h);
                maxX = Math.max(maxX, v.getX() / w);
                maxY = Math.max(maxY, v.getY() / h);
            }
        } else {
            return null;
        }
        return OcrResult.OcrLine.builder()
                .text(lineText)
                .confidence(layout.getConfidence())
                .page(pageIndex)
                .x(minX).y(minY).width(Math.max(0, maxX - minX)).height(Math.max(0, maxY - minY))
                .build();
    }

    private BigDecimal calculateOverallConfidence(List<OcrResult.OcrBlock> blocks) {
        if (blocks.isEmpty()) {
            return BigDecimal.ZERO;
        }
        
        BigDecimal sum = blocks.stream()
                .map(OcrResult.OcrBlock::getConfidence)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        
        return sum.divide(BigDecimal.valueOf(blocks.size()), 4, BigDecimal.ROUND_HALF_UP);
    }

    private String detectMimeType(byte[] imageData) {
        if (imageData == null || imageData.length < 4) return "image/jpeg";
        // PDF: %PDF = 25 50 44 46
        if (imageData[0] == 0x25 && imageData[1] == 0x50 && imageData[2] == 0x44 && imageData[3] == 0x46) return "application/pdf";
        // PNG: 89 50 4E 47
        if (imageData[0] == (byte) 0x89 && imageData[1] == 0x50) return "image/png";
        // JPEG: FF D8
        if (imageData[0] == (byte) 0xFF && imageData[1] == (byte) 0xD8) return "image/jpeg";
        // WebP: 52 49 46 46
        if (imageData[0] == 0x52 && imageData[1] == 0x49) return "image/webp";
        return "image/jpeg";
    }

    @Override
    public OcrProvider getProvider() {
        return OcrProvider.GOOGLE_DOCUMENT_AI;
    }

    @Override
    public boolean isAvailable() {
        boolean configValid = projectId != null && !projectId.isEmpty() &&
               location != null && !location.isEmpty() &&
               processorId != null && !processorId.isEmpty() &&
               credentialsPath != null && !credentialsPath.isEmpty();
        
        if (!configValid) {
            log.debug("Google Document AI unavailable: incomplete configuration");
            return false;
        }
        
        File credentialsFile = new File(credentialsPath);
        boolean readable = credentialsFile.exists() && credentialsFile.canRead();
        if (!readable) {
            log.warn("Google Document AI unavailable: credentials file missing or unreadable");
        }
        return readable;
    }
}
