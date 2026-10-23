package com.ghostnetwork.auditor.gateway.query;

import java.util.List;

public interface SqlRenderer {

    String render(String preparedSql, List<Object> binds);
}
