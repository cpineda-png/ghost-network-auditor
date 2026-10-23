# Ghost Network Auditor

## What it is

A multi-agent system for a health plan's provider data analyst. Agents reconcile provider directory listings against a credentialing roster, claims activity counts and the public NPI Registry (NPPES), all queried through Zetaris. Every query result carries an evidence receipt. Analyst rulings are stored in Meterless H-MEM. Product models are NVIDIA Nemotron. All internal data is synthetic; there is no patient data anywhere.

## Quick start in replay mode

After cloning, run `npm ci` at the repo root.

```bash
cp .env.example .env
docker compose up --build
```

On Windows, if `docker compose up --build` fails with `Access is denied` (common when the repo is on OneDrive), build the images first, then start Compose without baking:

```bash
docker build -t ghost-network-auditor-gateway ./services/gateway
docker build -t ghost-network-auditor-agents -f services/agents/Dockerfile .
docker build -t ghost-network-auditor-web -f apps/web/Dockerfile .
docker compose up -d --no-build
```

Then open http://localhost:5173. With the default `.env`, the UI shows a REPLAY badge and no NVIDIA or Zetaris keys are required.

```bash
npm test
cd services/gateway && ./mvnw test
bash scripts/verify.sh
```

## Live setup

Fill in `.env` (never commit it): NVIDIA API key and Nemotron model names, Zetaris JDBC URL and credentials, and place the Zetaris JDBC driver JAR in `drivers/` (not committed). Leave `ZETARIS_JDBC_JAR` empty to use the single JAR in `drivers/`. The gateway loads that JAR in an isolated class loader so the driver's logging libraries stay off Spring's classpath. Set `SAMPLE_MODE=false` and `LLM_REPLAY=false`. Zetaris runs on the host (JDBC port 10000), not in Compose. Register sources with `data/zetaris/register-sources.sql` in the Zetaris SQL editor, one statement at a time.

## Architecture

See [docs/architecture.md](docs/architecture.md).

## Sponsor tech

See [docs/sponsor-tech.md](docs/sponsor-tech.md).

## Limitations

See [docs/limitations.md](docs/limitations.md).
