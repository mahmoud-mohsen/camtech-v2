package com.facetech.backend.dto;

public class OnboardingSessionDtos {

    public static class CreateSessionRequest {
        private String name;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }
    }
}
