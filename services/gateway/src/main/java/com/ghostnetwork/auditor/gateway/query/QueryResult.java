package com.ghostnetwork.auditor.gateway.query;

import java.util.List;
import java.util.Map;

public record QueryResult(List<String> columns, List<Map<String, String>> rows, boolean prepared) {
}
