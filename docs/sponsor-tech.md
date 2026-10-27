# Sponsor technology

How each sponsor technology is used, and where to see proof.

## Zetaris: the data layer

All source data is queried through Zetaris.

- The plan directory is a Postgres database registered as a Zetaris datasource (`PLAN_PG`). The credentialing roster and the claims counts are CSV extracts registered as Zetaris filestore tables (`GNA_FILES.roster`, `GNA_FILES.claims`). NPPES comes from a recorded snapshot in this version.
- The Spring Boot gateway (`services/gateway`) is the only component that talks to Zetaris, over JDBC (driver loaded at runtime from `drivers/`). Agents cannot write SQL. They call allowlisted query templates (`directory_batch`, `roster_by_npis`, `claims_by_npis`, `nppes_by_npis`), defined in `services/gateway/src/main/resources/templates.yml`.
- Every query returns a receipt: template ID, rendered SQL, parameters, row count, rows hash, a preview of the rows, timestamp and mode (`live` or `replayed`). `POST /replay/{receiptId}` re-runs the query and reports whether the rows still match. The Critic uses this, and the UI shows it as the replay `match` flag.
- Failure behavior (Zetaris down, driver restart, tampered receipt, bad table) is exercised by `scripts/failure-tests` and documented in [limitations.md](limitations.md).

## Meterless engines

**H-MEM (long-term memory, working feature with passing tests).** The analyst's ruling on an escalated case is stored in H-MEM as a high-confidence correction (`source: user_correction`, `type: factual`, `confidence: 0.9`) together with the group name, the chosen source and value, and the rejected sources. In later runs the Arbiter recalls matching rulings (same group, same stale value) and cites the memory IDs in its proposal, so the case no longer needs a human. Helpful and wrong feedback on rulings fills the per-source trust table (`GET /memory/trust`). Adapter: `services/agents/src/memory/hmem.ts`. Tests: `services/agents/src/memory/hmem.test.ts` and the loop tests, plus the vendored reference suite output in `docs/engine-tests/hmem.txt` (10 passed).

**World Model (event log).** Every step of a run is an append-only `WmEvent` with a stable ID and idempotent append. The live timeline in the UI and the evidence cards are projections of that log. Adapter: `services/agents/src/world/worldModel.ts`. Tests: `worldModel.test.ts`, plus `docs/engine-tests/world-model.txt` (10 passed).

Both engines are Meterless reference implementations vendored under `services/agents/vendor/`; our code is the adapter layer and the agent logic around them.

**Nightshift (primary AI provider).** Every model call goes through Meterless Nightshift, an OpenAI-compatible proxy at `NIGHTSHIFT_BASE_URL`, with the header `meterless-app: ghost-network-auditor`. The app never calls NVIDIA directly. Nightshift returns a signed compute receipt on each response; we store the receipt ID and the routed model in the payload of every model-driven event, so the logs show which model handled each request (visible as a chip on each timeline row).

## NVIDIA Nemotron

- **Nemotron 3 Ultra** (`nvidia/nemotron-3-ultra-550b-a55b`): planner, arbiter and critic.
- **Nemotron 3.5 Lightning** (`nvidia/nemotron-3.5-lightning-30b-a3b`): investigators, and the fallback when Ultra fails.
- Nemotron 3 Super was our first choice but is not enabled for our NVIDIA key, so Ultra took its roles. Nightshift did not pass the "thinking" option through, so the Critic runs without it.
- Models never supply values. Values are extracted and normalized in code from query results; the models summarize, rank and judge, and every response is validated against a schema (one retry, then escalate). A test confirms that instructions hidden in data fields stay data.

## Cursor

The repository was built with Cursor agents working in separate git worktrees (one agent per lane: gateway, agents, web, eval), each started in Plan Mode with a written brief.
