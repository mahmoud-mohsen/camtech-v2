package com.facetech.backend.config;

import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.autoconfigure.orm.jpa.HibernatePropertiesCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Uses {@link CamtechPostgreSQLDialect} when the datasource is PostgreSQL; Oracle and H2 keep their default dialect. */
@Configuration
public class PostgresLobConfig {

    @Bean
    public HibernatePropertiesCustomizer postgresLobDialect(DataSourceProperties dataSource) {
        return properties -> {
            String url = dataSource.getUrl();
            if (url != null && url.startsWith("jdbc:postgresql:")) {
                properties.put("hibernate.dialect", CamtechPostgreSQLDialect.class.getName());
            }
        };
    }
}
