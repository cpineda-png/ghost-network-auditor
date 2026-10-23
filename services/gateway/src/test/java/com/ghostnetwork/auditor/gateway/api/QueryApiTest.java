package com.ghostnetwork.auditor.gateway.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ghostnetwork.auditor.gateway.query.QueryExecutor;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "SAMPLE_MODE=true",
        "RECORD_MODE=false",
        "ZETARIS_JDBC_URL=",
        "ZETARIS_JDBC_JAR=",
        "ZETARIS_USERNAME=",
        "ZETARIS_PASSWORD=",
        "ZETARIS_DRIVERS_DIR=target/empty-drivers",
        "gna.receipts-dir=target/query-test-receipts",
        "gna.samples-dir=target/query-test-samples"
})
@AutoConfigureMockMvc
class QueryApiTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private QueryExecutor queryExecutor;

    @BeforeEach
    void cleanOutput() throws IOException {
        delete(Path.of("target/query-test-receipts"));
        delete(Path.of("target/query-test-samples"));
    }

    @Test
    void catalogListsThreeTemplates() throws Exception {
        mockMvc.perform(get("/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.templates.length()").value(3))
                .andExpect(jsonPath("$.templates[0].templateId").value("directory_batch"))
                .andExpect(jsonPath("$.templates[0].sources[0]").value("PLAN_PG.directory_listing"))
                .andExpect(jsonPath("$.templates[0].params[0].name").value("batch"))
                .andExpect(jsonPath("$.templates[0].params[0].allowed[0]").value("A"))
                .andExpect(jsonPath("$.templates[0].params[0].allowed[1]").value("B"))
                .andExpect(jsonPath("$.templates[0].params[1].allowed").doesNotExist())
                .andExpect(jsonPath("$.templates[1].templateId").value("roster_by_npis"))
                .andExpect(jsonPath("$.templates[1].sources[0]").value("GNA_FILES.roster"))
                .andExpect(jsonPath("$.templates[1].params[0].type").value("npi[]"))
                .andExpect(jsonPath("$.templates[1].params[0].allowed").doesNotExist())
                .andExpect(jsonPath("$.templates[2].templateId").value("claims_by_npis"))
                .andExpect(jsonPath("$.templates[2].sources[0]").value("GNA_FILES.claims"));
    }

    @Test
    void sampleModeServesTheFixtureWithoutJdbc() throws Exception {
        String body = """
                {"templateId":"directory_batch","params":{"batch":"A","limit":5},"runId":"run_golden","requestedBy":"lane1"}
                """;
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.receipt.receiptId").value("rcpt_0c327279b71647ed"))
                .andExpect(jsonPath("$.receipt.mode").value("replayed"))
                .andExpect(jsonPath("$.receipt.params.offset").value(0))
                .andExpect(jsonPath("$.receipt.params.limit").value(5))
                .andExpect(jsonPath("$.receipt.params.county").doesNotExist())
                .andExpect(jsonPath("$.receipt.sql", containsString("LIMIT 5")))
                .andExpect(jsonPath("$.receipt.sql", not(containsString("OFFSET"))))
                .andExpect(jsonPath("$.receipt.sources[0]").value("PLAN_PG.directory_listing"))
                .andExpect(jsonPath("$.receipt.rowCount").value(1))
                .andExpect(jsonPath("$.columns[0]").value("listing_id"))
                .andExpect(jsonPath("$.rows[0].listing_id").value("L-00001"));
        verifyNoInteractions(queryExecutor);

        mockMvc.perform(get("/receipts/rcpt_0c327279b71647ed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.receiptId").value("rcpt_0c327279b71647ed"))
                .andExpect(jsonPath("$.rowsPreview[0].listing_id").value("L-00001"))
                .andExpect(jsonPath("$.rows").doesNotExist())
                .andExpect(jsonPath("$.columns").doesNotExist());
    }

    @Test
    void missingReceiptIs404() throws Exception {
        mockMvc.perform(get("/receipts/rcpt_0000000000000000"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/receipts/not-a-receipt"))
                .andExpect(status().isNotFound());
    }

    @Test
    void invalidQueriesAre400() throws Exception {
        rejected(
                """
                {"templateId":"directory_batch","params":{"batch":"C"},"runId":"run_golden","requestedBy":"lane1"}
                """,
                "batch is not an allowed value");
        rejected(
                """
                {"templateId":"roster_by_npis","params":{"npis":["12345"]},"runId":"run_golden","requestedBy":"lane1"}
                """,
                "npis must be 10-digit strings");
        rejected(
                """
                {"templateId":"roster_by_npis","params":{"npis":["1234567890","1234567890","1234567890","1234567890","1234567890","1234567890","1234567890","1234567890","1234567890","1234567890","1234567890"]},"runId":"run_golden","requestedBy":"lane1"}
                """,
                "npis must contain 1 to 10 values");
        rejected(
                """
                {"templateId":"directory_batch","params":{"batch":"A","table":"directory_listing"},"runId":"run_golden","requestedBy":"lane1"}
                """,
                "Unknown param: table");
        rejected(
                """
                {"templateId":"directory_batch","params":{"batch":"A","specialty":"select all"},"runId":"run_golden","requestedBy":"lane1"}
                """,
                "specialty is not an allowed value");
        verifyNoInteractions(queryExecutor);
    }

    @Test
    void missingSampleIs503() throws Exception {
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content("""
                {"templateId":"directory_batch","params":{"batch":"B","limit":1},"runId":"run_missing","requestedBy":"lane1"}
                """))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.message").value("No sample is recorded for this query"));
        verifyNoInteractions(queryExecutor);
    }

    @Test
    void replayStaysNotImplemented() throws Exception {
        mockMvc.perform(post("/replay/rcpt_0c327279b71647ed"))
                .andExpect(status().isNotImplemented());
    }

    private void rejected(String body, String message) throws Exception {
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(message));
    }

    private static void delete(Path root) throws IOException {
        if (!Files.exists(root)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(root)) {
            walk.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ex) {
                    throw new UncheckedIOException(ex);
                }
            });
        }
    }
}
