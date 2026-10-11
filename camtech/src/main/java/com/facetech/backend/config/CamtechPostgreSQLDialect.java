package com.facetech.backend.config;

import org.hibernate.boot.model.TypeContributions;
import org.hibernate.dialect.PostgreSQLDialect;
import org.hibernate.service.ServiceRegistry;
import org.hibernate.type.SqlTypes;
import org.hibernate.type.descriptor.jdbc.BinaryJdbcType;
import org.hibernate.type.descriptor.jdbc.LongVarcharJdbcType;
import org.hibernate.type.descriptor.jdbc.spi.JdbcTypeRegistry;

/**
 * PostgreSQL only (set in application.yml next to the PostgreSQL datasource). The {@code @Lob} fields are
 * CLOB/BLOB on Oracle and TEXT/BYTEA on PostgreSQL, but Hibernate's PostgreSQL dialect writes them as large
 * objects and stores the object id in the column. This binds them as plain strings and bytes instead, so the
 * value is stored in the column itself. Oracle keeps the standard dialect.
 */
public class CamtechPostgreSQLDialect extends PostgreSQLDialect {

    @Override
    public void contributeTypes(TypeContributions typeContributions, ServiceRegistry serviceRegistry) {
        super.contributeTypes(typeContributions, serviceRegistry);
        JdbcTypeRegistry registry = typeContributions.getTypeConfiguration().getJdbcTypeRegistry();
        for (int code : new int[]{SqlTypes.CLOB, SqlTypes.NCLOB, SqlTypes.MATERIALIZED_CLOB, SqlTypes.MATERIALIZED_NCLOB}) {
            registry.addDescriptor(code, LongVarcharJdbcType.INSTANCE);
        }
        for (int code : new int[]{SqlTypes.BLOB, SqlTypes.MATERIALIZED_BLOB}) {
            registry.addDescriptor(code, BinaryJdbcType.INSTANCE);
        }
    }
}
