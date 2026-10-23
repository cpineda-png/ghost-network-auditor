package com.ghostnetwork.auditor.gateway.query;

public class QueryRejectedException extends RuntimeException {

    public QueryRejectedException(String message) {
        super(message);
    }
}
