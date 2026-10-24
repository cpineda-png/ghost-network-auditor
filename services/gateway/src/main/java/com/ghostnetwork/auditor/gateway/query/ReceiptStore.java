package com.ghostnetwork.auditor.gateway.query;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ghostnetwork.auditor.gateway.api.dto.Receipt;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class ReceiptStore {

    private static final Logger log = LoggerFactory.getLogger(ReceiptStore.class);
    private static final Pattern RECEIPT_ID = Pattern.compile("^rcpt_[0-9a-f]{16}$");

    private final ObjectMapper mapper;
    private final Path receiptsDir;

    public ReceiptStore(ObjectMapper mapper, @Value("${gna.receipts-dir}") String receiptsDir) {
        this.mapper = mapper;
        this.receiptsDir = Path.of(receiptsDir);
    }

    public void save(Receipt receipt, List<String> columns, List<Map<String, String>> rows) {
        Path target = path(receipt.receiptId());
        try {
            Files.createDirectories(target.getParent());
            if (Files.exists(target)) {
                keepOriginal(target, receipt);
                return;
            }
            write(target, new ReceiptDocument(receipt, columns, rows));
        } catch (IOException ex) {
            throw new QueryUnavailableException("Receipt could not be stored", ex);
        }
    }

    public Receipt get(String receiptId) {
        return load(receiptId).receipt();
    }

    public ReceiptDocument load(String receiptId) {
        Path target;
        try {
            target = path(receiptId);
        } catch (IllegalArgumentException ex) {
            throw new ReceiptNotFoundException(receiptId);
        }
        if (!Files.isRegularFile(target)) {
            throw new ReceiptNotFoundException(receiptId);
        }
        try (InputStream input = Files.newInputStream(target)) {
            ReceiptDocument document = mapper.readValue(input, ReceiptDocument.class);
            if (document.receipt() == null) {
                throw new IOException("Receipt file has no receipt");
            }
            return document;
        } catch (IOException ex) {
            throw new ReceiptNotFoundException(receiptId);
        }
    }

    private void keepOriginal(Path target, Receipt receipt) throws IOException {
        try (InputStream input = Files.newInputStream(target)) {
            ReceiptDocument existing = mapper.readValue(input, ReceiptDocument.class);
            String storedHash = existing.receipt() == null ? null : existing.receipt().rowsHash();
            if (storedHash != null && !storedHash.equals(receipt.rowsHash())) {
                log.warn("Receipt {} already stored with a different rowsHash; keeping the original", receipt.receiptId());
            }
        } catch (IOException ex) {
            log.warn("Receipt {} could not be read; leaving the file unchanged", receipt.receiptId());
        }
    }

    private void write(Path target, ReceiptDocument document) throws IOException {
        Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
        try (OutputStream output = Files.newOutputStream(temporary)) {
            mapper.writeValue(output, document);
        }
        try {
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ex) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private Path path(String receiptId) {
        if (receiptId == null || !RECEIPT_ID.matcher(receiptId).matches()) {
            throw new IllegalArgumentException("Refusing receipt path");
        }
        return receiptsDir.resolve(receiptId + ".json");
    }

    public record ReceiptDocument(Receipt receipt, List<String> columns, List<Map<String, String>> rows) {
    }
}
