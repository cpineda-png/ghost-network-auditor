package com.ghostnetwork.auditor.gateway.api.dto;

import java.util.List;
import java.util.Map;

public record Receipt(
        String receiptId,
        String runId,
        String templateId,
        String sql,
        Map<String, Object> params,
        List<String> sources,
        int rowCount,
        String rowsHash,
        List<Object> rowsPreview,
        String executedAt,
        String mode,
        long durationMs
) {
}
