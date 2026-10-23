package com.ghostnetwork.auditor.gateway.zetaris;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ZetarisHealthTimeoutTest {

    @DynamicPropertySource
    static void jar(DynamicPropertyRegistry registry) throws Exception {
        Path jar = Files.createTempDirectory("zetaris-slow").resolve("slow.jar");
        DriverJars.jarClass(jar, SlowDriver.class);
        registry.add("ZETARIS_JDBC_JAR", jar::toString);
        registry.add("ZETARIS_JDBC_DRIVER_CLASS", () -> SlowDriver.class.getName());
        registry.add("ZETARIS_JDBC_URL", () -> "jdbc:slow:x");
        registry.add("ZETARIS_USERNAME", () -> "");
        registry.add("ZETARIS_PASSWORD", () -> "");
    }

    @Autowired
    private MockMvc mockMvc;

    @Test
    @Timeout(value = 8, unit = TimeUnit.SECONDS)
    void slowConnectMakesHealthDown() throws Exception {
        long started = System.nanoTime();
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.zetaris").value("down"));
        long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        assertTrue(elapsedMs < 7000, "health returned in " + elapsedMs + " ms");
        assertTrue(elapsedMs >= 4500, "health returned in " + elapsedMs + " ms");
    }
}
