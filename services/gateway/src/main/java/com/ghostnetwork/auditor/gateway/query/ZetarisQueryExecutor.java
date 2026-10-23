package com.ghostnetwork.auditor.gateway.query;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class ZetarisQueryExecutor implements QueryExecutor {

    static final int QUERY_TIMEOUT_SECONDS = 20;

    private static final Logger log = LoggerFactory.getLogger(ZetarisQueryExecutor.class);

    private final ConnectionFactory connections;

    public ZetarisQueryExecutor(ConnectionFactory connections) {
        this.connections = connections;
    }

    @Override
    public QueryResult execute(SqlBuilder.BoundQuery query) {
        ClassLoader previous = Thread.currentThread().getContextClassLoader();
        ClassLoader isolated = connections.contextClassLoader();
        if (isolated != null) {
            Thread.currentThread().setContextClassLoader(isolated);
        }
        try (Connection connection = connections.open()) {
            try {
                return executePrepared(connection, query);
            } catch (SQLException ex) {
                if (SqlFailures.connectionOrTimeout(ex)) {
                    throw failure(ex);
                }
                if (!preparedRejected(ex)) {
                    throw failure(ex);
                }
                log.warn("Prepared statement was rejected ({}); using literal SQL", ex.getClass().getSimpleName());
                try {
                    return executeLiteral(connection, query);
                } catch (SQLException literalFailure) {
                    throw failure(literalFailure);
                }
            }
        } catch (SQLException ex) {
            throw failure(ex);
        } finally {
            Thread.currentThread().setContextClassLoader(previous);
        }
    }

    private static QueryResult executePrepared(Connection connection, SqlBuilder.BoundQuery query) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(query.preparedSql())) {
            applyTimeout(statement);
            bind(statement, query.binds());
            try (ResultSet rows = statement.executeQuery()) {
                return read(rows, true);
            }
        }
    }

    private static QueryResult executeLiteral(Connection connection, SqlBuilder.BoundQuery query) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            applyTimeout(statement);
            try (ResultSet rows = statement.executeQuery(query.displaySql())) {
                return read(rows, false);
            }
        }
    }

    private static void bind(PreparedStatement statement, List<Object> binds) throws SQLException {
        for (int i = 0; i < binds.size(); i++) {
            Object value = binds.get(i);
            int index = i + 1;
            if (value instanceof Integer number) {
                statement.setInt(index, number);
            } else if (value instanceof String text) {
                statement.setString(index, text);
            } else if (value == null) {
                statement.setObject(index, null);
            } else {
                statement.setObject(index, value);
            }
        }
    }

    private static QueryResult read(ResultSet rows, boolean prepared) throws SQLException {
        ResultSetMetaData meta = rows.getMetaData();
        int count = meta.getColumnCount();
        List<String> columns = new ArrayList<>(count);
        int[] types = new int[count];
        for (int i = 0; i < count; i++) {
            columns.add(meta.getColumnLabel(i + 1));
            types[i] = meta.getColumnType(i + 1);
        }
        List<Map<String, String>> records = new ArrayList<>();
        while (rows.next()) {
            Map<String, String> record = new LinkedHashMap<>();
            for (int i = 0; i < count; i++) {
                record.put(columns.get(i), JdbcValues.fromJdbc(types[i], rows.getObject(i + 1)));
            }
            records.add(record);
        }
        return new QueryResult(List.copyOf(columns), List.copyOf(records), prepared);
    }

    private static void applyTimeout(Statement statement) {
        try {
            statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
        } catch (SQLException ex) {
            log.warn("Could not set query timeout ({})", ex.getClass().getSimpleName());
        }
    }

    private static RuntimeException failure(SQLException failure) {
        if (SqlFailures.connectionOrTimeout(failure)) {
            return new ConnectionFailedException("Zetaris query failed", failure);
        }
        return new QueryFailedException(SqlFailures.errorCode(failure), SqlFailures.sqlState(failure), failure);
    }

    static boolean preparedRejected(SQLException failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            if (current instanceof SQLFeatureNotSupportedException) {
                return true;
            }
            String message = current.getMessage();
            if (message != null) {
                String lower = message.toLowerCase(Locale.ROOT);
                if (lower.contains("prepared") || lower.contains("parameter") || lower.contains("placeholder")) {
                    return true;
                }
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
            depth++;
        }
        return false;
    }
}
