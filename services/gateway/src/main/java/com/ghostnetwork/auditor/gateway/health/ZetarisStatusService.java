package com.ghostnetwork.auditor.gateway.health;

import com.ghostnetwork.auditor.gateway.zetaris.ZetarisDriverLoader;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class ZetarisStatusService {

    private static final long TIMEOUT_SECONDS = 5;
    private static final long CACHE_NANOS = TimeUnit.SECONDS.toNanos(15);
    private static final Logger log = LoggerFactory.getLogger(ZetarisStatusService.class);

    private final Environment environment;
    private final ZetarisDriverLoader driverLoader;
    private String cachedStatus;
    private long cachedUntilNanos;

    public ZetarisStatusService(Environment environment, ZetarisDriverLoader driverLoader) {
        this.environment = environment;
        this.driverLoader = driverLoader;
    }

    public String zetaris() {
        synchronized (this) {
            long now = System.nanoTime();
            if (cachedStatus != null && now < cachedUntilNanos) {
                return cachedStatus;
            }
            String status = readStatus();
            cachedStatus = status;
            cachedUntilNanos = System.nanoTime() + CACHE_NANOS;
            return status;
        }
    }

    public String mode() {
        return Boolean.parseBoolean(env("SAMPLE_MODE")) ? "sample" : "live";
    }

    private String readStatus() {
        String url = env("ZETARIS_JDBC_URL");
        if (url == null || url.isBlank() || !driverLoader.ready()) {
            return "not_configured";
        }
        return ping(url);
    }

    private String ping(String url) {
        ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "zetaris-ping");
            thread.setDaemon(true);
            return thread;
        });
        String username = env("ZETARIS_USERNAME");
        String password = env("ZETARIS_PASSWORD");
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            log.warn("Zetaris username or password is missing");
        }
        Future<String> future = executor.submit(() -> {
            try (Connection connection = DriverManager.getConnection(url, username, password)) {
                return connection.isValid((int) TIMEOUT_SECONDS) ? "up" : "down";
            } catch (Exception ex) {
                log.warn("Zetaris ping did not succeed ({})", describe(ex));
                return "down";
            }
        });
        try {
            return future.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException ex) {
            future.cancel(true);
            log.warn("Zetaris ping timed out");
            return "down";
        } catch (Exception ex) {
            future.cancel(true);
            log.warn("Zetaris ping did not succeed ({})", describe(ex));
            return "down";
        } finally {
            executor.shutdownNow();
        }
    }

    private String describe(Throwable error) {
        String password = env("ZETARIS_PASSWORD");
        String username = env("ZETARIS_USERNAME");
        StringBuilder builder = new StringBuilder();
        Throwable current = error;
        int depth = 0;
        while (current != null && depth < 8) {
            if (depth > 0) {
                builder.append(" -> ");
            }
            builder.append(current.getClass().getName());
            String message = redact(current.getMessage(), username, password);
            if (message != null) {
                builder.append(": ").append(message);
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
            depth++;
        }
        return builder.toString();
    }

    private static String redact(String message, String username, String password) {
        if (message == null || message.isBlank()) {
            return null;
        }
        String redacted = message;
        if (password != null && !password.isBlank()) {
            redacted = redacted.replace(password, "***");
        }
        if (username != null && !username.isBlank()) {
            redacted = redacted.replace(username, "***");
        }
        return redacted;
    }

    private String env(String key) {
        return environment.getProperty(key);
    }
}
