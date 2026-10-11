package com.facetech.backend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class PassportDtos {

    public static class PassportMrzRequest {
        @JsonProperty("documentType")
        private String documentType;
        
        @JsonProperty("documentNumber")
        private String documentNumber;
        
        @JsonProperty("issuingCountry")
        private String issuingCountry;
        
        @JsonProperty("fullNameEn")
        private String fullNameEn;
        
        @JsonProperty("surname")
        private String surname;
        
        @JsonProperty("givenNames")
        private String givenNames;
        
        @JsonProperty("nationality")
        private String nationality;
        
        @JsonProperty("dateOfBirth")
        private String dateOfBirth;
        
        @JsonProperty("sex")
        private String sex;
        
        @JsonProperty("expiryDate")
        private String expiryDate;
        
        @JsonProperty("mrzLine1")
        private String mrzLine1;
        
        @JsonProperty("mrzLine2")
        private String mrzLine2;

        public String getDocumentType() {
            return documentType;
        }

        public void setDocumentType(String documentType) {
            this.documentType = documentType;
        }

        public String getDocumentNumber() {
            return documentNumber;
        }

        public void setDocumentNumber(String documentNumber) {
            this.documentNumber = documentNumber;
        }

        public String getIssuingCountry() {
            return issuingCountry;
        }

        public void setIssuingCountry(String issuingCountry) {
            this.issuingCountry = issuingCountry;
        }

        public String getFullNameEn() {
            return fullNameEn;
        }

        public void setFullNameEn(String fullNameEn) {
            this.fullNameEn = fullNameEn;
        }

        public String getSurname() {
            return surname;
        }

        public void setSurname(String surname) {
            this.surname = surname;
        }

        public String getGivenNames() {
            return givenNames;
        }

        public void setGivenNames(String givenNames) {
            this.givenNames = givenNames;
        }

        public String getNationality() {
            return nationality;
        }

        public void setNationality(String nationality) {
            this.nationality = nationality;
        }

        public String getDateOfBirth() {
            return dateOfBirth;
        }

        public void setDateOfBirth(String dateOfBirth) {
            this.dateOfBirth = dateOfBirth;
        }

        public String getSex() {
            return sex;
        }

        public void setSex(String sex) {
            this.sex = sex;
        }

        public String getExpiryDate() {
            return expiryDate;
        }

        public void setExpiryDate(String expiryDate) {
            this.expiryDate = expiryDate;
        }

        public String getMrzLine1() {
            return mrzLine1;
        }

        public void setMrzLine1(String mrzLine1) {
            this.mrzLine1 = mrzLine1;
        }

        public String getMrzLine2() {
            return mrzLine2;
        }

        public void setMrzLine2(String mrzLine2) {
            this.mrzLine2 = mrzLine2;
        }
    }
}
