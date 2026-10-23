package com.ghostnetwork.auditor.gateway.query;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Sorted-key JSON with no whitespace. Integers have no fraction. */
public final class CanonicalJson {

    private CanonicalJson() {}

    public static String of(Object value) {
        StringBuilder builder = new StringBuilder();
        write(builder, value);
        return builder.toString();
    }

    private static void write(StringBuilder builder, Object value) {
        if (value == null) {
            builder.append("null");
            return;
        }
        if (value instanceof String text) {
            writeString(builder, text);
            return;
        }
        if (value instanceof Boolean flag) {
            builder.append(flag ? "true" : "false");
            return;
        }
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
            builder.append(value);
            return;
        }
        if (value instanceof BigDecimal decimal) {
            builder.append(decimal.toPlainString());
            return;
        }
        if (value instanceof Map<?, ?> map) {
            List<String> keys = new ArrayList<>();
            for (Object key : map.keySet()) {
                keys.add(String.valueOf(key));
            }
            Collections.sort(keys);
            builder.append('{');
            boolean first = true;
            for (String key : keys) {
                if (!first) {
                    builder.append(',');
                }
                first = false;
                writeString(builder, key);
                builder.append(':');
                write(builder, map.get(key));
            }
            builder.append('}');
            return;
        }
        if (value instanceof List<?> list) {
            builder.append('[');
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) {
                    builder.append(',');
                }
                write(builder, list.get(i));
            }
            builder.append(']');
            return;
        }
        throw new IllegalArgumentException("Cannot canonicalize " + value.getClass().getName());
    }

    private static void writeString(StringBuilder builder, String text) {
        builder.append('"');
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            switch (ch) {
                case '"' -> builder.append("\\\"");
                case '\\' -> builder.append("\\\\");
                case '\b' -> builder.append("\\b");
                case '\f' -> builder.append("\\f");
                case '\n' -> builder.append("\\n");
                case '\r' -> builder.append("\\r");
                case '\t' -> builder.append("\\t");
                default -> {
                    if (ch < 0x20) {
                        builder.append(String.format("\\u%04x", (int) ch));
                    } else {
                        builder.append(ch);
                    }
                }
            }
        }
        builder.append('"');
    }
}
