package com.ghostnetwork.auditor.gateway.zetaris;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.Properties;
import java.util.logging.Logger;

/**
 * Application-class-loader driver that forwards to a driver defined by the isolated loader.
 * DriverManager rejects drivers whose class it cannot see from the caller class loader.
 */
public final class DriverShim implements Driver {

    private final Driver delegate;
    private final ClassLoader isolated;

    public DriverShim(Driver delegate, ClassLoader isolated) {
        this.delegate = delegate;
        this.isolated = isolated;
    }

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        return withDriver(() -> delegate.connect(url, info));
    }

    @Override
    public boolean acceptsURL(String url) throws SQLException {
        return withDriver(() -> delegate.acceptsURL(url));
    }

    @Override
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) throws SQLException {
        return withDriver(() -> delegate.getPropertyInfo(url, info));
    }

    @Override
    public int getMajorVersion() {
        return withDriverUnchecked(delegate::getMajorVersion);
    }

    @Override
    public int getMinorVersion() {
        return withDriverUnchecked(delegate::getMinorVersion);
    }

    @Override
    public boolean jdbcCompliant() {
        return withDriverUnchecked(delegate::jdbcCompliant);
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        try {
            return withDriver(delegate::getParentLogger);
        } catch (SQLFeatureNotSupportedException ex) {
            throw ex;
        } catch (SQLException ex) {
            throw new SQLFeatureNotSupportedException(ex);
        }
    }

    private <T> T withDriver(DriverCall<T> call) throws SQLException {
        Thread current = Thread.currentThread();
        ClassLoader previous = current.getContextClassLoader();
        current.setContextClassLoader(isolated);
        try {
            return call.invoke();
        } finally {
            current.setContextClassLoader(previous);
        }
    }

    private <T> T withDriverUnchecked(DriverCall<T> call) {
        try {
            return withDriver(call);
        } catch (SQLException ex) {
            throw new IllegalStateException(ex);
        }
    }

    @FunctionalInterface
    private interface DriverCall<T> {
        T invoke() throws SQLException;
    }
}
