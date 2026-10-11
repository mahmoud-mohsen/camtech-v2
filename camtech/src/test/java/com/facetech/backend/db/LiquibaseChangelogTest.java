package com.facetech.backend.db;

import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Applies the whole changelog to an empty in-memory database (H2 in Oracle mode),
 * then rolls back to the empty schema and applies it again.
 */
class LiquibaseChangelogTest {

    private static final String MASTER = "db/changelog/db.changelog-master.yaml";

    @Test
    void changelogAppliesRollsBackAndReapplies() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                "jdbc:h2:mem:liquibase_test;MODE=Oracle;DB_CLOSE_DELAY=-1", "sa", "")) {
            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            Liquibase liquibase = new Liquibase(MASTER, new ClassLoaderResourceAccessor(), database);

            liquibase.update("");
            assertSeeded(connection);

            liquibase.rollback(1000, "");
            try (Statement st = connection.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TENANT'")) {
                rs.next();
                assertEquals(0, rs.getInt(1), "rollback should drop every table");
            }

            liquibase.update("");
            assertSeeded(connection);
        }
    }

    private static void assertSeeded(Connection connection) throws Exception {
        try (Statement st = connection.createStatement()) {
            assertEquals(1, count(st, "SELECT COUNT(*) FROM tenant WHERE code = 'NOQODI'"));
            assertEquals(0, count(st, "SELECT COUNT(*) FROM tenant_entitlement WHERE quota_per_day IS NOT NULL"),
                    "NOQODI has no daily quota on anything");
            assertTrue(count(st, "SELECT COUNT(*) FROM ref_reason_code WHERE message_ar IS NOT NULL") > 40);
            assertEquals(5, count(st, "SELECT COUNT(*) FROM ref_flow_step_def s JOIN ref_flow_def f ON f.id = s.flow_id"
                    + " WHERE f.code = 'SELFIE_ID_VERIFICATION'"));
            assertEquals(4, count(st, "SELECT COUNT(*) FROM flow_liveness_policy WHERE allowed_actions = "
                    + "'TURN_LEFT,TURN_RIGHT,BLINK,LOOK_UP,LOOK_DOWN,SMILE,MOVE_CLOSER'"),
                    "every liveness flow of NOQODI allows every challenge (1.2.0 seed, 1.4.0 update, 1.6.0 seed)");
            assertEquals(2, count(st, "SELECT COUNT(*) FROM tenant_entitlement WHERE feature_code IN ('LIVENESS_CHECK', 'FACE_ENROLLMENT')"
                    + " AND enabled = 1"), "NOQODI has the 1.6.0 flows");
            assertEquals(1, count(st, "SELECT COUNT(*) FROM config_param WHERE param_key = 'liveness.allow_without_challenge'"
                    + " AND channel = 'MOBILE'"));
        }
    }

    private static int count(Statement st, String sql) throws Exception {
        try (ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
