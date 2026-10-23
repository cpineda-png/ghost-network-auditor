package com.ghostnetwork.auditor.gateway.api;

import com.ghostnetwork.auditor.gateway.api.dto.ErrorMessage;
import com.ghostnetwork.auditor.gateway.api.dto.QueryError;
import com.ghostnetwork.auditor.gateway.query.QueryFailedException;
import com.ghostnetwork.auditor.gateway.query.QueryRejectedException;
import com.ghostnetwork.auditor.gateway.query.QueryUnavailableException;
import com.ghostnetwork.auditor.gateway.query.ReceiptNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(QueryRejectedException.class)
    public ResponseEntity<ErrorMessage> rejected(QueryRejectedException failure) {
        return ResponseEntity.badRequest().body(new ErrorMessage(failure.getMessage()));
    }

    @ExceptionHandler(QueryFailedException.class)
    public ResponseEntity<QueryError> failed(QueryFailedException failure) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new QueryError(failure.error(), failure.templateId(), failure.sqlState()));
    }

    @ExceptionHandler(QueryUnavailableException.class)
    public ResponseEntity<ErrorMessage> unavailable(QueryUnavailableException failure) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ErrorMessage(failure.getMessage()));
    }

    @ExceptionHandler(ReceiptNotFoundException.class)
    public ResponseEntity<Void> missing(ReceiptNotFoundException failure) {
        return ResponseEntity.notFound().build();
    }
}
