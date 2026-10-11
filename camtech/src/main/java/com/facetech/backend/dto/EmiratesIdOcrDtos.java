package com.facetech.backend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class EmiratesIdOcrDtos {

    public static class EmiratesIdOcrResponse {
        @JsonProperty("emiratesIdNumber")
        private String emiratesIdNumber;
        
        @JsonProperty("uidNumber")
        private String uidNumber;

        @JsonProperty("fullNameEn")
        private String fullNameEn;
        
        @JsonProperty("fullNameAr")
        private String fullNameAr;

        @JsonProperty("dateOfBirth")
        private String dateOfBirth;
        
        @JsonProperty("issueDate")
        private String issueDate;
        
        @JsonProperty("expiryDate")
        private String expiryDate;

        @JsonProperty("gender")
        private String gender;
        
        @JsonProperty("genderAr")
        private String genderAr;

        @JsonProperty("nationality")
        private String nationality;
        
        @JsonProperty("nationalityAr")
        private String nationalityAr;

        @JsonProperty("occupation")
        private String occupation;
        
        @JsonProperty("occupationAr")
        private String occupationAr;

        @JsonProperty("employer")
        private String employer;
        
        @JsonProperty("employerAr")
        private String employerAr;

        @JsonProperty("issuingPlace")
        private String issuingPlace;
        
        @JsonProperty("issuingPlaceAr")
        private String issuingPlaceAr;

        @JsonProperty("rawText")
        private String rawText;

        public String getEmiratesIdNumber() {
            return emiratesIdNumber;
        }

        public void setEmiratesIdNumber(String emiratesIdNumber) {
            this.emiratesIdNumber = emiratesIdNumber;
        }

        public String getUidNumber() {
            return uidNumber;
        }

        public void setUidNumber(String uidNumber) {
            this.uidNumber = uidNumber;
        }

        public String getFullNameEn() {
            return fullNameEn;
        }

        public void setFullNameEn(String fullNameEn) {
            this.fullNameEn = fullNameEn;
        }

        public String getFullNameAr() {
            return fullNameAr;
        }

        public void setFullNameAr(String fullNameAr) {
            this.fullNameAr = fullNameAr;
        }

        public String getDateOfBirth() {
            return dateOfBirth;
        }

        public void setDateOfBirth(String dateOfBirth) {
            this.dateOfBirth = dateOfBirth;
        }

        public String getIssueDate() {
            return issueDate;
        }

        public void setIssueDate(String issueDate) {
            this.issueDate = issueDate;
        }

        public String getExpiryDate() {
            return expiryDate;
        }

        public void setExpiryDate(String expiryDate) {
            this.expiryDate = expiryDate;
        }

        public String getGender() {
            return gender;
        }

        public void setGender(String gender) {
            this.gender = gender;
        }

        public String getGenderAr() {
            return genderAr;
        }

        public void setGenderAr(String genderAr) {
            this.genderAr = genderAr;
        }

        public String getNationality() {
            return nationality;
        }

        public void setNationality(String nationality) {
            this.nationality = nationality;
        }

        public String getNationalityAr() {
            return nationalityAr;
        }

        public void setNationalityAr(String nationalityAr) {
            this.nationalityAr = nationalityAr;
        }

        public String getOccupation() {
            return occupation;
        }

        public void setOccupation(String occupation) {
            this.occupation = occupation;
        }

        public String getOccupationAr() {
            return occupationAr;
        }

        public void setOccupationAr(String occupationAr) {
            this.occupationAr = occupationAr;
        }

        public String getEmployer() {
            return employer;
        }

        public void setEmployer(String employer) {
            this.employer = employer;
        }

        public String getEmployerAr() {
            return employerAr;
        }

        public void setEmployerAr(String employerAr) {
            this.employerAr = employerAr;
        }

        public String getIssuingPlace() {
            return issuingPlace;
        }

        public void setIssuingPlace(String issuingPlace) {
            this.issuingPlace = issuingPlace;
        }

        public String getIssuingPlaceAr() {
            return issuingPlaceAr;
        }

        public void setIssuingPlaceAr(String issuingPlaceAr) {
            this.issuingPlaceAr = issuingPlaceAr;
        }

        public String getRawText() {
            return rawText;
        }

        public void setRawText(String rawText) {
            this.rawText = rawText;
        }
    }
}
