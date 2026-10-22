package com.ghostnetwork.auditor.gateway.api;

import com.ghostnetwork.auditor.gateway.api.dto.CatalogResponse;
import com.ghostnetwork.auditor.gateway.api.dto.QueryRequest;
import com.ghostnetwork.auditor.gateway.api.dto.QueryResponse;
import com.ghostnetwork.auditor.gateway.api.dto.Receipt;
import com.ghostnetwork.auditor.gateway.api.dto.ReplayResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StubController {

    @GetMapping("/catalog")
    public ResponseEntity<CatalogResponse> catalog() {
        // TODO implement template catalog
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }

    @PostMapping("/query")
    public ResponseEntity<QueryResponse> query(@RequestBody QueryRequest request) {
        // TODO implement templated query against Zetaris
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }

    @PostMapping("/replay/{receiptId}")
    public ResponseEntity<ReplayResponse> replay(@PathVariable String receiptId) {
        // TODO implement receipt replay
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }

    @GetMapping("/receipts/{receiptId}")
    public ResponseEntity<Receipt> receipt(@PathVariable String receiptId) {
        // TODO implement receipt lookup
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }
}
