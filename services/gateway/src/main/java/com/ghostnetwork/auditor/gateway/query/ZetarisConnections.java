package com.ghostnetwork.auditor.gateway.query;

import com.ghostnetwork.auditor.gateway.zetaris.ZetarisDriverLoader;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class ZetarisConnections implements ConnectionFactory {

    private static final Logger log = LoggerFactory.getLogger(ZetarisConnections.class);

    private final Environment environment;
    private final ZetarisDriverLoader driverLoader;

    public ZetarisConnections(Environment environment, ZetarisDriverLoader driverLoader) {
        this.environment = environment;
        this.driverLoader = driverLoader;
    }

    @Override
    public Connection open() {
        if (!driverLoader.ready()) {
            throw new ConnectionFailedException("Zetaris is not configured");
        }
        String url = environment.getProperty("ZETARIS_JDBC_URL");
        if (url == null || url.isBlank()) {
            throw new ConnectionFailedException("Zetaris is not configured");
        }
        String username = environment.getProperty("ZETARIS_USERNAME");
        String password = environment.getProperty("ZETARIS_PASSWORD");
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            log.warn("Zetaris username or password is missing");
        }
        try {
            return DriverManager.getConnection(url, username, password);
        } catch (SQLException ex) {
            throw new ConnectionFailedException("Zetaris query failed", ex);
        }
    }

    @Override
    public ClassLoader contextClassLoader() {
        return driverLoader.isolatedClassLoader();
    }
}
