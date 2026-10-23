package com.ghostnetwork.auditor.gateway.zetaris;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Loads the Zetaris JDBC driver from its own class loader so the JAR's SLF4J 1.x
 * and Commons Logging stay off the Spring Boot classpath.
 */
@Component
public class ZetarisDriverLoader {

    static final String DEFAULT_DRIVER_CLASS = "com.zetaris.lightning.jdbc.LightningDriver";
    static final String DEFAULT_DRIVERS_DIR = "/drivers";

    private static final Logger log = LoggerFactory.getLogger(ZetarisDriverLoader.class);

    private final Environment environment;
    private final Object monitor = new Object();

    private URLClassLoader isolated;
    private Driver shim;
    private Class<?> driverClass;
    private boolean attempted;
    private boolean ready;
    private boolean usedFallback;

    public ZetarisDriverLoader(Environment environment) {
        this.environment = environment;
    }

    @PostConstruct
    public void load() {
        synchronized (monitor) {
            if (attempted) {
                return;
            }
            attempted = true;
            try {
                doLoad();
            } catch (Exception ex) {
                ready = false;
                log.warn("Zetaris JDBC driver was not loaded ({})", ex.getClass().getSimpleName());
            }
        }
    }

    @PreDestroy
    public void shutdown() {
        synchronized (monitor) {
            if (shim != null) {
                try {
                    DriverManager.deregisterDriver(shim);
                } catch (SQLException ex) {
                    log.warn("Could not deregister the Zetaris JDBC driver ({})", ex.getClass().getSimpleName());
                }
                shim = null;
            }
            if (isolated != null) {
                try {
                    isolated.close();
                } catch (IOException ex) {
                    log.warn("Could not close the Zetaris driver class loader ({})", ex.getClass().getSimpleName());
                }
                isolated = null;
            }
            ready = false;
        }
    }

    public boolean ready() {
        load();
        return ready;
    }

    public Class<?> driverClass() {
        load();
        return driverClass;
    }

    public ClassLoader isolatedClassLoader() {
        load();
        return isolated;
    }

    public boolean usedFallback() {
        load();
        return usedFallback;
    }

    private void doLoad() throws IOException {
        Path jar = resolveJar();
        if (jar == null || !Files.isRegularFile(jar)) {
            log.warn("Zetaris JDBC driver JAR is missing");
            return;
        }
        String className = driverClassName();
        URL url = jar.toUri().toURL();
        URLClassLoader primary = new URLClassLoader(new URL[] {url}, ClassLoader.getPlatformClassLoader());
        isolated = primary;
        try {
            register(primary, className, jar, false);
        } catch (Exception | LinkageError ex) {
            String jdkClass = missingJdkClass(ex);
            if (jdkClass == null) {
                log.warn("Zetaris JDBC driver {} was not loaded from {}: {}", className, jar, safeReason(ex));
                return;
            }
            log.warn("Zetaris driver could not see JDK class {}; retrying with a child-first loader", jdkClass);
            closeQuietly(primary);
            URLClassLoader fallback = new ChildFirstLoggingClassLoader(new URL[] {url});
            isolated = fallback;
            try {
                register(fallback, className, jar, true);
            } catch (Exception | LinkageError second) {
                log.warn("Zetaris JDBC driver {} was not loaded from {}: {}", className, jar, safeReason(second));
            }
        }
    }

    private void register(URLClassLoader loader, String className, Path jar, boolean fallback) throws Exception {
        Thread current = Thread.currentThread();
        ClassLoader previous = current.getContextClassLoader();
        current.setContextClassLoader(loader);
        try {
            Class<?> type = Class.forName(className, true, loader);
            if (!Driver.class.isAssignableFrom(type)) {
                throw new ClassNotFoundException(className);
            }
            Driver driver = (Driver) type.getDeclaredConstructor().newInstance();
            DriverShim wrapped = new DriverShim(driver, loader);
            DriverManager.registerDriver(wrapped);
            shim = wrapped;
            driverClass = type;
            ready = true;
            usedFallback = fallback;
            if (fallback) {
                log.info("Loaded Zetaris JDBC driver {} from {} with the child-first loader", className, jar);
            } else {
                log.info("Loaded Zetaris JDBC driver {} from {}", className, jar);
            }
        } finally {
            current.setContextClassLoader(previous);
        }
    }

    private Path resolveJar() throws IOException {
        String configured = blankToNull(environment.getProperty("ZETARIS_JDBC_JAR"));
        if (configured != null) {
            return Path.of(configured);
        }
        String directory = blankToNull(environment.getProperty("ZETARIS_DRIVERS_DIR"));
        Path driversDir = directory == null ? Path.of(DEFAULT_DRIVERS_DIR) : Path.of(directory);
        if (!Files.isDirectory(driversDir)) {
            log.warn("Zetaris drivers directory {} is missing", driversDir);
            return null;
        }
        List<Path> jars;
        try (var stream = Files.list(driversDir)) {
            jars = stream
                    .filter(path -> Files.isRegularFile(path) && path.getFileName().toString().endsWith(".jar"))
                    .toList();
        }
        if (jars.size() != 1) {
            log.warn("Expected one JAR in {} but found {}", driversDir, jars.size());
            return null;
        }
        return jars.get(0);
    }

    private String driverClassName() {
        String configured = blankToNull(environment.getProperty("ZETARIS_JDBC_DRIVER_CLASS"));
        return configured == null ? DEFAULT_DRIVER_CLASS : configured;
    }

    private void closeQuietly(URLClassLoader loader) {
        try {
            loader.close();
        } catch (IOException ex) {
            log.warn("Could not close the Zetaris driver class loader ({})", ex.getClass().getSimpleName());
        }
    }

    private static String missingJdkClass(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof ClassNotFoundException || current instanceof NoClassDefFoundError) {
                String name = className(current.getMessage());
                if (name != null && isJdkClass(name)) {
                    return name;
                }
            }
            current = current.getCause();
        }
        return null;
    }

    private static String className(String message) {
        if (message == null) {
            return null;
        }
        String name = message.trim().replace('/', '.');
        if (name.isEmpty() || name.indexOf(' ') >= 0 || name.indexOf(':') >= 0) {
            return null;
        }
        return name;
    }

    private static boolean isJdkClass(String name) {
        return name.startsWith("java.")
                || name.startsWith("javax.")
                || name.startsWith("jdk.")
                || name.startsWith("sun.")
                || name.startsWith("com.sun.")
                || name.startsWith("org.w3c.")
                || name.startsWith("org.xml.")
                || name.startsWith("org.ietf.jgss.");
    }

    private static String safeReason(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String message = root.getMessage();
        if (message == null || message.isBlank()) {
            return root.getClass().getSimpleName();
        }
        return root.getClass().getSimpleName() + ": " + message;
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
