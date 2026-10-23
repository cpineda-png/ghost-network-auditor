package com.ghostnetwork.auditor.gateway.zetaris;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.Properties;
import java.util.logging.Logger;

public class SlowDriver implements Driver {

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        if (url == null || !url.startsWith("jdbc:slow:")) {
            return null;
        }
        try {
            Thread.sleep(10_000);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new SQLException("interrupted", ex);
        }
        throw new SQLException("slow driver was not timed out");
    }

    @Override
    public boolean acceptsURL(String url) {
        return url != null && url.startsWith("jdbc:slow:");
    }

    @Override
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
        return new DriverPropertyInfo[0];
    }

    @Override
    public int getMajorVersion() {
        return 1;
    }

    @Override
    public int getMinorVersion() {
        return 0;
    }

    @Override
    public boolean jdbcCompliant() {
        return false;
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException();
    }
}
