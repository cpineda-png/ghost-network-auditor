-- Postgres over JDBC. Replace POSTGRES_USER and POSTGRES_PASSWORD before running.
-- Never commit real passwords.
CREATE DATASOURCE PLAN_PG DESCRIBE BY "plan directory" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://host.docker.internal:5432/plan",
  username "POSTGRES_USER", password "POSTGRES_PASSWORD", schema "public");
REGISTER DATASOURCE TABLES FROM PLAN_PG;

-- CSVs must already sit in the Zetaris shared folder.
-- inferSchema false keeps npi, zip, and month as text.
CREATE LIGHTNING DATABASE GNA_FILES DESCRIBE BY "roster and claims extracts";
CREATE LIGHTNING FILESTORE TABLE roster FROM GNA_FILES FORMAT CSV
  OPTIONS (PATH "/home/zetaris/customer-data/shared/roster.csv", header "true", inferSchema "false");
CACHE TABLE GNA_FILES.roster;
CREATE LIGHTNING FILESTORE TABLE claims FROM GNA_FILES FORMAT CSV
  OPTIONS (PATH "/home/zetaris/customer-data/shared/claims.csv", header "true", inferSchema "false");
CACHE TABLE GNA_FILES.claims;
