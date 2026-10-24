package com.ghostnetwork.auditor.gateway.query;

import java.sql.SQLException;
import java.sql.SQLNonTransientConnectionException;
import java.sql.SQLTimeoutException;
import java.sql.SQLTransientConnectionException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class SqlFailures {

    private static final Pattern ERROR_CODE = Pattern.compile("\\[([A-Z][A-Z0-9_]*)\\]");

    private SqlFailures() {}

    static boolean connectionOrTimeout(Throwable failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            if (current instanceof SQLTransientConnectionException
                    || current instanceof SQLNonTransientConnectionException
                    || current instanceof SQLTimeoutException) {
                return true;
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
            depth++;
        }
        return false;
    }

    /** Connection failures worth retrying. Timeouts are excluded so one slow query cannot consume the budget. */
    static boolean transientConnection(Throwable failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            if (current instanceof SQLTransientConnectionException
                    || current instanceof SQLNonTransientConnectionException) {
                return true;
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
            depth++;
        }
        return false;
    }

    static String errorCode(SQLException failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            String message = current.getMessage();
            if (message != null) {
                Matcher matcher = ERROR_CODE.matcher(message);
                if (matcher.find()) {
                    return matcher.group(1);
                }
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
            depth++;
        }
        return failure.getClass().getSimpleName();
    }

    static String sqlState(SQLException failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            if (current instanceof SQLException sql) {
                String state = sql.getSQLState();
                if (state != null && !state.isBlank()) {
                    return state;
                }
            }
            Throwable next = current.getCause();
            if (next == current) {
                break;
            }
            current = next;
            depth++;
        }
        return null;
    }
}
