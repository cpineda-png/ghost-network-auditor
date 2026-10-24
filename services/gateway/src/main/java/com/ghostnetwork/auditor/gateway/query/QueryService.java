package com.ghostnetwork.auditor.gateway.query;

import com.ghostnetwork.auditor.gateway.api.dto.CatalogParam;
import com.ghostnetwork.auditor.gateway.api.dto.CatalogResponse;
import com.ghostnetwork.auditor.gateway.api.dto.CatalogTemplate;
import com.ghostnetwork.auditor.gateway.api.dto.QueryRequest;
import com.ghostnetwork.auditor.gateway.api.dto.QueryResponse;
import com.ghostnetwork.auditor.gateway.api.dto.Receipt;
import com.ghostnetwork.auditor.gateway.api.dto.ReplayResponse;
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
    private final NppesSnapshot nppes;
    private final QueryRetries retries;
    private final Environment environment;

    public QueryService(
            TemplateRegistry templates,
            ParamValidator validator,
            SqlBuilder sqlBuilder,
            QueryExecutor executor,
            SampleStore samples,
            ReceiptStore receipts,
            NppesSnapshot nppes,
            QueryRetries retries,
            Environment environment
    ) {
        this.templates = templates;
        this.validator = validator;
        this.sqlBuilder = sqlBuilder;
        this.executor = executor;
        this.samples = samples;
        this.receipts = receipts;
        this.nppes = nppes;
        this.retries = retries;
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
                    sourcesFor(template)));
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
        long started = System.nanoTime();
        Executed executed = execute(validated);
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        List<Map<String, String>> rows = executed.fetched().rows();
        List<Object> preview = new ArrayList<>();
        for (int i = 0; i < Math.min(20, rows.size()); i++) {
            preview.add(rows.get(i));
        }
        Receipt receipt = new Receipt(
                ReceiptIds.receiptId(validated.template().id(), validated.canonicalParams(), request.runId()),
                request.runId(),
                validated.template().id(),
                executed.sql(),
                validated.params(),
                executed.sources(),
                rows.size(),
                ReceiptIds.rowsHash(CanonicalJson.of(rows)),
                preview,
                DateTimeFormatter.ISO_INSTANT.format(Instant.now()),
                executed.fetched().mode(),
                durationMs);
        receipts.save(receipt, executed.fetched().columns(), rows);
        return new QueryResponse(receipt, executed.fetched().columns(), new ArrayList<>(rows));
    }

    public ReplayResponse replay(String receiptId) {
        ReceiptStore.ReceiptDocument document = receipts.load(receiptId);
        Receipt stored = document.receipt();
        boolean intact = intact(document);
        ParamValidator.ValidatedQuery validated = validator.validate(stored.templateId(), stored.params());
        Executed executed = execute(validated);
        String newRowsHash = ReceiptIds.rowsHash(CanonicalJson.of(executed.fetched().rows()));
        boolean match = intact && newRowsHash.equals(stored.rowsHash());
        return new ReplayResponse(
                receiptId,
                match,
                stored.rowsHash(),
                newRowsHash,
                new ArrayList<>(executed.fetched().rows()));
    }

    public Receipt receipt(String receiptId) {
        return receipts.get(receiptId);
    }

    private Executed execute(ParamValidator.ValidatedQuery validated) {
        if (isSnapshot(validated.template())) {
            List<String> npis = npis(validated);
            List<Map<String, String>> rows = nppes.rows(npis);
            String mode = sampleMode() ? "replayed" : "live";
            return new Executed(
                    NppesSnapshot.describe(npis),
                    List.of("nppes_snapshot"),
                    new Fetched(validated.template().columns(), rows, mode));
        }
        SqlBuilder.BoundQuery bound = sqlBuilder.build(validated.template(), validated.params());
        return new Executed(
                bound.displaySql(),
                List.of(sqlBuilder.sourceTable(validated.template().source())),
                fetch(validated, bound));
    }

    private List<String> sourcesFor(TemplateDefinition template) {
        if (isSnapshot(template)) {
            return List.of("nppes_snapshot");
        }
        return List.of(sqlBuilder.sourceTable(template.source()));
    }

    private static boolean isSnapshot(TemplateDefinition template) {
        return "nppes_snapshot".equals(template.source());
    }

    @SuppressWarnings("unchecked")
    private static List<String> npis(ParamValidator.ValidatedQuery validated) {
        return (List<String>) validated.params().get("npis");
    }

    private static boolean intact(ReceiptStore.ReceiptDocument document) {
        if (document.rows() == null || document.receipt().rowsHash() == null) {
            return false;
        }
        String recomputed = ReceiptIds.rowsHash(CanonicalJson.of(document.rows()));
        return document.receipt().rowsHash().equals(recomputed);
    }

    private Fetched fetch(ParamValidator.ValidatedQuery validated, SqlBuilder.BoundQuery bound) {
        if (sampleMode()) {
            SampleStore.Sample sample = recordedSample(validated)
                    .orElseThrow(() -> new QueryUnavailableException("No sample is recorded for this query"));
            return new Fetched(sample.columns(), sample.rows(), "replayed");
        }
        try {
            QueryResult result = retries.run(() -> executor.execute(bound));
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
            if (sample.isEmpty()) {
                throw new QueryUnavailableException("Zetaris query failed and no sample is recorded");
            }
            log.warn(
                    "FALLBACK template={} reason={} mode=replayed",
                    validated.template().id(),
                    reasonClass(ex));
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

    static String reasonClass(Throwable failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth < 8) {
            if (current instanceof SQLException) {
                return current.getClass().getSimpleName();
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

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new QueryRejectedException(name + " is required");
        }
    }

    private record Fetched(List<String> columns, List<Map<String, String>> rows, String mode) {
    }

    private record Executed(String sql, List<String> sources, Fetched fetched) {
    }
}
