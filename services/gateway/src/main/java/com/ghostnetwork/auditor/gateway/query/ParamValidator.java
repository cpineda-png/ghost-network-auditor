package com.ghostnetwork.auditor.gateway.query;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class ParamValidator {

    private static final Pattern SAFE_TEXT = Pattern.compile("^[A-Za-z0-9 .,&/'()-]{1,128}$");
    private static final Pattern NPI = Pattern.compile("^[0-9]{10}$");
    private static final Pattern MONTH = Pattern.compile("^[0-9]{4}-(0[1-9]|1[0-2])$");
    private static final Pattern SQL_WORD = Pattern.compile(
            "(?i)(^|\\s)(select|insert|update|delete|drop|union|alter|exec|or|and)(\\s|$)");

    private final TemplateRegistry templates;

    public ParamValidator(TemplateRegistry templates) {
        this.templates = templates;
    }

    public ValidatedQuery validate(String templateId, Map<String, Object> rawParams) {
        if (templateId == null || templateId.isBlank()) {
            throw new QueryRejectedException("templateId is required");
        }
        TemplateDefinition template = templates.require(templateId);
        Map<String, Object> supplied = rawParams == null ? Map.of() : rawParams;
        Map<String, ParamDefinition> declared = new LinkedHashMap<>();
        for (ParamDefinition param : template.params()) {
            declared.put(param.name(), param);
        }
        for (String name : supplied.keySet()) {
            if (!declared.containsKey(name)) {
                throw new QueryRejectedException("Unknown param: " + name);
            }
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        for (ParamDefinition param : template.params()) {
            Object value = supplied.get(param.name());
            if (value == null) {
                if (param.defaultValue() != null) {
                    normalized.put(param.name(), coerceDefault(param));
                } else if (param.required()) {
                    throw new QueryRejectedException(param.name() + " is required");
                }
                continue;
            }
            normalized.put(param.name(), coerce(param, value));
        }
        checkMonthOrder(normalized);
        return new ValidatedQuery(template, Collections.unmodifiableMap(normalized), CanonicalJson.of(normalized));
    }

    private static Object coerceDefault(ParamDefinition param) {
        if ("integer".equals(param.type()) && param.defaultValue() instanceof Number number) {
            return number.intValue();
        }
        return param.defaultValue();
    }

    private static Object coerce(ParamDefinition param, Object value) {
        return switch (param.type()) {
            case "enum" -> enumValue(param, value);
            case "string" -> textValue(param.name(), value);
            case "integer" -> integerValue(param, value);
            case "npi[]" -> npiList(value);
            case "month" -> monthValue(param.name(), value);
            default -> throw new IllegalStateException("Unknown param type " + param.type());
        };
    }

    private static String enumValue(ParamDefinition param, Object value) {
        if (!(value instanceof String text) || !param.allowed().contains(text)) {
            throw new QueryRejectedException(param.name() + " is not an allowed value");
        }
        return text;
    }

    private static String textValue(String name, Object value) {
        if (!(value instanceof String text) || !SAFE_TEXT.matcher(text).matches() || looksLikeSql(text)) {
            throw new QueryRejectedException(name + " is not an allowed value");
        }
        return text;
    }

    private static boolean looksLikeSql(String text) {
        return text.indexOf(';') >= 0
                || text.contains("--")
                || text.contains("/*")
                || text.contains("*/")
                || SQL_WORD.matcher(text).find();
    }

    private static int integerValue(ParamDefinition param, Object value) {
        if (!(value instanceof Number number) || number instanceof Float || number instanceof Double) {
            throw new QueryRejectedException(param.name() + " must be an integer");
        }
        long longValue = number.longValue();
        if (param.min() != null && longValue < param.min()) {
            throw new QueryRejectedException(param.name() + " is out of range");
        }
        if (param.max() != null && longValue > param.max()) {
            throw new QueryRejectedException(param.name() + " is out of range");
        }
        return (int) longValue;
    }

    private static List<String> npiList(Object value) {
        if (!(value instanceof List<?> list) || list.isEmpty() || list.size() > 10) {
            throw new QueryRejectedException("npis must contain 1 to 10 values");
        }
        List<String> npis = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof String text) || !NPI.matcher(text).matches()) {
                throw new QueryRejectedException("npis must be 10-digit strings");
            }
            npis.add(text);
        }
        return List.copyOf(npis);
    }

    private static String monthValue(String name, Object value) {
        if (!(value instanceof String text) || !MONTH.matcher(text).matches()) {
            throw new QueryRejectedException(name + " must be YYYY-MM");
        }
        return text;
    }

    private static void checkMonthOrder(Map<String, Object> params) {
        Object from = params.get("fromMonth");
        Object to = params.get("toMonth");
        if (from instanceof String fromMonth && to instanceof String toMonth && fromMonth.compareTo(toMonth) > 0) {
            throw new QueryRejectedException("fromMonth must not be after toMonth");
        }
    }

    public record ValidatedQuery(TemplateDefinition template, Map<String, Object> params, String canonicalParams) {
    }
}
