package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ghostnetwork.auditor.gateway.api.dto.Receipt;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReceiptStoreTest {

    @TempDir
    Path temp;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void keepsTheOriginalFileWhenTheRowsHashDiffers() throws Exception {
        ReceiptStore store = new ReceiptStore(mapper, temp.toString());
        store.save(receipt("hash-a", "first"), List.of("batch"), List.of(Map.of("batch", "A")));
        store.save(receipt("hash-b", "second"), List.of("batch"), List.of(Map.of("batch", "B")));
        assertEquals("hash-a", store.get("rcpt_0c327279b71647ed").rowsHash());
        assertEquals("first", store.get("rcpt_0c327279b71647ed").executedAt());
        assertTrue(Files.readString(temp.resolve("rcpt_0c327279b71647ed.json")).contains("\"batch\":\"A\""));
        assertFalse(Files.readString(temp.resolve("rcpt_0c327279b71647ed.json")).contains("\"batch\":\"B\""));
    }

    @Test
    void missingAndUnsafeIdsAreNotFound() {
        ReceiptStore store = new ReceiptStore(mapper, temp.toString());
        org.junit.jupiter.api.Assertions.assertThrows(
                ReceiptNotFoundException.class,
                () -> store.get("rcpt_0000000000000000"));
        org.junit.jupiter.api.Assertions.assertThrows(
                ReceiptNotFoundException.class,
                () -> store.get("../rcpt_0c327279b71647ed"));
    }

    private static Receipt receipt(String rowsHash, String executedAt) {
        return new Receipt(
                "rcpt_0c327279b71647ed",
                "run_golden",
                "directory_batch",
                "SELECT 1",
                Map.of("batch", "A", "limit", 5, "offset", 0),
                List.of("PLAN_PG.directory_listing"),
                1,
                rowsHash,
                List.of(Map.of("batch", "A")),
                executedAt,
                "live",
                1);
    }
}
