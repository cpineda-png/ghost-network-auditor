package com.ghostnetwork.auditor.gateway.api;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ghostnetwork.auditor.gateway.query.QueryExecutor;
import com.ghostnetwork.auditor.gateway.query.QueryFailedException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Comparator;
import java.util.stream.Stream;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "SAMPLE_MODE=false",
        "RECORD_MODE=false",
        "ZETARIS_JDBC_URL=",
        "ZETARIS_JDBC_JAR=",
        "ZETARIS_USERNAME=",
        "ZETARIS_PASSWORD=",
        "ZETARIS_DRIVERS_DIR=target/empty-drivers",
        "gna.receipts-dir=target/query-fail-receipts",
        "gna.samples-dir=target/query-fail-samples"
})
@AutoConfigureMockMvc
class QueryFailureApiTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private QueryExecutor queryExecutor;

    @BeforeEach
    void cleanOutput() throws IOException {
        delete(Path.of("target/query-fail-receipts"));
        delete(Path.of("target/query-fail-samples"));
    }

    @Test
    void tableNotFoundIs502WithNoReceipt() throws Exception {
        when(queryExecutor.execute(any())).thenThrow(new QueryFailedException(
                "TABLE_OR_VIEW_NOT_FOUND",
                null,
                new SQLException("[TABLE_OR_VIEW_NOT_FOUND] missing")));
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content("""
                {"templateId":"directory_batch","params":{"batch":"A","limit":5},"runId":"run_table","requestedBy":"lane1"}
                """))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("TABLE_OR_VIEW_NOT_FOUND"))
                .andExpect(jsonPath("$.templateId").value("directory_batch"))
                .andExpect(jsonPath("$.sqlState").value(nullValue()));
        Assertions.assertFalse(Files.exists(Path.of("target/query-fail-receipts")));
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
