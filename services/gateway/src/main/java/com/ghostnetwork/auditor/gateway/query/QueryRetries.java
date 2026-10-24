package com.ghostnetwork.auditor.gateway.query;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Retries a live query after a transient connection failure. The wait schedule is 1s, 2s, then 4s,
 * and a wait is skipped once it would push the elapsed time past {@link #BUDGET_MILLIS}.
 */
@Component
public class QueryRetries {

    static final long BUDGET_MILLIS = 15_000;
    static final long[] BACKOFF_MILLIS = {1_000L, 2_000L, 4_000L};

    private final Clock clock;
    private final Sleeper sleeper;

    @Autowired
    public QueryRetries() {
        this(Clock.systemUTC(), QueryRetries::sleep);
    }

    QueryRetries(Clock clock, Sleeper sleeper) {
        this.clock = clock;
        this.sleeper = sleeper;
    }

    public <T> T run(Attempt<T> attempt) {
        long started = clock.millis();
        int waits = 0;
        while (true) {
            try {
                return attempt.get();
            } catch (ConnectionFailedException ex) {
                if (!SqlFailures.transientConnection(ex) || waits >= BACKOFF_MILLIS.length) {
                    throw ex;
                }
                long wait = BACKOFF_MILLIS[waits];
                if (clock.millis() - started + wait > BUDGET_MILLIS) {
                    throw ex;
                }
                sleeper.sleep(wait);
                waits++;
            }
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Retry interrupted", ex);
        }
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(long millis);
    }

    @FunctionalInterface
    public interface Attempt<T> {
        T get();
    }
}
