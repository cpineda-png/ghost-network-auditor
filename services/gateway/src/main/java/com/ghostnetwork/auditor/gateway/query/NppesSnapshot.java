package com.ghostnetwork.auditor.gateway.query;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** NPPES v2.1 snapshot. A missing file is reported once at startup and queries then return 503. */
@Component
public class NppesSnapshot {

    private static final Logger log = LoggerFactory.getLogger(NppesSnapshot.class);

    private final boolean available;
    private final Map<String, JsonNode> byNumber;

    @Autowired
    public NppesSnapshot(ObjectMapper mapper, @Value("${gna.nppes-snapshot:}") String configured) {
        this(mapper, configured, Path.of("").toAbsolutePath());
    }

    NppesSnapshot(ObjectMapper mapper, String configured, Path cwd) {
        Path path = resolve(configured, cwd);
        Loaded loaded = read(mapper, path);
        this.available = loaded.available();
        this.byNumber = loaded.byNumber();
        if (!loaded.found()) {
            log.warn("NPPES snapshot is missing: {}", path.toAbsolutePath().normalize());
        } else if (!loaded.available()) {
            log.warn("NPPES snapshot could not be read: {}", path.toAbsolutePath().normalize());
        }
    }

    public List<Map<String, String>> rows(List<String> npis) {
        if (!available) {
            throw new QueryUnavailableException("NPPES snapshot is not available");
        }
        List<Map<String, String>> rows = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String npi : npis) {
            if (!seen.add(npi)) {
                continue;
            }
            JsonNode result = byNumber.get(npi);
            if (result != null) {
                rows.add(toRow(result));
            }
        }
        return List.copyOf(rows);
    }

    static String describe(List<String> npis) {
        StringBuilder sql = new StringBuilder("SNAPSHOT nppes WHERE number IN (");
        for (int i = 0; i < npis.size(); i++) {
            if (i > 0) {
                sql.append(", ");
            }
            sql.append(SqlBuilder.literal(npis.get(i)));
        }
        sql.append(')');
        return sql.toString();
    }

    static Path resolve(String configured, Path cwd) {
        if (configured != null && !configured.isBlank()) {
            return Path.of(configured);
        }
        return defaultPath(cwd);
    }

    static Path defaultPath(Path cwd) {
        Path base = cwd.toAbsolutePath().normalize();
        Path fromRoot = base.resolve("data").resolve("sample").resolve("nppes_snapshot.json");
        if (Files.isRegularFile(fromRoot)) {
            return fromRoot;
        }
        Path fromGateway = base.resolve("..").resolve("..").resolve("data").resolve("sample").resolve("nppes_snapshot.json")
                .normalize();
        if (Files.isRegularFile(fromGateway)) {
            return fromGateway;
        }
        return fromRoot;
    }

    private static Loaded read(ObjectMapper mapper, Path path) {
        if (!Files.isRegularFile(path)) {
            return new Loaded(false, false, Map.of());
        }
        try (InputStream input = Files.newInputStream(path)) {
            JsonNode root = mapper.readTree(input);
            Map<String, JsonNode> byNumber = new LinkedHashMap<>();
            JsonNode results = root == null ? null : root.get("results");
            if (results != null && results.isArray()) {
                for (JsonNode result : results) {
                    String number = text(result.get("number"));
                    if (number != null) {
                        byNumber.putIfAbsent(number, result);
                    }
                }
            }
            return new Loaded(true, true, Map.copyOf(byNumber));
        } catch (IOException ex) {
            return new Loaded(true, false, Map.of());
        }
    }

    static Map<String, String> toRow(JsonNode result) {
        JsonNode basic = result.get("basic");
        JsonNode location = address(result, "LOCATION");
        JsonNode mailing = address(result, "MAILING");
        JsonNode taxonomy = taxonomy(result);
        Map<String, String> row = new LinkedHashMap<>();
        row.put("npi", text(result.get("number")));
        row.put("enumeration_type", text(result.get("enumeration_type")));
        row.put("name", name(result, basic));
        row.put("taxonomy_code", text(taxonomy == null ? null : taxonomy.get("code")));
        row.put("taxonomy_desc", text(taxonomy == null ? null : taxonomy.get("desc")));
        row.put("location_address_1", text(location == null ? null : location.get("address_1")));
        row.put("location_zip", text(location == null ? null : location.get("postal_code")));
        row.put("location_phone", text(location == null ? null : location.get("telephone_number")));
        row.put("mailing_address_1", text(mailing == null ? null : mailing.get("address_1")));
        return row;
    }

    private static String name(JsonNode result, JsonNode basic) {
        if ("NPI-2".equals(text(result.get("enumeration_type")))) {
            return text(basic == null ? null : basic.get("organization_name"));
        }
        String first = text(basic == null ? null : basic.get("first_name"));
        String last = text(basic == null ? null : basic.get("last_name"));
        if (first != null && last != null) {
            return first + " " + last;
        }
        return text(basic == null ? null : basic.get("name"));
    }

    private static JsonNode address(JsonNode result, String purpose) {
        JsonNode addresses = result.get("addresses");
        if (addresses == null || !addresses.isArray()) {
            return null;
        }
        for (JsonNode address : addresses) {
            if (purpose.equals(text(address.get("address_purpose")))) {
                return address;
            }
        }
        return null;
    }

    private static JsonNode taxonomy(JsonNode result) {
        JsonNode taxonomies = result.get("taxonomies");
        if (taxonomies == null || !taxonomies.isArray() || taxonomies.isEmpty()) {
            return null;
        }
        JsonNode first = null;
        for (JsonNode taxonomy : taxonomies) {
            if (first == null) {
                first = taxonomy;
            }
            if (taxonomy.path("primary").asBoolean(false)) {
                return taxonomy;
            }
        }
        return first;
    }

    private static String text(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        String value = node.asText();
        if (value == null || value.isBlank()) {
            return null;
        }
        return value;
    }

    private record Loaded(boolean found, boolean available, Map<String, JsonNode> byNumber) {
    }
}
