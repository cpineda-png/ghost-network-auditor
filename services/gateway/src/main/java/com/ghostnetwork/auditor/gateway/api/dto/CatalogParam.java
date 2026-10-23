package com.ghostnetwork.auditor.gateway.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record CatalogParam(
        String name,
        String type,
        boolean required,
        List<String> allowed
) {
}
