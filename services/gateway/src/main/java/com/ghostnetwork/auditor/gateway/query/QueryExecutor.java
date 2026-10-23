package com.ghostnetwork.auditor.gateway.query;

public interface QueryExecutor {

    QueryResult execute(SqlBuilder.BoundQuery query);
}
