package com.ghostnetwork.auditor.gateway.zetaris;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class ZetarisFakeDriverTest {

    @DynamicPropertySource
    static void jar(DynamicPropertyRegistry registry) throws Exception {
        Path jar = Files.createTempDirectory("zetaris-fake").resolve("fake.jar");
        DriverJars.jarClass(jar, FakeDriver.class);
        registry.add("ZETARIS_JDBC_JAR", jar::toString);
        registry.add("ZETARIS_JDBC_DRIVER_CLASS", () -> FakeDriver.class.getName());
        registry.add("ZETARIS_JDBC_URL", () -> "jdbc:fake:x");
        registry.add("ZETARIS_USERNAME", () -> "");
        registry.add("ZETARIS_PASSWORD", () -> "");
    }

    @Autowired
    private ZetarisDriverLoader loader;

    @AfterAll
    static void clearMarker() {
        System.clearProperty("gna.fake.connected");
        System.clearProperty("gna.fake.tccl");
    }

    @Test
    void connectionGoesThroughTheShim() throws Exception {
        assertInstanceOf(DriverShim.class, DriverManager.getDriver("jdbc:fake:x"));
        try (Connection connection = DriverManager.getConnection("jdbc:fake:x")) {
            assertNotNull(connection);
            assertTrue(connection.isValid(1));
        }
        Class<?> loaded = loader.driverClass();
        assertNotSame(FakeDriver.class, loaded);
        assertEquals(FakeDriver.class.getName(), loaded.getName());
        assertSame(loader.isolatedClassLoader(), loaded.getClassLoader());
        assertNotSame(FakeDriver.class.getClassLoader(), loaded.getClassLoader());
        assertSame(ClassLoader.getPlatformClassLoader(), loaded.getClassLoader().getParent());
        assertFalse(loader.usedFallback());
        assertEquals("true", System.getProperty("gna.fake.connected"));
        assertEquals("java.net.URLClassLoader", System.getProperty("gna.fake.tccl"));
    }
}
