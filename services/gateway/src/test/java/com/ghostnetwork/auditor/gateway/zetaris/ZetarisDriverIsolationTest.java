package com.ghostnetwork.auditor.gateway.zetaris;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.LoggerContext;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "ZETARIS_JDBC_URL=",
        "ZETARIS_JDBC_DRIVER_CLASS=com.zetaris.lightning.jdbc.LightningDriver",
        "ZETARIS_USERNAME=",
        "ZETARIS_PASSWORD="
})
class ZetarisDriverIsolationTest {

    @DynamicPropertySource
    static void jar(DynamicPropertyRegistry registry) throws Exception {
        Path jar = Files.createTempDirectory("zetaris-slf4j").resolve("driver.jar");
        DriverJars.jarCompiledClass(jar, "org.slf4j.LoggerFactory", """
                package org.slf4j;
                public class LoggerFactory {
                    public static String origin() {
                        return "driver-jar";
                    }
                }
                """);
        registry.add("ZETARIS_JDBC_JAR", jar::toString);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ZetarisDriverLoader loader;

    @Test
    void contextStartsWhenDriverJarBundlesSlf4j() throws Exception {
        assertInstanceOf(LoggerContext.class, LoggerFactory.getILoggerFactory());
        Class<?> isolatedFactory = loader.isolatedClassLoader().loadClass("org.slf4j.LoggerFactory");
        assertNotSame(LoggerFactory.class, isolatedFactory);
        assertSame(loader.isolatedClassLoader(), isolatedFactory.getClassLoader());
        assertSame(ClassLoader.getPlatformClassLoader(), isolatedFactory.getClassLoader().getParent());
        assertInstanceOf(LoggerContext.class, LoggerFactory.getILoggerFactory());
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.zetaris").value("not_configured"));
    }
}
