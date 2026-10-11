package com.facetech.backend.verification;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** The random draw of a challenge: challengeCount actions of the tenant's selection that the client supports. */
class LivenessChallengeDrawTest {

    private static final List<String> ALL = List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE");
    private final Random random = new Random(42);

    @Test
    void drawsTheCountFromTheSelectionWithoutRepeats() {
        List<String> selection = List.of("TURN_LEFT", "BLINK", "LOOK_UP", "SMILE");
        for (int i = 0; i < 200; i++) {
            List<String> drawn = LivenessChallengeService.draw(selection, ALL, 3, random);
            assertThat(drawn).hasSize(3).doesNotHaveDuplicates().isSubsetOf(selection);
        }
    }

    @Test
    void combinationsAndOrdersVary() {
        List<String> selection = List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "SMILE");
        Set<Set<String>> combos = new HashSet<>();
        Set<List<String>> orders = new HashSet<>();
        for (int i = 0; i < 400; i++) {
            List<String> drawn = LivenessChallengeService.draw(selection, ALL, 2, random);
            combos.add(Set.copyOf(drawn));
            orders.add(drawn);
        }
        assertThat(combos).as("every pair of the 4 actions comes up").hasSize(6);
        assertThat(orders).as("both orders of every pair come up").hasSize(12);
    }

    @Test
    void countEqualToTheSelectionUsesAllOfThemInRandomOrder() {
        List<String> selection = List.of("TURN_LEFT", "TURN_RIGHT", "BLINK");
        Set<List<String>> orders = new HashSet<>();
        for (int i = 0; i < 200; i++) {
            List<String> drawn = LivenessChallengeService.draw(selection, ALL, 3, random);
            assertThat(drawn).containsExactlyInAnyOrderElementsOf(selection);
            orders.add(drawn);
        }
        assertThat(orders).hasSize(6);
    }

    @Test
    void onlyActionsTheClientSupportsAreDrawn() {
        List<String> selection = List.of("TURN_LEFT", "TURN_RIGHT", "BLINK", "LOOK_UP", "SMILE");
        for (int i = 0; i < 100; i++) {
            assertThat(LivenessChallengeService.draw(selection, LivenessChallengeService.DEFAULT_SUPPORTED_ACTIONS, 2, random))
                    .isSubsetOf("TURN_LEFT", "TURN_RIGHT", "BLINK");
        }
    }

    @Test
    void tooFewSupportedActionsGiveNothing() {
        List<String> selection = List.of("BLINK", "LOOK_UP", "LOOK_DOWN", "SMILE");
        assertThat(LivenessChallengeService.draw(selection, LivenessChallengeService.DEFAULT_SUPPORTED_ACTIONS, 2, random))
                .as("an old app supports only BLINK of this selection").isNull();
        assertThat(LivenessChallengeService.draw(selection, List.of(), 1, random)).isNull();
        assertThat(LivenessChallengeService.draw(selection, ALL, 5, random)).isNull();
    }
}
