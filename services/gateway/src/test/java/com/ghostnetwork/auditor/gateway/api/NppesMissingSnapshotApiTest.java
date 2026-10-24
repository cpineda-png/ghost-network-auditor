package com.ghostnetwork.auditor.gateway.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "SAMPLE_MODE=true",
        "RECORD_MODE=false",
        "ZETARIS_JDBC_URL=",
        "ZETARIS_JDBC_JAR=",
        "ZETARIS_USERNAME=",
        "ZETARIS_PASSWORD=",
        "ZETARIS_DRIVERS_DIR=target/empty-drivers",
        "gna.receipts-dir=target/nppes-missing-receipts",
        "gna.samples-dir=target/nppes-missing-samples",
        "gna.nppes-snapshot=target/does-not-exist-nppes.json"
})
@AutoConfigureMockMvc
class NppesMissingSnapshotApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void missingSnapshotIs503() throws Exception {
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content("""
                {"templateId":"nppes_by_npis","params":{"npis":["8000000009"]},"runId":"run_missing_snapshot","requestedBy":"lane1"}
                """))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.message").value("NPPES snapshot is not available"));
    }
}
