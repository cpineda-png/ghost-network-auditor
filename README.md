# Ghost Network Auditor

An agent system that tells a health plan's provider data analyst which directory listings are wrong or belong to ghost providers, proves each finding with evidence anyone can re-run, and learns from the analyst's rulings so each run needs less human help.

Built for the Open Agent Hackathon 2026, Track 1 (Solving Fragmented Intelligence).

## The problem

Provider directories are often wrong, and patients pay for it.

- A CMS review of Medicare Advantage online directories found that 48.74 percent of the locations it checked had at least one deficiency ([Becker's summary](https://www.beckershospitalreview.com/care-coordination/nearly-half-of-medicare-advantage-physician-directories-have-errors/); [CMS round 3 report, Nov 2018](https://CMS.gov/medicare/health-plans/managedcaremarketing/downloads/provider_directory_review_industry_report_round_3_11-28-2018.pdf)).
- In a 2023 Senate Finance Committee secret-shopper study of 120 calls to mental-health providers listed by 12 Medicare Advantage plans, staff could book an appointment only 18 percent of the time ([Committee release](https://www.finance.senate.gov/chairmans-news/wyden-calls-for-action-to-get-rid-of-ghost-networks-releases-secret-shopper-study)).

A "ghost" listing looks active but is not: the provider has moved, left the network, or stopped taking patients. Finding them means reconciling the plan directory against the credentialing roster, claims activity and the public NPI Registry, then deciding which source to trust.

## What it does

1. **Reconcile.** Agents compare each directory listing with the roster, claims counts and NPPES, field by field (address, phone, status, accepting new patients, specialty).
2. **Prove.** Every claim carries receipt IDs. A receipt records the query template, the SQL, the row count and a hash, and can be replayed to confirm the rows have not changed.
3. **Check.** A Critic replays the receipts and judges whether the evidence supports the proposed value.
4. **Route.** A Risk agent applies verified low-impact changes (address, phone, specialty). Ghost listings and any "status" or "accepting" change always go to the analyst queue.
5. **Learn.** Analyst rulings are stored in Meterless H-MEM. In later runs the Arbiter recalls rulings for the same group and the same stale value, so fewer cases are escalated.

The output is a corrected directory diff, an evidence card per listing, and an outreach queue that holds only the cases a human must decide.

## Agents

| Role | Model | Job |
| --- | --- | --- |
| Planner | Nemotron 3 Ultra | Chunks listings, ranks risk, picks templates |
| Contact investigator | Nemotron 3.5 Lightning | Address and phone claims from directory, roster, claims, NPPES |
| Ghost investigator | Nemotron 3.5 Lightning | Status, accepting and specialty (roster status, term date, no claims in the window) |
| Arbiter | Nemotron 3 Ultra | Resolves conflicts using H-MEM recall and source trust |
| Critic | Nemotron 3 Ultra | Replays receipts, then pass, revise (max 2 rounds) or reject |
| Risk | Rules | Applies or escalates; status and accepting always escalate |

Thresholds: confidence at least 0.70 goes to the Critic; 0.50 to 0.69 retries (max 2); below 0.50 escalates. Values are normalized in code, and models never invent values. All model calls go through Meterless Nightshift.

## Quick start (sample mode, no keys)

Sample mode replays recorded Zetaris results and recorded model responses. It needs no Zetaris, no Nightshift and no credentials.

```bash
npm ci
cp .env.example .env
docker compose up --build
```

Then open http://localhost:5173. The badge shows REPLAY.

### Run without Docker (three terminals)

Replay keys include the model names, so set them exactly as in `.env.example`.

```powershell
# 1. Gateway, from services/gateway
$env:SAMPLE_MODE="true"; .\mvnw.cmd spring-boot:run

# 2. Agents, from the repo root
$env:SAMPLE_MODE="true"; $env:LLM_REPLAY="true"; $env:GATEWAY_URL="http://127.0.0.1:8081"
$env:NEMOTRON_PLANNER_MODEL="nvidia/nemotron-3-ultra-550b-a55b"
$env:NEMOTRON_WORKER_MODEL="nvidia/nemotron-3.5-lightning-30b-a3b"
$env:DATA_AS_OF_MONTH="2026-10"; $env:RUN_OFFSET="80"; $env:RUN_LIMIT="20"
npm run start -w services/agents

# 3. Web, from the repo root
$env:AGENTS_URL="http://127.0.0.1:8080"; npm run dev -w apps/web
```

Open http://localhost:5173, check the REPLAY badge, choose batch A and press Start. Only this demo window (offset 80, limit 20) is recorded.

On Windows, if `docker compose up --build` fails with `Access is denied` (common when the repo is on OneDrive), build the images first, then start Compose without baking:

```bash
docker build -t ghost-network-auditor-gateway ./services/gateway
docker build -t ghost-network-auditor-agents -f services/agents/Dockerfile .
docker build -t ghost-network-auditor-web -f apps/web/Dockerfile .
docker compose up -d --no-build
```

**Demo path (recorded):** choose Batch A, press Start, watch the timeline fill, open an evidence card and its receipt (replay shows `match: true`), then rule on a ghost card in the outreach queue. Sample mode replays one recorded run, so other scopes or actions have no recording and will return an error. See [docs/limitations.md](docs/limitations.md).

Checks:

```bash
npm test
cd services/gateway && ./mvnw test
bash scripts/verify.sh
```

## Live setup

Fill in `.env` (never commit it):

- Nightshift: install and start Meterless Nightshift, add your NVIDIA key in its provider settings, then set `NIGHTSHIFT_BASE_URL`, `NIGHTSHIFT_TOKEN`, `NEMOTRON_PLANNER_MODEL` and `NEMOTRON_WORKER_MODEL` (the IDs Nightshift lists, for example `nvidia/nemotron-3-ultra-550b-a55b` and `nvidia/nemotron-3.5-lightning-30b-a3b`). Inside Docker, use `NIGHTSHIFT_DOCKER_BASE_URL` (`host.docker.internal`).
- Zetaris: JDBC URL and credentials, and the JDBC driver JAR in `drivers/` (not committed). Zetaris runs on the host (port 10000), not in Compose. Register the sources with `data/zetaris/register-sources.sql`, one statement at a time.
- Set `SAMPLE_MODE=false` and `LLM_REPLAY=false`.

## Data

All data is synthetic (generator seed 42, no patient data). Two batches of 300 listings each, a 184-provider roster, 3,330 claims rows and a recorded NPPES snapshot. About 45 percent of listings carry a planted error (address, phone, accepting, ghost or specialty, 27 each per batch), plus 30 decoys per batch that look different but are correct. One group, Sunrise Behavioral Group, moved and left stale addresses in several sources, which is what the memory demo uses. See [data/README.md](data/README.md) and `data/sample/generation_report.md`.

## Results

Live runs against Zetaris and Nemotron, scored by `eval/score.py` against the planted-error answer key (reports in `eval/reports/`). Scores are "touched-only": recall counts planted errors on the listings the run examined (30 listings, 150 fields per run), not the whole 300-listing batch.

| Run | Planted errors on touched listings | Detected | Applied | Wrong applies | Escalated | Decoy false positives | Ghost-safety violations | Missing receipts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cold, batch A | 30 | 30 (recall 1.00) | 0 | 0 | 30 | 0 | 0 | 0 |
| Warm, batch B (with memory) | 9 | 9 (recall 1.00) | 0 | 0 | 30 | 0 | 0 | 0 |
| Control, batch B (no memory) | 9 | 9 (recall 1.00) | 3 | 3 | 27 | 0 | 0 | 0 |

What this shows, and what it does not:

- The agents found every planted error on the listings they examined, applied nothing wrong, never applied a ghost or "not accepting" change, and every claim has a receipt.
- This version is conservative: in the cold run all 30 conflicts went to the analyst queue and none were applied automatically.
- Memory had a modest effect. Contact-field escalations in the warm run fell from 30 to 25, and the warm run applied nothing wrong, while the control run without memory auto-applied 3 wrong values. The Sunrise address cases were still escalated in the warm run (0 applied from memory).
- Precision is not reported as a headline because nothing was applied in the cold and warm runs (the scorer shows 1.00 for zero applied changes, which is not meaningful).
- The analyst in the cold-versus-warm script is simulated: it answers escalations using the answer key. It shows the memory mechanism, not real analyst accuracy.

## Pre-existing components

Declared as required by the hackathon rules:

- Meterless H-MEM and World Model reference implementations, vendored unchanged under `services/agents/vendor/` and wrapped by our adapters in `services/agents/src/memory/` and `services/agents/src/world/`.
- The synthetic-data generator and the NPPES snapshot format, written for this project. The repository's first commit is dated Oct 22, 2026, and all code in it was written during the hackathon apart from the vendored Meterless code above.
- Third-party libraries (Spring Boot, Express, React, Vite, zod, vitest) and the public NPI Registry as the shape of the NPPES data.

## More

- [Architecture](docs/architecture.md)
- [Sponsor technology](docs/sponsor-tech.md)
- [Limitations and failure modes](docs/limitations.md)
- [Evaluation](eval/README.md)
