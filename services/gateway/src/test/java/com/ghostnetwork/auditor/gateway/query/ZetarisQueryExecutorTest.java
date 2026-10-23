package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ZetarisQueryExecutorTest {

    private final SqlBuilder.BoundQuery query = new SqlBuilder(
            "PLAN_PG.directory_listing",
            "GNA_FILES.roster",
            "GNA_FILES.claims",
            new LiteralSqlRenderer())
            .build(
                    new ParamValidator(new TemplateRegistry()).validate(
                            "directory_batch",
                            Map.of("batch", "A", "limit", 5)).template(),
                    new ParamValidator(new TemplateRegistry()).validate(
                            "directory_batch",
                            Map.of("batch", "A", "limit", 5)).params());

    @Test
    void usesPreparedStatementAndKeepsTheIsolatedClassLoaderForTheCall() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement prepared = mock(PreparedStatement.class);
        ResultSet rows = stringRows("A");
        when(connection.prepareStatement(query.preparedSql())).thenReturn(prepared);
        when(prepared.executeQuery()).thenReturn(rows);
        ClassLoader marker = new ClassLoader(ClassLoader.getPlatformClassLoader()) {};
        AtomicReference<ClassLoader> seen = new AtomicReference<>();
        ClassLoader original = Thread.currentThread().getContextClassLoader();
        QueryResult result = executor(connection, marker, seen).execute(query);
        assertTrue(result.prepared());
        assertEquals("A", result.rows().get(0).get("batch"));
        assertEquals(marker, seen.get());
        assertEquals(original, Thread.currentThread().getContextClassLoader());
        verify(prepared).setQueryTimeout(20);
        verify(prepared).setString(1, "A");
        verify(prepared).setInt(2, 5);
        verify(prepared, never()).setInt(anyInt(), org.mockito.ArgumentMatchers.eq(0));
        verify(connection, never()).createStatement();
        assertFalse(query.preparedSql().contains("OFFSET"));
    }

    @Test
    void fallsBackToLiteralSqlWhenPreparedStatementsAreRejected() throws Exception {
        Connection connection = mock(Connection.class);
        Statement statement = mock(Statement.class);
        ResultSet rows = stringRows("A");
        when(connection.prepareStatement(anyString())).thenThrow(new SQLFeatureNotSupportedException("prepared"));
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery(query.displaySql())).thenReturn(rows);
        QueryResult result = executor(connection, null, new AtomicReference<>()).execute(query);
        assertFalse(result.prepared());
        assertEquals("A", result.rows().get(0).get("batch"));
        verify(statement).setQueryTimeout(20);
        verify(statement).executeQuery(query.displaySql());
    }

    @Test
    void doesNotFallBackWhenTheTableIsMissing() throws Exception {
        Connection connection = mock(Connection.class);
        when(connection.prepareStatement(anyString())).thenThrow(new SQLException(
                "[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found",
                "42S02"));
        QueryFailedException failure = org.junit.jupiter.api.Assertions.assertThrows(
                QueryFailedException.class,
                () -> executor(connection, null, new AtomicReference<>()).execute(query));
        assertEquals("TABLE_OR_VIEW_NOT_FOUND", failure.error());
        assertEquals("42S02", failure.sqlState());
        verify(connection, never()).createStatement();
    }

    @Test
    void connectionAndTimeoutFailuresDoNotUseLiteralSql() throws Exception {
        SQLException[] failures = {
                new java.sql.SQLTransientConnectionException("connection reset"),
                new java.sql.SQLNonTransientConnectionException("connection refused"),
                new java.sql.SQLTimeoutException("query timed out")
        };
        for (SQLException failure : failures) {
            Connection connection = mock(Connection.class);
            when(connection.prepareStatement(anyString())).thenThrow(failure);
            org.junit.jupiter.api.Assertions.assertThrows(
                    ConnectionFailedException.class,
                    () -> executor(connection, null, new AtomicReference<>()).execute(query));
            verify(connection, never()).createStatement();
        }
    }

    @Test
    void timeoutSupportIsOptional() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement prepared = mock(PreparedStatement.class);
        when(connection.prepareStatement(anyString())).thenReturn(prepared);
        ResultSet rows = stringRows("A");
        doThrow(new SQLFeatureNotSupportedException("timeout")).when(prepared).setQueryTimeout(20);
        when(prepared.executeQuery()).thenReturn(rows);
        QueryResult result = executor(connection, null, new AtomicReference<>()).execute(query);
        assertTrue(result.prepared());
        verify(connection, never()).createStatement();
    }

    @Test
    void readsDateBooleanNullDecimalAndTimestamp() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement prepared = mock(PreparedStatement.class);
        ResultSet rows = mock(ResultSet.class);
        ResultSetMetaData meta = mock(ResultSetMetaData.class);
        when(connection.prepareStatement(anyString())).thenReturn(prepared);
        when(prepared.executeQuery()).thenReturn(rows);
        when(rows.getMetaData()).thenReturn(meta);
        when(meta.getColumnCount()).thenReturn(5);
        when(meta.getColumnLabel(1)).thenReturn("accepting_new_patients");
        when(meta.getColumnLabel(2)).thenReturn("amount");
        when(meta.getColumnLabel(3)).thenReturn("group_name");
        when(meta.getColumnLabel(4)).thenReturn("last_verified_date");
        when(meta.getColumnLabel(5)).thenReturn("verified_at");
        when(meta.getColumnType(1)).thenReturn(Types.BOOLEAN);
        when(meta.getColumnType(2)).thenReturn(Types.DECIMAL);
        when(meta.getColumnType(3)).thenReturn(Types.VARCHAR);
        when(meta.getColumnType(4)).thenReturn(Types.DATE);
        when(meta.getColumnType(5)).thenReturn(Types.TIMESTAMP);
        when(rows.next()).thenReturn(true, false);
        when(rows.getObject(1)).thenReturn(true);
        when(rows.getObject(2)).thenReturn(new BigDecimal("10.50"));
        when(rows.getObject(3)).thenReturn(null);
        when(rows.getObject(4)).thenReturn(java.sql.Date.valueOf("2026-04-15"));
        when(rows.getObject(5)).thenReturn(Timestamp.from(Instant.parse("2026-04-15T13:45:00Z")));

        QueryResult result = executor(connection, null, new AtomicReference<>()).execute(query);
        Map<String, String> row = result.rows().get(0);
        String json = CanonicalJson.of(List.of(row));
        assertEquals("2010effe491fa055ae11d6e15eb19e0e3bbd89c8a05bf3ea09adbf77f03c646e", ReceiptIds.rowsHash(json));
    }

    private static ZetarisQueryExecutor executor(
            Connection connection,
            ClassLoader marker,
            AtomicReference<ClassLoader> seen
    ) {
        return new ZetarisQueryExecutor(new ConnectionFactory() {
            @Override
            public Connection open() {
                seen.set(Thread.currentThread().getContextClassLoader());
                return connection;
            }

            @Override
            public ClassLoader contextClassLoader() {
                return marker;
            }
        });
    }

    private static ResultSet stringRows(String value) throws SQLException {
        ResultSet rows = mock(ResultSet.class);
        ResultSetMetaData meta = mock(ResultSetMetaData.class);
        when(rows.getMetaData()).thenReturn(meta);
        when(meta.getColumnCount()).thenReturn(1);
        when(meta.getColumnLabel(1)).thenReturn("batch");
        when(meta.getColumnType(1)).thenReturn(Types.VARCHAR);
        when(rows.next()).thenReturn(true, false);
        when(rows.getObject(1)).thenReturn(value);
        return rows;
    }
}
