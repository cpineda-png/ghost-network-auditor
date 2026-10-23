package com.ghostnetwork.auditor.gateway.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SqlBuilder {

    static final Pattern IDENTIFIER = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?$");
    private static final Pattern COLUMN = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");

    private final String directoryTable;
    private final String rosterTable;
    private final String claimsTable;
    private final SqlRenderer sqlRenderer;

    public SqlBuilder(
            @Value("${gna.tables.directory}") String directoryTable,
            @Value("${gna.tables.roster}") String rosterTable,
            @Value("${gna.tables.claims}") String claimsTable,
            SqlRenderer sqlRenderer
    ) {
        this.directoryTable = requireTable(directoryTable);
        this.rosterTable = requireTable(rosterTable);
        this.claimsTable = requireTable(claimsTable);
        this.sqlRenderer = sqlRenderer;
    }

    public String sourceTable(String source) {
        return switch (source) {
            case "directory" -> directoryTable;
            case "roster" -> rosterTable;
            case "claims" -> claimsTable;
            default -> throw new IllegalStateException("Unknown source " + source);
        };
    }

    public BoundQuery build(TemplateDefinition template, Map<String, Object> params) {
        String table = sourceTable(template.source());
        for (String column : template.columns()) {
            requireColumn(column);
        }
        StringBuilder prepared = new StringBuilder("SELECT ");
        prepared.append(String.join(", ", template.columns())).append(" FROM ").append(table);
        List<Object> binds = new ArrayList<>();
        boolean where = false;
        for (WhereClause clause : template.where()) {
            requireColumn(clause.column());
            if (!params.containsKey(clause.param())) {
                continue;
            }
            prepared.append(where ? " AND " : " WHERE ");
            where = true;
            appendClause(prepared, binds, clause, params.get(clause.param()));
        }
        if (template.orderBy() != null) {
            requireColumn(template.orderBy());
            prepared.append(" ORDER BY ").append(template.orderBy());
        }
        if (template.limit()) {
            if (!(params.get("limit") instanceof Integer limit)) {
                throw new IllegalStateException("limit is missing");
            }
            prepared.append(" LIMIT ?");
            binds.add(limit);
            if (params.get("offset") instanceof Integer offset && offset > 0) {
                prepared.append(" OFFSET ?");
                binds.add(offset);
            }
        }
        String preparedSql = prepared.toString();
        List<Object> frozen = List.copyOf(binds);
        return new BoundQuery(preparedSql, sqlRenderer.render(preparedSql, frozen), frozen);
    }

    private static void appendClause(
            StringBuilder prepared,
            List<Object> binds,
            WhereClause clause,
            Object value
    ) {
        switch (clause.op()) {
            case "eq" -> {
                prepared.append(clause.column()).append(" = ?");
                binds.add(value);
            }
            case "gte" -> {
                prepared.append(clause.column()).append(" >= ?");
                binds.add(value);
            }
            case "lte" -> {
                prepared.append(clause.column()).append(" <= ?");
                binds.add(value);
            }
            case "in" -> {
                List<?> values = (List<?>) value;
                prepared.append(clause.column()).append(" IN (");
                for (int i = 0; i < values.size(); i++) {
                    if (i > 0) {
                        prepared.append(", ");
                    }
                    prepared.append('?');
                    binds.add(values.get(i));
                }
                prepared.append(')');
            }
            default -> throw new IllegalStateException("Unknown where op " + clause.op());
        }
    }

    static String literal(Object value) {
        if (value instanceof Integer || value instanceof Long) {
            return value.toString();
        }
        String text = String.valueOf(value);
        return "'" + text.replace("'", "''") + "'";
    }

    private static String requireTable(String table) {
        if (table == null || !IDENTIFIER.matcher(table).matches()) {
            throw new IllegalStateException("Refusing table name");
        }
        return table;
    }

    private static void requireColumn(String column) {
        if (column == null || !COLUMN.matcher(column).matches()) {
            throw new IllegalStateException("Refusing column name");
        }
    }

    public record BoundQuery(String preparedSql, String displaySql, List<Object> binds) {
    }
}
