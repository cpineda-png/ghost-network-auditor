package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ghostnetwork.auditor.gateway.api.dto.QueryRequest;
import com.ghostnetwork.auditor.gateway.api.dto.QueryResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.SQLNonTransientConnectionException;
import java.sql.SQLTimeoutException;
import java.sql.SQLTransientConnectionException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.env.Environment;

class QueryServiceTest {

    @TempDir
    Path temp;

    private final ObjectMapper mapper = new ObjectMapper();
    private final TemplateRegistry templates = new TemplateRegistry();
    private final ParamValidator validator = new ParamValidator(templates);
    private final SqlBuilder sqlBuilder = new SqlBuilder(
            "PLAN_PG.directory_listing",
            "GNA_FILES.roster",
            "GNA_FILES.claims",
            new LiteralSqlRenderer());

    @Test
    void sampleModeDoesNotCallJdbcAndMissingSampleIs503() {
        QueryExecutor executor = mock(QueryExecutor.class);
        QueryService service = service(executor, "true", "false");
        QueryResponse response = service.query(request("A", 5, "run_golden"));
        assertEquals("replayed", response.receipt().mode());
        assertEquals("rcpt_0c327279b71647ed", response.receipt().receiptId());
        assertEquals("L-00001", response.rows().get(0) instanceof Map<?, ?> row ? row.get("listing_id") : null);
        assertFalse(response.receipt().sql().contains("OFFSET"));
        verifyNoInteractions(executor);

        QueryUnavailableException missing = assertThrows(
                QueryUnavailableException.class,
                () -> service.query(request("B", 1, "run_missing")));
        assertEquals("No sample is recorded for this query", missing.getMessage());
        verifyNoInteractions(executor);
    }

    @Test
    void transientConnectionFailureServesTheSample() {
        servesRecordedSample(new SQLTransientConnectionException("connection reset"), "run_transient");
    }

    @Test
    void nonTransientConnectionFailureServesTheSample() {
        servesRecordedSample(new SQLNonTransientConnectionException("connection refused"), "run_nontransient");
    }

    @Test
    void queryTimeoutServesTheSample() {
        servesRecordedSample(new SQLTimeoutException("query timed out"), "run_timeout");
    }

    @Test
    void driverConnectFailureServesTheSample() {
        QueryExecutor executor = new ZetarisQueryExecutor(new ConnectionFactory() {
            @Override
            public Connection open() {
                throw new ConnectionFailedException("Zetaris query failed", new SQLException("No suitable driver"));
            }

            @Override
            public ClassLoader contextClassLoader() {
                return null;
            }
        });
        QueryService service = service(executor, "false", "false");
        QueryResponse response = service.query(request("A", 5, "run_connect"));
        assertEquals("replayed", response.receipt().mode());
        assertEquals("L-00001", listingId(response));
        assertTrue(Files.isRegularFile(receiptFile("A", 5, "run_connect")));
    }

    @Test
    void tableNotFoundReturns502AndStoresNoReceipt() {
        QueryService service = service(executorFailing(new SQLException(
                "[TABLE_OR_VIEW_NOT_FOUND] The table or view `PLAN_PG`.`directory_listing` cannot be found",
                "42S02")), "false", "false");
        QueryFailedException rejected = assertThrows(
                QueryFailedException.class,
                () -> service.query(request("A", 5, "run_table")));
        assertEquals("TABLE_OR_VIEW_NOT_FOUND", rejected.error());
        assertEquals("directory_batch", rejected.templateId());
        assertEquals("42S02", rejected.sqlState());
        assertFalse(Files.exists(receiptFile("A", 5, "run_table")));
    }

    @Test
    void connectionFailureWithoutSampleDoesNotLeakTheDriverMessage() {
        QueryService service = service(
                executorFailing(new SQLTransientConnectionException("Could not open client transport")),
                "false",
                "false");
        QueryUnavailableException failure = assertThrows(
                QueryUnavailableException.class,
                () -> service.query(request("B", 1, "run_down")));
        assertEquals("Zetaris query failed and no sample is recorded", failure.getMessage());
        assertFalse(failure.getMessage().contains("transport"));
    }

    private void servesRecordedSample(SQLException failure, String runId) {
        QueryService service = service(executorFailing(failure), "false", "false");
        QueryResponse response = service.query(request("A", 5, runId));
        assertEquals("replayed", response.receipt().mode());
        assertEquals("L-00001", listingId(response));
        assertTrue(Files.isRegularFile(receiptFile("A", 5, runId)));
    }

    private static QueryExecutor executorFailing(SQLException failure) {
        return new ZetarisQueryExecutor(new ConnectionFactory() {
            @Override
            public Connection open() {
                Connection connection = mock(Connection.class);
                PreparedStatement statement = mock(PreparedStatement.class);
                try {
                    when(connection.prepareStatement(anyString())).thenReturn(statement);
                    when(statement.executeQuery()).thenThrow(failure);
                } catch (SQLException ex) {
                    throw new IllegalStateException(ex);
                }
                return connection;
            }

            @Override
            public ClassLoader contextClassLoader() {
                return null;
            }
        });
    }

    private Path receiptFile(String batch, int limit, String runId) {
        String params = CanonicalJson.of(Map.of("batch", batch, "limit", limit, "offset", 0));
        return temp.resolve("receipts").resolve(ReceiptIds.receiptId("directory_batch", params, runId) + ".json");
    }

    private static String listingId(QueryResponse response) {
        return response.rows().get(0) instanceof Map<?, ?> row ? String.valueOf(row.get("listing_id")) : null;
    }

    @Test
    void recordModeWritesOnlyToTheSamplesDirectory() throws Exception {
        QueryExecutor executor = mock(QueryExecutor.class);
        when(executor.execute(any())).thenReturn(new QueryResult(
                List.of("listing_id", "batch"),
                List.of(Map.of("batch", "A", "listing_id", "LIVE")),
                true));
        QueryService service = service(executor, "false", "true");
        QueryResponse response = service.query(request("A", 5, "run_record"));
        assertEquals("live", response.receipt().mode());
        assertTrue(response.receipt().sql().contains("LIMIT 5"));
        assertFalse(response.receipt().sql().contains("OFFSET"));

        Path recorded = temp.resolve("samples").resolve("directory_batch").resolve("2cc0721f9d00aead.json");
        assertTrue(Files.isRegularFile(recorded));
        assertTrue(Files.readString(recorded).contains("LIVE"));
        assertTrue(Files.readString(Path.of(
                "src/main/resources/samples/directory_batch/2cc0721f9d00aead.json")).contains("L-00001"));
        assertFalse(Files.readString(Path.of(
                "src/main/resources/samples/directory_batch/2cc0721f9d00aead.json")).contains("LIVE"));
    }

    @Test
    void diskSampleWinsOverTheClasspathFixture() {
        SampleStore store = new SampleStore(mapper, temp.resolve("samples").toString());
        String params = CanonicalJson.of(Map.of("batch", "A", "limit", 5, "offset", 0));
        assertEquals("L-00001", store.read("directory_batch", params).orElseThrow().rows().get(0).get("listing_id"));
        store.record("directory_batch", params, List.of("listing_id"), List.of(Map.of("listing_id", "DISK")));
        assertEquals("DISK", store.read("directory_batch", params).orElseThrow().rows().get(0).get("listing_id"));
        assertTrue(Files.isRegularFile(temp.resolve("samples").resolve("directory_batch").resolve("2cc0721f9d00aead.json")));
    }

    @Test
    void rowsPreviewKeepsTheFirstTwentyWhileTheReceiptFileKeepsEveryRow() throws Exception {
        List<Map<String, String>> rows = new ArrayList<>();
        for (int i = 0; i < 21; i++) {
            rows.add(Map.of("listing_id", "L-" + i));
        }
        QueryExecutor executor = mock(QueryExecutor.class);
        when(executor.execute(any())).thenReturn(new QueryResult(List.of("listing_id"), rows, true));
        QueryService service = service(executor, "false", "false");
        QueryResponse response = service.query(request("A", 5, "run_preview"));
        assertEquals(21, response.rows().size());
        assertEquals(20, response.receipt().rowsPreview().size());
        assertEquals(21, response.receipt().rowCount());

        Path file = temp.resolve("receipts").resolve(response.receipt().receiptId() + ".json");
        JsonNode stored = mapper.readTree(file.toFile());
        assertEquals(21, stored.get("rows").size());
        assertEquals(20, stored.get("receipt").get("rowsPreview").size());
        assertFalse(stored.get("receipt").has("rows"));
    }

    private QueryService service(QueryExecutor executor, String sampleMode, String recordMode) {
        Environment environment = mock(Environment.class);
        when(environment.getProperty("SAMPLE_MODE")).thenReturn(sampleMode);
        when(environment.getProperty("RECORD_MODE")).thenReturn(recordMode);
        return new QueryService(
                templates,
                validator,
                sqlBuilder,
                executor,
                new SampleStore(mapper, temp.resolve("samples").toString()),
                new ReceiptStore(mapper, temp.resolve("receipts").toString()),
                environment);
    }

    private static QueryRequest request(String batch, int limit, String runId) {
        return new QueryRequest("directory_batch", Map.of("batch", batch, "limit", limit), runId, "lane1");
    }
}
