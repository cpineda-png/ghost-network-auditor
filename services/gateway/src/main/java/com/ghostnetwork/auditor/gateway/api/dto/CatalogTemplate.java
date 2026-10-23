package com.ghostnetwork.auditor.gateway.api.dto;

import java.util.List;

public record CatalogTemplate(
        String templateId,
        String description,
        List<CatalogParam> params,
        List<String> sources
) {
}
