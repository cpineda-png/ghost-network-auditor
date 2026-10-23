package com.ghostnetwork.auditor.gateway.query;

public class QueryUnavailableException extends RuntimeException {

    public QueryUnavailableException(String message) {
        super(message);
    }

    public QueryUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
