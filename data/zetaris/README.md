# Zetaris source registration

Run the statements in `register-sources.sql` **one at a time** in the Zetaris SQL editor.

Replace `POSTGRES_USER` and `POSTGRES_PASSWORD` before running. Never commit real passwords.

## Postgres

`CREATE DATASOURCE PLAN_PG` uses `jdbc:postgresql://host.docker.internal:5432/plan`. Zetaris runs on the host and reaches the Compose Postgres through that hostname. `REGISTER DATASOURCE TABLES FROM PLAN_PG` publishes `PLAN_PG.directory_listing`, which is the gateway default for `GNA_TABLE_DIRECTORY`.

## CSV files

Zetaris only accepts file-store paths under its local root `/home/zetaris/customer-data/shared/`. An upload through NDP File System lands in an org folder, so the files have to be copied into `shared/` first. From the Zetaris install folder:

```bash
docker compose exec driver cp <org folder>/…/roster.csv <org folder>/…/claims.csv /home/zetaris/customer-data/shared/
```

To skip the UI, copy the repo files straight into that folder:

```bash
scripts/zetaris-stage-csvs.sh <zetaris-compose-folder>
scripts/zetaris-stage-csvs.ps1 <zetaris-compose-folder>
```

Then run the five file-store statements the script prints (create `GNA_FILES`, create `roster`, cache `roster`, create `claims`, cache `claims`).

`inferSchema "false"` keeps `npi`, `zip`, and `month` as text. With inference, Zetaris turns those columns into numbers or dates, and the gateway's string comparisons and `YYYY-MM` filters no longer match.

## After a restart

`CACHE TABLE` is stored in memory and is lost when the driver stops. After any Zetaris restart, re-run the two CACHE TABLE statements:

```sql
CACHE TABLE GNA_FILES.roster;
CACHE TABLE GNA_FILES.claims;
```

## NPPES

NPPES is served by the gateway from `data/sample/nppes_snapshot.json`. Live NPPES REST is future work.

## Check

`scripts/zetaris-check.ps1` (or `.sh`) calls `directory_batch`, `roster_by_npis`, and `claims_by_npis` and prints `template mode rowCount`. It exits 1 if any mode is not `live`.
