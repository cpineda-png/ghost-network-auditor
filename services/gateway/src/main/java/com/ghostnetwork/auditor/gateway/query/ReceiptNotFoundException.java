package com.ghostnetwork.auditor.gateway.query;

public class ReceiptNotFoundException extends RuntimeException {

    public ReceiptNotFoundException(String receiptId) {
        super(receiptId);
    }
}
