package com.ghostnetwork.auditor.gateway.query;

import java.util.List;

public record TemplateDefinition(
        String id,
        String description,
        String source,
        List<String> columns,
        String orderBy,
        boolean limit,
        List<ParamDefinition> params,
        List<WhereClause> where
) {
}

record ParamDefinition(
        String name,
        String type,
        boolean required,
        List<String> allowed,
        Integer min,
        Integer max,
        Object defaultValue
) {
}

record WhereClause(String op, String column, String param) {
}
