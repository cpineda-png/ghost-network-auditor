package com.ghostnetwork.auditor.gateway.zetaris;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ZetarisMissingDriverConfigTest {

    @DynamicPropertySource
    static void missingJar(DynamicPropertyRegistry registry) {
        registry.add("ZETARIS_JDBC_URL", () -> "jdbc:zetaris:lightning@localhost:10000");
        registry.add("ZETARIS_JDBC_JAR", () -> Path.of("target", "does-not-exist-zetaris.jar").toAbsolutePath().toString());
        registry.add("ZETARIS_JDBC_DRIVER_CLASS", () -> "com.zetaris.lightning.jdbc.LightningDriver");
        registry.add("ZETARIS_USERNAME", () -> "");
        registry.add("ZETARIS_PASSWORD", () -> "");
    }

    @Autowired
    private MockMvc mockMvc;

    @Test
    void missingJarIsNotConfigured() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.zetaris").value("not_configured"));
    }
}
