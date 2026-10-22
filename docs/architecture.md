# Architecture

Ghost Network Auditor is a local multi-agent stack:

- `apps/web` (port 5173) talks to `services/agents` (port 8080) through `/api`.
- `services/agents` talks to `services/gateway` (port 8081).
- The gateway talks to Postgres (port 5432) and, when configured, Zetaris JDBC on the host (port 10000).

## Limits

- Gateway `/health` Zetaris check: 5 second timeout; never blocks startup.
- Agents `/health` gateway check: 3 second timeout.
- Arbiter thresholds (`contracts` `THRESHOLDS`): confidence >= 0.70 goes to the Critic; 0.50 to 0.69 retries (max 2); < 0.50 escalates.
- Critic: max 2 revision rounds, then escalate.
- Agents query data only through gateway templates. Every claim carries at least one receipt ID.
