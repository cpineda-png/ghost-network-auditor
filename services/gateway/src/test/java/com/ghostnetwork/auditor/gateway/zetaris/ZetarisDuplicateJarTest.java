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
class ZetarisDuplicateJarTest {

    @DynamicPropertySource
    static void twoJars(DynamicPropertyRegistry registry) throws Exception {
        Path directory = Files.createTempDirectory("zetaris-two-jars");
        DriverJars.empty(directory.resolve("a.jar"));
        DriverJars.empty(directory.resolve("b.jar"));
        registry.add("ZETARIS_JDBC_URL", () -> "jdbc:zetaris:lightning@localhost:10000");
        registry.add("ZETARIS_JDBC_JAR", () -> "");
        registry.add("ZETARIS_DRIVERS_DIR", () -> directory.toString());
        registry.add("ZETARIS_JDBC_DRIVER_CLASS", () -> "com.zetaris.lightning.jdbc.LightningDriver");
        registry.add("ZETARIS_USERNAME", () -> "");
        registry.add("ZETARIS_PASSWORD", () -> "");
    }

    @Autowired
    private MockMvc mockMvc;

    @Test
    void twoJarsWithVariableUnsetIsNotConfigured() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.zetaris").value("not_configured"));
    }
}
