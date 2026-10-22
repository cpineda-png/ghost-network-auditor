package com.ghostnetwork.auditor.gateway.api.dto;

import java.util.List;

public record QueryResponse(
        Receipt receipt,
        List<String> columns,
        List<Object> rows
) {
}
