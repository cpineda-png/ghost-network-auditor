package com.ghostnetwork.auditor.gateway.zetaris;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.Properties;
import java.util.logging.Logger;

public class FakeDriver implements Driver {

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        if (!acceptsURL(url)) {
            return null;
        }
        ClassLoader context = Thread.currentThread().getContextClassLoader();
        System.setProperty("gna.fake.connected", "true");
        System.setProperty("gna.fake.tccl", context == null ? "null" : context.getClass().getName());
        return (Connection) Proxy.newProxyInstance(
                FakeDriver.class.getClassLoader(),
                new Class<?>[] {Connection.class},
                new ConnectionHandler());
    }

    @Override
    public boolean acceptsURL(String url) {
        return url != null && url.startsWith("jdbc:fake:");
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
        return true;
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException();
    }

    private static final class ConnectionHandler implements InvocationHandler {
        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            String name = method.getName();
            if ("isValid".equals(name)) {
                return true;
            }
            if ("close".equals(name)) {
                return null;
            }
            if ("toString".equals(name)) {
                return "FakeConnection";
            }
            if ("hashCode".equals(name)) {
                return System.identityHashCode(proxy);
            }
            if ("equals".equals(name)) {
                return proxy == args[0];
            }
            Class<?> returnType = method.getReturnType();
            if (returnType.equals(boolean.class)) {
                return false;
            }
            if (returnType.equals(int.class) || returnType.equals(short.class) || returnType.equals(byte.class)) {
                return 0;
            }
            if (returnType.equals(long.class)) {
                return 0L;
            }
            if (returnType.equals(float.class)) {
                return 0f;
            }
            if (returnType.equals(double.class)) {
                return 0d;
            }
            return null;
        }
    }
}
