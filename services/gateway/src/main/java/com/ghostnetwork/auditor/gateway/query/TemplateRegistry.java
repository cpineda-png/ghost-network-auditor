package com.ghostnetwork.auditor.gateway.query;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.Yaml;

@Component
public class TemplateRegistry {

    private final Map<String, TemplateDefinition> templates;

    public TemplateRegistry() {
        this.templates = load();
    }

    public TemplateDefinition require(String templateId) {
        TemplateDefinition template = templates.get(templateId);
        if (template == null) {
            throw new QueryRejectedException("Unknown template: " + templateId);
        }
        return template;
    }

    public List<TemplateDefinition> templates() {
        return List.copyOf(templates.values());
    }

    private static Map<String, TemplateDefinition> load() {
        ClassPathResource resource = new ClassPathResource("templates.yml");
        try (InputStream input = resource.getInputStream()) {
            Object root = new Yaml().load(input);
            if (!(root instanceof Map<?, ?> document)) {
                throw new IllegalStateException("templates.yml must be a map");
            }
            Object rawTemplates = document.get("templates");
            if (!(rawTemplates instanceof List<?> list)) {
                throw new IllegalStateException("templates.yml is missing templates");
            }
            Map<String, TemplateDefinition> loaded = new LinkedHashMap<>();
            for (Object item : list) {
                TemplateDefinition template = parseTemplate(item);
                loaded.put(template.id(), template);
            }
            return Collections.unmodifiableMap(loaded);
        } catch (IOException ex) {
            throw new IllegalStateException("Could not read templates.yml", ex);
        }
    }

    private static TemplateDefinition parseTemplate(Object item) {
        Map<?, ?> map = asMap(item);
        String id = text(map, "id");
        String orderBy = map.get("orderBy") == null ? null : text(map, "orderBy");
        boolean limit = Boolean.TRUE.equals(map.get("limit"));
        return new TemplateDefinition(
                id,
                text(map, "description"),
                text(map, "source"),
                strings(map.get("columns")),
                orderBy,
                limit,
                parseParams(map.get("params")),
                parseWhere(map.get("where")));
    }

    private static List<ParamDefinition> parseParams(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<ParamDefinition> params = new ArrayList<>();
        for (Object item : list) {
            Map<?, ?> map = asMap(item);
            params.add(new ParamDefinition(
                    text(map, "name"),
                    text(map, "type"),
                    Boolean.TRUE.equals(map.get("required")),
                    map.get("allowed") == null ? List.of() : strings(map.get("allowed")),
                    integer(map.get("min")),
                    integer(map.get("max")),
                    map.get("default")));
        }
        return List.copyOf(params);
    }

    private static List<WhereClause> parseWhere(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<WhereClause> clauses = new ArrayList<>();
        for (Object item : list) {
            Map<?, ?> map = asMap(item);
            clauses.add(new WhereClause(text(map, "op"), text(map, "column"), text(map, "param")));
        }
        return List.copyOf(clauses);
    }

    private static Map<?, ?> asMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            return map;
        }
        throw new IllegalStateException("Expected a map in templates.yml");
    }

    private static String text(Map<?, ?> map, String key) {
        Object value = map.get(key);
        if (value == null || value.toString().isBlank()) {
            throw new IllegalStateException("templates.yml is missing " + key);
        }
        return value.toString();
    }

    private static List<String> strings(Object value) {
        if (!(value instanceof List<?> list) || list.isEmpty()) {
            throw new IllegalStateException("templates.yml expected a non-empty list");
        }
        List<String> strings = new ArrayList<>();
        for (Object item : list) {
            strings.add(String.valueOf(item));
        }
        return List.copyOf(strings);
    }

    private static Integer integer(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.valueOf(value.toString());
    }
}
