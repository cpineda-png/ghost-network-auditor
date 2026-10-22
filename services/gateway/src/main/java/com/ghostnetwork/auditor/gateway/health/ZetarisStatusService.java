package com.ghostnetwork.auditor.gateway.health;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class ZetarisStatusService {

    private static final long TIMEOUT_SECONDS = 5;

    private final Environment environment;

    public ZetarisStatusService(Environment environment) {
        this.environment = environment;
    }

    public String zetaris() {
        String url = env("ZETARIS_JDBC_URL");
        if (url == null || url.isBlank()) {
            return "not_configured";
        }
        if (!driverAvailable()) {
            return "not_configured";
        }
        return ping(url);
    }

    public String mode() {
        return Boolean.parseBoolean(env("SAMPLE_MODE")) ? "sample" : "live";
    }

    private boolean driverAvailable() {
        String driverClass = env("ZETARIS_JDBC_DRIVER_CLASS");
        if (driverClass != null && !driverClass.isBlank()) {
            try {
                Class.forName(driverClass);
                return true;
            } catch (ClassNotFoundException ex) {
                return false;
            }
        }
        Path driversDir = driversDirectory();
        if (!Files.isDirectory(driversDir)) {
            return false;
        }
        try (var files = Files.list(driversDir)) {
            return files.anyMatch(path -> path.getFileName().toString().endsWith(".jar"));
        } catch (IOException ex) {
            return false;
        }
    }

    private Path driversDirectory() {
        String loaderPath = System.getProperty("loader.path");
        if (loaderPath != null && !loaderPath.isBlank()) {
            return Path.of(loaderPath.split(",")[0].trim());
        }
        return Path.of("/drivers");
    }

    private String ping(String url) {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Callable<String> task = () -> {
            String username = env("ZETARIS_USERNAME");
            String password = env("ZETARIS_PASSWORD");
            try (Connection connection = DriverManager.getConnection(url, username, password)) {
                return connection.isValid((int) TIMEOUT_SECONDS) ? "up" : "down";
            } catch (Exception ex) {
                return "down";
            }
        };
        Future<String> future = executor.submit(task);
        try {
            return future.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException ex) {
            future.cancel(true);
            return "down";
        } catch (Exception ex) {
            return "down";
        } finally {
            executor.shutdownNow();
        }
    }

    private String env(String key) {
        return environment.getProperty(key);
    }
}
