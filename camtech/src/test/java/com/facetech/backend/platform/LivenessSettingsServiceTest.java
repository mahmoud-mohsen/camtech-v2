package com.facetech.backend.platform;

import com.facetech.backend.exception.FaceMatchException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** The rules a tenant's liveness settings and a back-office policy must follow. */
class LivenessSettingsServiceTest {

    private static final String ONBOARDING = "SELFIE_ID_VERIFICATION";
    private static final String FACE_AUTH = "FACE_AUTHENTICATION";
    private static final LivenessSettingsService.LivenessPolicy POLICY = new LivenessSettingsService.LivenessPolicy(
            List.of("ACTIVE", "PASSIVE"), List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "SMILE"), 2, 3, true);

    private static String code(String flow, String mode, List<String> actions, int count) {
        LivenessSettingsService.Issue issue = LivenessSettingsService.validate(flow,
                new LivenessSettingsService.LivenessSettings(mode, actions, count), POLICY);
        return issue == null ? null : issue.code();
    }

    @Test
    void validSettingsPass() {
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT", "BLINK", "SMILE"), 2)).isNull();
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "SMILE"), 3)).isNull();
        assertThat(code(FACE_AUTH, "PASSIVE", List.of(), 0)).as("count rules do not apply to PASSIVE").isNull();
    }

    @Test
    void eachRuleHasItsCode() {
        assertThat(code(ONBOARDING, "PASSIVE", List.of("TURN_LEFT", "BLINK", "SMILE"), 2))
                .as("onboarding is always ACTIVE, whatever the policy says").isEqualTo("MODE_NOT_ALLOWED");
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("BLINK", "BLINK", "SMILE"), 2)).isEqualTo("DUPLICATE_ACTION");
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT", "BLINK", "LOOK_UP"), 2)).isEqualTo("ACTION_NOT_ALLOWED");
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT", "BLINK", "SMILE"), 1)).isEqualTo("COUNT_OUT_OF_RANGE");
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "SMILE"), 4))
                .isEqualTo("COUNT_OUT_OF_RANGE");
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT"), 2)).isEqualTo("COUNT_EXCEEDS_SELECTION");
        assertThat(code(FACE_AUTH, "ACTIVE", List.of("TURN_LEFT", "BLINK"), 2)).isEqualTo("SPARE_ACTION_REQUIRED");

        var noSpare = new LivenessSettingsService.LivenessPolicy(List.of("ACTIVE"), POLICY.allowedActions(), 2, 3, false);
        assertThat(LivenessSettingsService.validate(FACE_AUTH,
                new LivenessSettingsService.LivenessSettings("ACTIVE", List.of("TURN_LEFT", "BLINK"), 2), noSpare)).isNull();
        assertThat(LivenessSettingsService.validate(FACE_AUTH,
                new LivenessSettingsService.LivenessSettings("PASSIVE", List.of("TURN_LEFT", "BLINK"), 2), noSpare).code())
                .as("PASSIVE not in allowedModes").isEqualTo("MODE_NOT_ALLOWED");
    }

    @Test
    void unknownValuesAreValidationErrors() {
        assertThat(parseError(new LivenessSettingsService.SettingsUpdate("SLEEPY", List.of(), 2))).isEqualTo("VALIDATION_ERROR");
        assertThat(parseError(new LivenessSettingsService.SettingsUpdate("ACTIVE", List.of("WINK"), 2))).isEqualTo("VALIDATION_ERROR");
        assertThat(parseError(new LivenessSettingsService.SettingsUpdate("ACTIVE", List.of("BLINK"), null))).isEqualTo("VALIDATION_ERROR");
        assertThat(parseError(new LivenessSettingsService.SettingsUpdate("active", List.of("blink"), 1))).isNull();
    }

    @Test
    void defaultsAreActiveWithEveryAllowedActionAndTheMinimumCount() {
        var d = LivenessSettingsService.defaults(FACE_AUTH, LivenessSettingsService.STARTING_POLICY);
        assertThat(d).as("every challenge allowed and selected").isEqualTo(new LivenessSettingsService.LivenessSettings("ACTIVE",
                List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE", "MOVE_CLOSER"), 2));
        assertThat(LivenessSettingsService.validate(FACE_AUTH, d, LivenessSettingsService.STARTING_POLICY)).isNull();
        var passiveOnly = new LivenessSettingsService.LivenessPolicy(List.of("PASSIVE"), List.of("BLINK", "SMILE"), 1, 1, true);
        assertThat(LivenessSettingsService.defaults(FACE_AUTH, passiveOnly).mode()).isEqualTo("PASSIVE");
    }

    @Test
    void faceAuthenticationAndLivenessCheckStartPassiveAndMayBeActive() {
        for (String flow : List.of(FACE_AUTH, "LIVENESS_CHECK")) {
            var p = LivenessSettingsService.startingPolicy(flow);
            assertThat(p.allowedModes()).containsExactly("ACTIVE", "PASSIVE");
            assertThat(LivenessSettingsService.defaults(flow, p).mode()).isEqualTo("PASSIVE");
            assertThat(LivenessSettingsService.defaults(flow, LivenessSettingsService.STARTING_POLICY).mode())
                    .as("ACTIVE when the back-office allows only ACTIVE").isEqualTo("ACTIVE");
        }
        for (String flow : List.of("SELFIE_ID_VERIFICATION", "FACE_ENROLLMENT")) {
            var p = LivenessSettingsService.startingPolicy(flow);
            assertThat(p.allowedModes()).containsExactly("ACTIVE");
            assertThat(LivenessSettingsService.defaults(flow, p).mode()).isEqualTo("ACTIVE");
        }
    }

    @Test
    void policyChecks() {
        List<String> three = List.of("BLINK", "SMILE", "LOOK_UP");
        assertThat(policyError(ONBOARDING, List.of("ACTIVE", "PASSIVE"), three, 2, 3, true)).isEqualTo("MODE_NOT_ALLOWED");
        assertThat(policyError(FACE_AUTH, List.of("PASSIVE"), three, 2, 3, true)).isNull();
        assertThat(policyError(FACE_AUTH, List.of(), three, 2, 3, true)).isEqualTo("MODE_NOT_ALLOWED");
        assertThat(policyError(FACE_AUTH, List.of("FAST"), three, 2, 3, true)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), List.of("BLINK", "NOD"), 1, 1, true)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), List.of("BLINK", "BLINK"), 1, 1, false)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), three, 0, 3, true)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), three, 3, 2, true)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), three, 2, 8, true)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), three, 8, 8, false)).isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "LOOK_UP",
                "LOOK_DOWN", "SMILE", "MOVE_CLOSER"), 7, 7, false)).as("up to 7 challenges").isNull();
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), List.of("BLINK", "SMILE"), 2, 3, true))
                .as("no spare action possible").isEqualTo("VALIDATION_ERROR");
        assertThat(policyError(FACE_AUTH, List.of("ACTIVE"), List.of("BLINK", "SMILE"), 2, 3, false)).isNull();

        var p = LivenessSettingsService.checkPolicy(FACE_AUTH, new LivenessSettingsService.PolicyUpdate(
                List.of("passive", "ACTIVE"), List.of("SMILE", "TURN_LEFT", "LOOK_UP"), 1, 2, null, null));
        assertThat(p.allowedModes()).containsExactly("ACTIVE", "PASSIVE");
        assertThat(p.allowedActions()).as("display order").containsExactly("TURN_LEFT", "LOOK_UP", "SMILE");
        assertThat(p.requireSpareAction()).as("default").isTrue();
    }

    private static String parseError(LivenessSettingsService.SettingsUpdate body) {
        try {
            LivenessSettingsService.parse(body);
            return null;
        } catch (FaceMatchException e) {
            return e.getCode();
        }
    }

    private static String policyError(String flow, List<String> modes, List<String> actions, int min, int max, boolean spare) {
        try {
            LivenessSettingsService.checkPolicy(flow, new LivenessSettingsService.PolicyUpdate(modes, actions, min, max, spare, null));
            return null;
        } catch (FaceMatchException e) {
            return e.getCode();
        }
    }
}
