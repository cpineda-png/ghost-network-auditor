package com.ghostnetwork.auditor.gateway.query;

import com.ghostnetwork.auditor.gateway.api.dto.CatalogParam;
import com.ghostnetwork.auditor.gateway.api.dto.CatalogResponse;
import com.ghostnetwork.auditor.gateway.api.dto.CatalogTemplate;
import com.ghostnetwork.auditor.gateway.api.dto.QueryRequest;
import com.ghostnetwork.auditor.gateway.api.dto.QueryResponse;
import com.ghostnetwork.auditor.gateway.api.dto.Receipt;
import java.sql.SQLException;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class QueryService {

    private static final Logger log = LoggerFactory.getLogger(QueryService.class);

    private final TemplateRegistry templates;
    private final ParamValidator validator;
    private final SqlBuilder sqlBuilder;
    private final QueryExecutor executor;
    private final SampleStore samples;
    private final ReceiptStore receipts;
    private final Environment environment;

    public QueryService(
            TemplateRegistry templates,
            ParamValidator validator,
            SqlBuilder sqlBuilder,
            QueryExecutor executor,
            SampleStore samples,
            ReceiptStore receipts,
            Environment environment
    ) {
        this.templates = templates;
        this.validator = validator;
        this.sqlBuilder = sqlBuilder;
        this.executor = executor;
        this.samples = samples;
        this.receipts = receipts;
        this.environment = environment;
    }

    public CatalogResponse catalog() {
        List<CatalogTemplate> listed = new ArrayList<>();
        for (TemplateDefinition template : templates.templates()) {
            List<CatalogParam> params = new ArrayList<>();
            for (ParamDefinition param : template.params()) {
                List<String> allowed = param.allowed().isEmpty() ? null : param.allowed();
                params.add(new CatalogParam(param.name(), param.type(), param.required(), allowed));
            }
            listed.add(new CatalogTemplate(
                    template.id(),
                    template.description(),
                    List.copyOf(params),
                    List.of(sqlBuilder.sourceTable(template.source()))));
        }
        return new CatalogResponse(List.copyOf(listed));
    }

    public QueryResponse query(QueryRequest request) {
        if (request == null) {
            throw new QueryRejectedException("templateId is required");
        }
        requireText(request.runId(), "runId");
        requireText(request.requestedBy(), "requestedBy");
        ParamValidator.ValidatedQuery validated = validator.validate(request.templateId(), request.params());
        SqlBuilder.BoundQuery bound = sqlBuilder.build(validated.template(), validated.params());
        long started = System.nanoTime();
        Fetched fetched = fetch(validated, bound);
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        List<Map<String, String>> rows = fetched.rows();
        List<Object> preview = new ArrayList<>();
        for (int i = 0; i < Math.min(20, rows.size()); i++) {
            preview.add(rows.get(i));
        }
        Receipt receipt = new Receipt(
                ReceiptIds.receiptId(validated.template().id(), validated.canonicalParams(), request.runId()),
                request.runId(),
                validated.template().id(),
                bound.displaySql(),
                validated.params(),
                List.of(sqlBuilder.sourceTable(validated.template().source())),
                rows.size(),
                ReceiptIds.rowsHash(CanonicalJson.of(rows)),
                preview,
                DateTimeFormatter.ISO_INSTANT.format(Instant.now()),
                fetched.mode(),
                durationMs);
        receipts.save(receipt, fetched.columns(), rows);
        return new QueryResponse(receipt, fetched.columns(), new ArrayList<>(rows));
    }

    public Receipt receipt(String receiptId) {
        return receipts.get(receiptId);
    }

    private Fetched fetch(ParamValidator.ValidatedQuery validated, SqlBuilder.BoundQuery bound) {
        if (sampleMode()) {
            SampleStore.Sample sample = recordedSample(validated)
                    .orElseThrow(() -> new QueryUnavailableException("No sample is recorded for this query"));
            return new Fetched(sample.columns(), sample.rows(), "replayed");
        }
        try {
            QueryResult result = executor.execute(bound);
            log.info(
                    "Query {} completed using {}",
                    validated.template().id(),
                    result.prepared() ? "a prepared statement" : "literal SQL");
            if (recordMode()) {
                samples.record(validated.template().id(), validated.canonicalParams(), result.columns(), result.rows());
            }
            return new Fetched(result.columns(), result.rows(), "live");
        } catch (QueryFailedException ex) {
            log.warn(
                    "Query {} failed ({}, sqlState={})",
                    validated.template().id(),
                    ex.error(),
                    ex.sqlState());
            throw ex.withTemplate(validated.template().id());
        } catch (QueryUnavailableException ex) {
            Optional<SampleStore.Sample> sample = recordedSample(validated);
            log.warn(
                    "Live query for {} did not complete ({}){}",
                    validated.template().id(),
                    failureReason(ex),
                    sample.isPresent() ? "; serving the recorded sample" : "");
            if (sample.isEmpty()) {
                throw new QueryUnavailableException("Zetaris query failed and no sample is recorded");
            }
            return new Fetched(sample.get().columns(), sample.get().rows(), "replayed");
        }
    }

    private Optional<SampleStore.Sample> recordedSample(ParamValidator.ValidatedQuery validated) {
        return samples.read(validated.template().id(), validated.canonicalParams());
    }

    private boolean sampleMode() {
        return Boolean.parseBoolean(environment.getProperty("SAMPLE_MODE"));
    }

    private boolean recordMode() {
        return Boolean.parseBoolean(environment.getProperty("RECORD_MODE"));
    }

    private static String failureReason(QueryUnavailableException failure) {
        Throwable cause = failure.getCause();
        if (cause instanceof SQLException sql) {
            String state = sql.getSQLState();
            if (state == null || state.isBlank()) {
                return sql.getClass().getSimpleName();
            }
            return sql.getClass().getSimpleName() + " sqlState=" + state;
        }
        if (cause == null) {
            return failure.getMessage();
        }
        return cause.getClass().getSimpleName();
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new QueryRejectedException(name + " is required");
        }
    }

    private record Fetched(List<String> columns, List<Map<String, String>> rows, String mode) {
    }
}
