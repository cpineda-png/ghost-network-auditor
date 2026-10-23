package com.ghostnetwork.auditor.gateway.query;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** Turns JDBC values into the strings stored in receipts and row hashes. */
public final class JdbcValues {

    private JdbcValues() {}

    public static String fromJdbc(int jdbcType, Object value) {
        if (value == null) {
            return null;
        }
        return switch (jdbcType) {
            case Types.DATE -> dateOnly(value);
            case Types.TIMESTAMP, Types.TIMESTAMP_WITH_TIMEZONE -> timestamp(value);
            case Types.DECIMAL, Types.NUMERIC -> decimal(value);
            case Types.BOOLEAN, Types.BIT -> bool(value);
            case Types.TINYINT, Types.SMALLINT, Types.INTEGER, Types.BIGINT -> integer(value);
            default -> convert(value);
        };
    }

    public static String convert(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String text) {
            return text;
        }
        if (value instanceof Timestamp || value instanceof Instant || value instanceof OffsetDateTime
                || value instanceof LocalDateTime) {
            return timestamp(value);
        }
        if (value instanceof java.sql.Date || value instanceof LocalDate) {
            return dateOnly(value);
        }
        if (value instanceof BigDecimal) {
            return decimal(value);
        }
        if (value instanceof Boolean) {
            return bool(value);
        }
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
            return integer(value);
        }
        if (value instanceof Float || value instanceof Double) {
            return decimal(value);
        }
        return String.valueOf(value);
    }

    private static String dateOnly(Object value) {
        if (value instanceof java.sql.Date date) {
            return date.toLocalDate().toString();
        }
        if (value instanceof LocalDate date) {
            return date.toString();
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant().atZone(ZoneOffset.UTC).toLocalDate().toString();
        }
        throw new IllegalArgumentException("Not a date: " + value.getClass().getName());
    }

    private static String timestamp(Object value) {
        Instant instant;
        if (value instanceof Timestamp timestamp) {
            instant = timestamp.toInstant();
        } else if (value instanceof Instant valueInstant) {
            instant = valueInstant;
        } else if (value instanceof OffsetDateTime offset) {
            instant = offset.toInstant();
        } else if (value instanceof LocalDateTime local) {
            instant = local.toInstant(ZoneOffset.UTC);
        } else {
            throw new IllegalArgumentException("Not a timestamp: " + value.getClass().getName());
        }
        return DateTimeFormatter.ISO_INSTANT.format(instant);
    }

    private static String decimal(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal.toPlainString();
        }
        if (value instanceof Float || value instanceof Double) {
            return BigDecimal.valueOf(((Number) value).doubleValue()).toPlainString();
        }
        if (value instanceof Number number) {
            return new BigDecimal(number.toString()).toPlainString();
        }
        throw new IllegalArgumentException("Not a decimal: " + value.getClass().getName());
    }

    private static String bool(Object value) {
        if (value instanceof Boolean flag) {
            return flag.toString();
        }
        if (value instanceof Number number) {
            return number.longValue() == 0L ? "false" : "true";
        }
        throw new IllegalArgumentException("Not a boolean: " + value.getClass().getName());
    }

    private static String integer(Object value) {
        if (value instanceof Number number) {
            return Long.toString(number.longValue());
        }
        throw new IllegalArgumentException("Not an integer: " + value.getClass().getName());
    }
}
