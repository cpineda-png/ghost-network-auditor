package com.ghostnetwork.auditor.gateway.api.dto;

import java.util.List;

public record ReplayResponse(
        String receiptId,
        boolean match,
        String originalRowsHash,
        String newRowsHash,
        List<Object> rows
) {
}
