package com.ghostnetwork.auditor.gateway.api.dto;

import java.util.Map;

public record QueryRequest(
        String templateId,
        Map<String, Object> params,
        String runId,
        String requestedBy
) {
}
