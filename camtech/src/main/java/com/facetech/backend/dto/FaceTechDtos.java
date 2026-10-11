package com.facetech.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;

public final class FaceTechDtos {

    private FaceTechDtos() {
    }

    public record SessionResponse(
            @JsonProperty("session_id") String sessionId,
            @JsonProperty("status") String status,
            @JsonProperty("expires_at") OffsetDateTime expiresAt) {
    }

    public record LivenessResponse(
            @JsonProperty("session_id") String sessionId,
            @JsonProperty("status") String status,
            @JsonProperty("same_person_similarity") double samePersonSimilarity,
            @JsonProperty("closer_area_gain") double closerAreaGain) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VerifyResponse(
            @JsonProperty("session_id") String sessionId,
            /* MATCH | REVIEW | NO_MATCH */
            @JsonProperty("decision") String decision,
            @JsonProperty("match") boolean match,
            /* raw cosine similarity, best of the liveness selfies vs the ID */
            @JsonProperty("similarity") double similarity,
            /* 0-100, aligned with the decision bands (see FaceMatchScoring) */
            @JsonProperty("score") int score,
            @JsonProperty("message") String message,
            @JsonProperty("attempts_remaining") int attemptsRemaining,
            @JsonProperty("grayscale_harmonized") boolean grayscaleHarmonized,
            @JsonProperty("model_version") String modelVersion) {
    }
}
