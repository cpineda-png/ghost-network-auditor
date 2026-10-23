package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TemplateQueryTest {

    private final TemplateRegistry templates = new TemplateRegistry();
    private final ParamValidator validator = new ParamValidator(templates);
    private final SqlBuilder sql = new SqlBuilder(
            "PLAN_PG.directory_listing",
            "GNA_FILES.roster",
            "GNA_FILES.claims",
            new LiteralSqlRenderer());

    @Test
    void offsetZeroIsLeftOutOfSql() {
        ParamValidator.ValidatedQuery validated = validator.validate(
                "directory_batch",
                Map.of("batch", "A", "limit", 5));
        assertEquals("{\"batch\":\"A\",\"limit\":5,\"offset\":0}", validated.canonicalParams());
        SqlBuilder.BoundQuery query = sql.build(validated.template(), validated.params());
        assertFalse(query.preparedSql().contains("OFFSET"));
        assertFalse(query.displaySql().contains("OFFSET"));
        assertTrue(query.preparedSql().endsWith("LIMIT ?"));
        assertTrue(query.displaySql().endsWith("LIMIT 5"));
        assertEquals(List.of("A", 5), query.binds());
        assertTrue(query.displaySql().contains("WHERE batch = 'A'"));
        assertFalse(query.displaySql().contains("county ="));
    }

    @Test
    void positiveOffsetIsBound() {
        ParamValidator.ValidatedQuery validated = validator.validate(
                "directory_batch",
                Map.of("batch", "A", "limit", 5, "offset", 2));
        SqlBuilder.BoundQuery query = sql.build(validated.template(), validated.params());
        assertTrue(query.preparedSql().endsWith("LIMIT ? OFFSET ?"));
        assertTrue(query.displaySql().endsWith("LIMIT 5 OFFSET 2"));
        assertEquals(List.of("A", 5, 2), query.binds());
    }

    @Test
    void specialtyTextIsQuotedAndSeedValuesAreAllowed() {
        ParamValidator.ValidatedQuery validated = validator.validate(
                "directory_batch",
                Map.of(
                        "batch", "A",
                        "county", "Kings",
                        "specialty", "Clinic/Center, Mental Health",
                        "limit", 5,
                        "offset", 0));
        SqlBuilder.BoundQuery query = sql.build(validated.template(), validated.params());
        assertTrue(query.preparedSql().contains("specialty = ?"));
        assertTrue(query.displaySql().contains("specialty = 'Clinic/Center, Mental Health'"));
        ParamValidator.ValidatedQuery quoted = validator.validate(
                "directory_batch",
                Map.of("batch", "A", "specialty", "O'Brien", "limit", 1, "offset", 0));
        assertTrue(sql.build(quoted.template(), quoted.params()).displaySql().contains("specialty = 'O''Brien'"));
    }

    @Test
    void rosterAndClaimsUsePlaceholders() {
        ParamValidator.ValidatedQuery roster = validator.validate(
                "roster_by_npis",
                Map.of("npis", List.of("1234567890", "1234567891")));
        SqlBuilder.BoundQuery rosterSql = sql.build(roster.template(), roster.params());
        assertTrue(rosterSql.preparedSql().contains("npi IN (?, ?)"));
        assertTrue(rosterSql.displaySql().contains("npi IN ('1234567890', '1234567891')"));
        assertFalse(rosterSql.preparedSql().contains("OFFSET"));

        ParamValidator.ValidatedQuery claims = validator.validate(
                "claims_by_npis",
                Map.of("npis", List.of("1234567890"), "fromMonth", "2026-01", "toMonth", "2026-04"));
        SqlBuilder.BoundQuery claimsSql = sql.build(claims.template(), claims.params());
        assertTrue(claimsSql.preparedSql().contains("month >= ? AND month <= ?"));
        assertTrue(claimsSql.displaySql().contains("month >= '2026-01' AND month <= '2026-04'"));
    }

    @Test
    void rejectsSqlLookingTextBadNpiTooManyNpisAndBadBatch() {
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "directory_batch", Map.of("batch", "C")));
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "directory_batch", Map.of("batch", "A", "specialty", "select all")));
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "directory_batch", Map.of("batch", "A", "county", "x -- y")));
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "directory_batch", Map.of("batch", "A", "drop", "table")));
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "roster_by_npis", Map.of("npis", List.of("12345"))));
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "roster_by_npis", Map.of("npis", List.of(
                        "1234567890", "1234567890", "1234567890", "1234567890", "1234567890",
                        "1234567890", "1234567890", "1234567890", "1234567890", "1234567890",
                        "1234567890"))));
        assertThrows(QueryRejectedException.class, () -> validator.validate(
                "claims_by_npis",
                Map.of("npis", List.of("1234567890"), "fromMonth", "2026-05", "toMonth", "2026-01")));
    }

    @Test
    void refusesUnsafeTableNames() {
        assertThrows(IllegalStateException.class, () -> new SqlBuilder(
                "PLAN_PG.directory_listing;drop",
                "GNA_FILES.roster",
                "GNA_FILES.claims",
                new LiteralSqlRenderer()));
    }
}
