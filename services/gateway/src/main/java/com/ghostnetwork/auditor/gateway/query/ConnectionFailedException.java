package com.ghostnetwork.auditor.gateway.query;

/** The driver did not connect, or the query timed out. A recorded sample may be served. */
public class ConnectionFailedException extends QueryUnavailableException {

    public ConnectionFailedException(String message) {
        super(message);
    }

    public ConnectionFailedException(String message, Throwable cause) {
        super(message, cause);
    }
}
