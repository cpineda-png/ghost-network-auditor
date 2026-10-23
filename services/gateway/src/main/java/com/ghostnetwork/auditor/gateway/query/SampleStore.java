package com.ghostnetwork.auditor.gateway.query;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
public class SampleStore {

    private static final Pattern TEMPLATE_ID = Pattern.compile("^[a-z0-9_]+$");
    private static final Pattern SAMPLE_KEY = Pattern.compile("^[0-9a-f]{16}$");

    private final ObjectMapper mapper;
    private final Path samplesDir;

    public SampleStore(ObjectMapper mapper, @Value("${gna.samples-dir}") String samplesDir) {
        this.mapper = mapper;
        this.samplesDir = Path.of(samplesDir);
    }

    public Optional<Sample> read(String templateId, String canonicalParams) {
        String key = ReceiptIds.sampleKey(canonicalParams);
        requireKey(templateId, key);
        Path file = samplesDir.resolve(templateId).resolve(key + ".json");
        if (Files.isRegularFile(file)) {
            return Optional.of(read(file));
        }
        ClassPathResource resource = new ClassPathResource("samples/" + templateId + "/" + key + ".json");
        if (!resource.exists()) {
            return Optional.empty();
        }
        try (InputStream input = resource.getInputStream()) {
            return Optional.of(parse(input));
        } catch (IOException ex) {
            throw new QueryUnavailableException("Recorded sample could not be read", ex);
        }
    }

    public void record(String templateId, String canonicalParams, List<String> columns, List<Map<String, String>> rows) {
        String key = ReceiptIds.sampleKey(canonicalParams);
        requireKey(templateId, key);
        Path directory = samplesDir.resolve(templateId);
        Path target = directory.resolve(key + ".json");
        try {
            Files.createDirectories(directory);
            write(target, new SampleDocument(columns, copyRows(rows)));
        } catch (IOException ex) {
            throw new QueryUnavailableException("Recorded sample could not be written", ex);
        }
    }

    private Sample read(Path file) {
        try (InputStream input = Files.newInputStream(file)) {
            return parse(input);
        } catch (IOException ex) {
            throw new QueryUnavailableException("Recorded sample could not be read", ex);
        }
    }

    private Sample parse(InputStream input) throws IOException {
        SampleDocument document = mapper.readValue(input, SampleDocument.class);
        if (document.columns() == null || document.rows() == null) {
            throw new IOException("Sample is missing columns or rows");
        }
        List<Map<String, String>> rows = new ArrayList<>();
        for (Map<String, Object> row : document.rows()) {
            if (row == null) {
                throw new IOException("Sample row is null");
            }
            Map<String, String> normalized = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : row.entrySet()) {
                normalized.put(entry.getKey(), JdbcValues.convert(entry.getValue()));
            }
            rows.add(normalized);
        }
        return new Sample(List.copyOf(document.columns()), List.copyOf(rows));
    }

    private static List<Map<String, Object>> copyRows(List<Map<String, String>> rows) {
        List<Map<String, Object>> copy = new ArrayList<>();
        for (Map<String, String> row : rows) {
            copy.add(new LinkedHashMap<>(row));
        }
        return copy;
    }

    private void write(Path target, SampleDocument document) throws IOException {
        Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
        try (OutputStream output = Files.newOutputStream(temporary)) {
            mapper.writeValue(output, document);
        }
        try {
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ex) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void requireKey(String templateId, String key) {
        if (templateId == null || !TEMPLATE_ID.matcher(templateId).matches() || !SAMPLE_KEY.matcher(key).matches()) {
            throw new IllegalStateException("Refusing sample path");
        }
    }

    public record Sample(List<String> columns, List<Map<String, String>> rows) {
    }

    public record SampleDocument(List<String> columns, List<Map<String, Object>> rows) {
    }
}
