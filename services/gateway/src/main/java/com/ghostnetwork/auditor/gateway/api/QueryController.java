package com.ghostnetwork.auditor.gateway.api;

import com.ghostnetwork.auditor.gateway.api.dto.CatalogResponse;
import com.ghostnetwork.auditor.gateway.api.dto.QueryRequest;
import com.ghostnetwork.auditor.gateway.api.dto.QueryResponse;
import com.ghostnetwork.auditor.gateway.api.dto.Receipt;
import com.ghostnetwork.auditor.gateway.api.dto.ReplayResponse;
import com.ghostnetwork.auditor.gateway.query.QueryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class QueryController {

    private final QueryService queryService;

    public QueryController(QueryService queryService) {
        this.queryService = queryService;
    }

    @GetMapping("/catalog")
    public CatalogResponse catalog() {
        return queryService.catalog();
    }

    @PostMapping("/query")
    public QueryResponse query(@RequestBody QueryRequest request) {
        return queryService.query(request);
    }

    @PostMapping("/replay/{receiptId}")
    public ResponseEntity<ReplayResponse> replay(@PathVariable String receiptId) {
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }

    @GetMapping("/receipts/{receiptId}")
    public Receipt receipt(@PathVariable String receiptId) {
        return queryService.receipt(receiptId);
    }
}
