package com.ghostnetwork.auditor.gateway.query;

/** The database rejected the query. Callers return 502 and do not store a receipt. */
public class QueryFailedException extends RuntimeException {

    private final String error;
    private final String sqlState;
    private final String templateId;

    public QueryFailedException(String error, String sqlState, Throwable cause) {
        this(error, sqlState, null, cause);
    }

    private QueryFailedException(String error, String sqlState, String templateId, Throwable cause) {
        super(error, cause);
        this.error = error;
        this.sqlState = sqlState;
        this.templateId = templateId;
    }

    public QueryFailedException withTemplate(String templateId) {
        return new QueryFailedException(error, sqlState, templateId, getCause());
    }

    public String error() {
        return error;
    }

    public String sqlState() {
        return sqlState;
    }

    public String templateId() {
        return templateId;
    }
}
