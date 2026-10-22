# Meterless adapter mapping

Wrap the vendored reference implementations in `services/agents/vendor/`. Do not implement Meterless from scratch. Their reference already passes the conformance suite; running `npm test` in each `reference/` folder is enough. Do not target our adapters at the conformance runner.

## H-MEM

File: [services/agents/src/memory/hmem.ts](../services/agents/src/memory/hmem.ts)
Spec: [services/agents/vendor/hmem/AGENTS.md](../services/agents/vendor/hmem/AGENTS.md)
Reference: [services/agents/vendor/hmem/reference/](../services/agents/vendor/hmem/reference/)

Memory holds **analyst rulings**, not directory/roster/claims/NPPES rows. Source conflicts stay in the Arbiter.

| GNA use | Meterless service |
| --- | --- |
| Persist a ruling | `MemoryStoreService` — long-term memory, `source: user_correction`, `type: factual`, `confidence: 0.9`. H-MEM treats user corrections as high reliability in conflict resolution. |
| `GET /memory/trust` | `TrustLedgerService` |
| Later runs escalate fewer cases | `MemoryRetrievalService` — hybrid rank, reinject with trace |
| A newer ruling contradicts an older one | `ConflictDetectionService` — newer ruling supersedes the older. Do not send directory-versus-roster conflicts here. |

Dreaming and sleep can wait.

## World Model

File: [services/agents/src/world/worldModel.ts](../services/agents/src/world/worldModel.ts)
Spec: [services/agents/vendor/world-model/AGENTS.md](../services/agents/vendor/world-model/AGENTS.md)
Reference: [services/agents/vendor/world-model/reference/](../services/agents/vendor/world-model/reference/)

Keep the `WmEvent` append log as the input. Do not rebuild it as a timeline of snapshots.

Use the reference for:

- stable IDs (`listing:plan:…`, `provider:npi:…`, and `eventId` sha256 idempotency)
- idempotent append
- a **per-listing** projection on the read surface

Their guide already treats append-only observations as the source of truth. Claims, proposals and critiques become derived entities/edges; receipts stay provenance. Queries still go through gateway templates.
