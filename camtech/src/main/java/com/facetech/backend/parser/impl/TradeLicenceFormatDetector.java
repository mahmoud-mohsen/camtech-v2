package com.facetech.backend.parser.impl;

import com.facetech.backend.model.TradeLicenceFormat;

final class TradeLicenceFormatDetector {

    private TradeLicenceFormatDetector() {
    }

    static TradeLicenceFormat detect(String ocrText) {
        if (ocrText == null || ocrText.isBlank()) {
            return TradeLicenceFormat.DET;
        }
        String lower = ocrText.toLowerCase(java.util.Locale.ROOT).replace('\u00a0', ' ').replaceAll("\\s+", " ");

        // Sharjah free zones before Sharjah DED (Government of Sharjah appears on all).
        if (lower.contains("saif zone")
                || lower.contains("saif-zone")
                || lower.contains("sharjah airport international free zone")
                || lower.contains("portal.saif-zone.com")
                || lower.contains("saif-zone.com")
                || lower.contains("المنطقة الحرة لمطار الشارقة")) {
            return TradeLicenceFormat.SHARJAH_AIRPORT_INTERNATIONAL_FREE_ZONE;
        }

        if (lower.contains("sharjah media city")
                || lower.contains("shams.ae")
                || lower.contains("shamsfz")
                || lower.contains("info@shams")
                || lower.contains("مدينة الشارقة للإعلام")
                || (lower.contains("shams") && (lower.contains("free zone") || lower.contains("business license")))) {
            return TradeLicenceFormat.SHARJAH_MEDIA_CITY_FREE_ZONE;
        }

        if (lower.contains("sharjah publishing city")
                || lower.contains("spcfz")
                || lower.contains("portal.spcfz")
                || lower.contains("مدينة الشارقة للنشر")) {
            return TradeLicenceFormat.SHARJAH_PUBLISHING_CITY;
        }

        if (lower.contains("srtip")
                || lower.contains("srtip.ae")
                || lower.contains("sharjah research technology")
                || lower.contains("research technology and innovation")
                || lower.contains("srti free zone")
                || lower.contains("مجمع الشارقة للبحوث")
                || lower.contains("للتكنولوجيا والابتكار")) {
            return TradeLicenceFormat.SHARJAH_RESEARCH_TECHNOLOGY_AND_INNOVATION_PARK;
        }

        if (lower.contains("sedd.ae")
                || (lower.contains("economic development department")
                && lower.contains("sharjah"))
                || (lower.contains("دائرة التنمية الاقتصادية")
                && lower.contains("الشارقة")
                && !lower.contains("منطقة حرة")
                && !lower.contains("free zone"))) {
            return TradeLicenceFormat.SHARJAH_DED;
        }

        if (lower.contains("jebel ali free zone")
                || lower.contains("jafza")
                || lower.contains("المنطقة الحرة لجبل علي")
                || lower.contains("logistic license")
                || lower.contains("رخصة لوجستية")) {
            return TradeLicenceFormat.JAFZA;
        }

        if (lower.contains("adra.gov.ae")
                || lower.contains("abu dhabi registration authority")
                || lower.contains("abu dhabi economic licence")
                || lower.contains("tamm.abudhabi")
                || lower.contains("سلطة أبوظبي للتسجيل")
                || lower.contains("رخصة أبوظبي الاقتصادية")) {
            return TradeLicenceFormat.ABU_DHABI_DED;
        }

        if (lower.contains("ancfz.ae")) {
            return TradeLicenceFormat.AJMAN_ANCFZ;
        }

        if (lower.contains("fza.ae")
                || lower.contains("free zones authority of ajman")
                || lower.contains("هيئة المناطق الحرة في عجمان")) {
            return TradeLicenceFormat.AJMAN_FZA;
        }

        if ((lower.contains("department of economic development")
                && (lower.contains("ajman") || lower.contains("عجمان")))
                || (lower.contains("verify the license kindly scan the barcode")
                && lower.contains("ajman"))
                || (lower.contains("تفاصيل الرخصة")
                && lower.contains("عجمان")
                && lower.contains("trade name"))) {
            return TradeLicenceFormat.AJMAN_DED;
        }

        if (lower.contains("rakez")
                || lower.contains("ras al khaimah economic zone")
                || lower.contains("هيئة مناطق رأس الخيمة الاقتصادية")
                || lower.contains("رأس الخيمة مناطق هيئة")) {
            return TradeLicenceFormat.RAS_AL_KHAIMAH_ECONOMIC_ZONE_RAKEZ;
        }

        if (lower.contains("rak ded")
                || (lower.contains("issued by rak") && lower.contains("commercial registry"))
                || (lower.contains("local registery no") && lower.contains("cbls no"))
                || (lower.contains("local registry no") && lower.contains("cbls no"))) {
            return TradeLicenceFormat.RAS_AL_KHAIMAH_DED;
        }

        boolean uaq = lower.contains("umm al quwain")
                || lower.contains("umm al qaiwain")
                || lower.contains("ام القيوين")
                || lower.contains("أم القيوين");

        if (uaq && (lower.contains("free zone") || lower.contains("free trade zone") || lower.contains("fze")
                || lower.contains("منطقة حرة") || lower.contains("uaq free"))) {
            return TradeLicenceFormat.UMM_AL_QUWAIN_FREE_ZONE;
        }

        if ((uaq || lower.contains("lic-prof-") || lower.contains("lic-com-") || lower.contains("lic-ind-"))
                && (lower.contains("department of economic development")
                || lower.contains("دائرة التنمية الاقتصادية")
                || lower.contains("license details")
                || lower.contains("lic-prof-")
                || lower.contains("lic-com-")
                || lower.contains("lic-ind-"))) {
            if (uaq
                    || ((lower.contains("lic-prof-") || lower.contains("lic-com-") || lower.contains("lic-ind-"))
                    && lower.contains("license details"))) {
                return TradeLicenceFormat.UMM_AL_QUWAIN_DED;
            }
        }

        if (lower.contains("creative city")
                || lower.contains("media free zone")
                || lower.contains("creativecity.gov.ae")
                || lower.contains("مدينة الإبداع")
                || lower.contains("مدينة الفجيرة للإبداع")
                || lower.contains("المنطقة الاعلامية الحرة")
                || lower.contains("المنطقة الإعلامية الحرة")) {
            return TradeLicenceFormat.FUJAIRAH_MEDIA_ZONE_CREATIVE_CITY;
        }

        if (lower.contains("dibba municipality")
                || lower.contains("بلدية دبا")
                || (lower.contains("local registry no")
                && lower.contains("business name")
                && lower.contains("acronym")
                && (lower.contains("government of fujairah") || lower.contains("حكومة الفجيرة")))) {
            return TradeLicenceFormat.FUJAIRAH_DIBBA_DED;
        }

        if (lower.contains("fujairah municipality")
                || lower.contains("بلدية الفجيرة")
                || (lower.contains("government of fujairah")
                && (lower.contains("license no") || lower.contains("رقم الرخصة")
                || lower.contains("professional license") || lower.contains("commercial license")
                || lower.contains("coc no") || lower.contains("trade name")))) {
            return TradeLicenceFormat.FUJAIRAH_DED;
        }

        // Last-resort Sharjah DED when government of sharjah + trading license wording (not free zone).
        if (lower.contains("government of sharjah")
                && (lower.contains("trading license") || lower.contains("رخصة تجارية رئيسية")
                || lower.contains("sedd"))
                && !lower.contains("free zone")
                && !lower.contains("منطقة حرة")) {
            return TradeLicenceFormat.SHARJAH_DED;
        }

        return TradeLicenceFormat.DET;
    }
}
