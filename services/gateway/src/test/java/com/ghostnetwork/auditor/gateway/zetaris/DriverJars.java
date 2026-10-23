package com.ghostnetwork.auditor.gateway.zetaris;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.stream.Stream;
import javax.tools.ToolProvider;

final class DriverJars {

    private DriverJars() {}

    static void empty(Path jar) throws IOException {
        if (jar.getParent() != null) {
            Files.createDirectories(jar.getParent());
        }
        try (JarOutputStream out = new JarOutputStream(Files.newOutputStream(jar))) {
            out.flush();
        }
    }

    static void jarClass(Path jar, Class<?> type) throws IOException {
        Path root;
        try {
            root = Path.of(type.getProtectionDomain().getCodeSource().getLocation().toURI());
        } catch (URISyntaxException ex) {
            throw new IOException(ex);
        }
        Path classFile = root.resolve(type.getName().replace('.', '/') + ".class");
        Path directory = classFile.getParent();
        String simpleName = type.getSimpleName();
        if (jar.getParent() != null) {
            Files.createDirectories(jar.getParent());
        }
        try (JarOutputStream out = new JarOutputStream(Files.newOutputStream(jar));
                Stream<Path> files = Files.list(directory)) {
            List<Path> matches = files
                    .filter(path -> {
                        String name = path.getFileName().toString();
                        return name.endsWith(".class")
                                && (name.equals(simpleName + ".class") || name.startsWith(simpleName + "$"));
                    })
                    .toList();
            if (matches.isEmpty()) {
                throw new IOException("No class files for " + type.getName());
            }
            for (Path match : matches) {
                String entry = root.relativize(match).toString().replace('\\', '/');
                out.putNextEntry(new JarEntry(entry));
                Files.copy(match, out);
                out.closeEntry();
            }
        }
    }

    static void jarCompiledClass(Path jar, String className, String source) throws IOException {
        var compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("A JDK compiler is required to build the driver fixture");
        }
        Path work = Files.createTempDirectory("zetaris-compile");
        Path sourceFile = work.resolve(className.replace('.', '/') + ".java");
        Files.createDirectories(sourceFile.getParent());
        Files.writeString(sourceFile, source);
        Path classes = work.resolve("classes");
        Files.createDirectories(classes);
        ByteArrayOutputStream errors = new ByteArrayOutputStream();
        int exit = compiler.run(null, null, errors, "-d", classes.toString(), sourceFile.toString());
        if (exit != 0) {
            throw new IOException(errors.toString(StandardCharsets.UTF_8));
        }
        if (jar.getParent() != null) {
            Files.createDirectories(jar.getParent());
        }
        String entry = className.replace('.', '/') + ".class";
        try (JarOutputStream out = new JarOutputStream(Files.newOutputStream(jar))) {
            out.putNextEntry(new JarEntry(entry));
            Files.copy(classes.resolve(entry), out);
            out.closeEntry();
        }
    }
}
