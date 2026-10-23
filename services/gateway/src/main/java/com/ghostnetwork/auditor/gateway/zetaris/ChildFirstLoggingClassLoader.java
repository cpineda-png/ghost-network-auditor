package com.ghostnetwork.auditor.gateway.zetaris;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * Child-first loader used only when the driver cannot see a JDK class through the platform loader.
 * Logging packages are always taken from the driver JAR, never from Spring's classpath.
 */
final class ChildFirstLoggingClassLoader extends URLClassLoader {

    ChildFirstLoggingClassLoader(URL[] urls) {
        super(urls, ClassLoader.getSystemClassLoader());
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        synchronized (getClassLoadingLock(name)) {
            Class<?> loaded = findLoadedClass(name);
            if (loaded == null) {
                if (isolatedName(name)) {
                    loaded = findClass(name);
                } else if (name.startsWith("java.")) {
                    loaded = super.loadClass(name, false);
                } else {
                    try {
                        loaded = findClass(name);
                    } catch (ClassNotFoundException ex) {
                        loaded = super.loadClass(name, false);
                    }
                }
            }
            if (resolve) {
                resolveClass(loaded);
            }
            return loaded;
        }
    }

    @Override
    public URL getResource(String name) {
        if (isolatedResource(name)) {
            return findResource(name);
        }
        URL local = findResource(name);
        if (local != null) {
            return local;
        }
        return super.getResource(name);
    }

    @Override
    public Enumeration<URL> getResources(String name) throws IOException {
        if (isolatedResource(name)) {
            Enumeration<URL> local = findResources(name);
            if (!local.hasMoreElements()) {
                return Collections.emptyEnumeration();
            }
            return local;
        }
        List<URL> urls = new ArrayList<>();
        Enumeration<URL> local = findResources(name);
        while (local.hasMoreElements()) {
            urls.add(local.nextElement());
        }
        ClassLoader parent = getParent();
        if (parent != null) {
            Enumeration<URL> parents = parent.getResources(name);
            while (parents.hasMoreElements()) {
                URL next = parents.nextElement();
                if (!urls.contains(next)) {
                    urls.add(next);
                }
            }
        }
        return Collections.enumeration(urls);
    }

    private static boolean isolatedName(String name) {
        return name.equals("org.slf4j") || name.startsWith("org.slf4j.")
                || name.equals("org.apache.commons.logging") || name.startsWith("org.apache.commons.logging.")
                || name.equals("ch.qos.logback") || name.startsWith("ch.qos.logback.")
                || name.equals("org.apache.log4j") || name.startsWith("org.apache.log4j.");
    }

    private static boolean isolatedResource(String name) {
        return name.startsWith("org/slf4j/")
                || name.startsWith("org/apache/commons/logging/")
                || name.startsWith("ch/qos/logback/")
                || name.startsWith("org/apache/log4j/");
    }
}
