package com.facetech.backend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;


public class FaceDtos {

    /**
     * Client-supplied registration fields. No embedding here - the server
     * derives it from the uploaded image via FaceEmbeddingClient. Any
     * "embedding"/"model_version" the client still sends is ignored.
     */
    public static class FaceRegisterRequest {
        private String name;

        @JsonProperty("user_id")
        private Long userId;

        @JsonProperty("session_id")
        private String sessionId;

        private String pose;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public Long getUserId() {
            return userId;
        }

        public void setUserId(Long userId) {
            this.userId = userId;
        }

        public String getSessionId() {
            return sessionId;
        }

        public void setSessionId(String sessionId) {
            this.sessionId = sessionId;
        }

        public String getPose() {
            return pose;
        }

        public void setPose(String pose) {
            this.pose = pose;
        }
    }

    public static class FaceVerifyResponse {
        private boolean match;
        private double distance;
        private double confidence;
        @JsonProperty("matched_model_version")
        private String matchedModelVersion;

        @JsonProperty("user_id")
        private Long userId;

        @JsonProperty("user_name")
        private String userName;

        public boolean isMatch() {
            return match;
        }

        public void setMatch(boolean match) {
            this.match = match;
        }

        public double getDistance() {
            return distance;
        }

        public void setDistance(double distance) {
            this.distance = distance;
        }

        public double getConfidence() {
            return confidence;
        }

        public void setConfidence(double confidence) {
            this.confidence = confidence;
        }

        public String getMatchedModelVersion() {
            return matchedModelVersion;
        }

        public void setMatchedModelVersion(String matchedModelVersion) {
            this.matchedModelVersion = matchedModelVersion;
        }

        public Long getUserId() {
            return userId;
        }

        public void setUserId(Long userId) {
            this.userId = userId;
        }

        public String getUserName() {
            return userName;
        }

        public void setUserName(String userName) {
            this.userName = userName;
        }
    }

    /**
     * Client-supplied identifier fields for /face/verify. No embedding here -
     * the server derives it from the uploaded selfie image.
     */
    public static class FaceVerifyByIdentifierRequest {
        @JsonProperty("emirates_id_number")
        private String emiratesIdNumber;

        private String username;

        public String getEmiratesIdNumber() {
            return emiratesIdNumber;
        }

        public void setEmiratesIdNumber(String emiratesIdNumber) {
            this.emiratesIdNumber = emiratesIdNumber;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }
    }

    public static class FaceIdentifyResponse {
        private boolean match;
        private double distance;
        private double confidence;
        @JsonProperty("matched_model_version")
        private String matchedModelVersion;

        @JsonProperty("user_id")
        private Long userId;

        @JsonProperty("user_name")
        private String userName;

        public boolean isMatch() {
            return match;
        }

        public void setMatch(boolean match) {
            this.match = match;
        }

        public double getDistance() {
            return distance;
        }

        public void setDistance(double distance) {
            this.distance = distance;
        }

        public double getConfidence() {
            return confidence;
        }

        public void setConfidence(double confidence) {
            this.confidence = confidence;
        }

        public String getMatchedModelVersion() {
            return matchedModelVersion;
        }

        public void setMatchedModelVersion(String matchedModelVersion) {
            this.matchedModelVersion = matchedModelVersion;
        }

        public Long getUserId() {
            return userId;
        }

        public void setUserId(Long userId) {
            this.userId = userId;
        }

        public String getUserName() {
            return userName;
        }

        public void setUserName(String userName) {
            this.userName = userName;
        }
    }

    /**
     * Stateless pairwise comparison (e.g. live selfie vs. an Emirates ID
     * portrait) - no stored registration or user lookup involved.
     */
    public static class FaceCompareResponse {
        private boolean match;
        /** MATCH | REVIEW | NO_MATCH */
        private String decision;
        /** Cosine similarity of the two faces (higher = more similar). */
        private double similarity;
        /** 0-100, aligned with the decision bands (see FaceMatchScoring). */
        private int score;
        private double distance;
        private double confidence;
        @JsonProperty("model_version")
        private String modelVersion;

        public String getDecision() {
            return decision;
        }

        public void setDecision(String decision) {
            this.decision = decision;
        }

        public double getSimilarity() {
            return similarity;
        }

        public void setSimilarity(double similarity) {
            this.similarity = similarity;
        }

        public int getScore() {
            return score;
        }

        public void setScore(int score) {
            this.score = score;
        }

        public boolean isMatch() {
            return match;
        }

        public void setMatch(boolean match) {
            this.match = match;
        }

        public double getDistance() {
            return distance;
        }

        public void setDistance(double distance) {
            this.distance = distance;
        }

        public double getConfidence() {
            return confidence;
        }

        public void setConfidence(double confidence) {
            this.confidence = confidence;
        }

        public String getModelVersion() {
            return modelVersion;
        }

        public void setModelVersion(String modelVersion) {
            this.modelVersion = modelVersion;
        }
    }
}
