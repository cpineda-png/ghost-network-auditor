package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ReceiptHashTest {

    @Test
    void goldenParamsAndReceiptId() {
        String params = CanonicalJson.of(Map.of("batch", "A", "limit", 5, "offset", 0));
        assertEquals("{\"batch\":\"A\",\"limit\":5,\"offset\":0}", params);
        assertEquals("2cc0721f9d00aead", ReceiptIds.sampleKey(params));
        assertEquals("rcpt_0c327279b71647ed", ReceiptIds.receiptId("directory_batch", params, "run_golden"));
    }

    @Test
    void goldenRowUsesDateBooleanNullDecimalAndTimestamp() {
        Map<String, String> row = new LinkedHashMap<>();
        row.put("accepting_new_patients", JdbcValues.fromJdbc(Types.BOOLEAN, true));
        row.put("amount", JdbcValues.fromJdbc(Types.DECIMAL, new BigDecimal("10.50")));
        row.put("group_name", JdbcValues.fromJdbc(Types.VARCHAR, null));
        row.put("last_verified_date", JdbcValues.fromJdbc(Types.DATE, java.sql.Date.valueOf("2026-04-15")));
        row.put(
                "verified_at",
                JdbcValues.fromJdbc(Types.TIMESTAMP, Timestamp.from(Instant.parse("2026-04-15T13:45:00Z"))));

        assertEquals("true", row.get("accepting_new_patients"));
        assertEquals("10.50", row.get("amount"));
        assertNull(row.get("group_name"));
        assertEquals("2026-04-15", row.get("last_verified_date"));
        assertEquals("2026-04-15T13:45:00Z", row.get("verified_at"));

        String json = CanonicalJson.of(List.of(row));
        assertEquals(
                "[{\"accepting_new_patients\":\"true\",\"amount\":\"10.50\",\"group_name\":null,"
                        + "\"last_verified_date\":\"2026-04-15\",\"verified_at\":\"2026-04-15T13:45:00Z\"}]",
                json);
        assertEquals("2010effe491fa055ae11d6e15eb19e0e3bbd89c8a05bf3ea09adbf77f03c646e", ReceiptIds.rowsHash(json));
    }

    @Test
    void timestampIsNotFormattedAsADate() {
        Timestamp timestamp = Timestamp.from(Instant.parse("2026-04-15T13:45:00Z"));
        assertEquals("2026-04-15T13:45:00Z", JdbcValues.convert(timestamp));
        assertEquals("2026-04-15", JdbcValues.convert(java.sql.Date.valueOf("2026-04-15")));
    }
}
