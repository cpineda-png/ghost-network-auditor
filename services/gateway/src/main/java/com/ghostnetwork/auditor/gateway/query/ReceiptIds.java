package com.ghostnetwork.auditor.gateway.query;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class ReceiptIds {

    private ReceiptIds() {}

    public static String receiptId(String templateId, String canonicalParams, String runId) {
        return "rcpt_" + sha256(templateId + canonicalParams + runId).substring(0, 16);
    }

    public static String rowsHash(String canonicalRows) {
        return sha256(canonicalRows);
    }

    public static String sampleKey(String canonicalParams) {
        return sha256(canonicalParams).substring(0, 16);
    }

    private static String sha256(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
