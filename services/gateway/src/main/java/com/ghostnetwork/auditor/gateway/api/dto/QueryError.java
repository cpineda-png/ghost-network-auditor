package com.ghostnetwork.auditor.gateway.api.dto;

public record QueryError(String error, String templateId, String sqlState) {
}
