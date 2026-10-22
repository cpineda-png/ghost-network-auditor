-- Postgres over JDBC
CREATE DATASOURCE PLAN_PG DESCRIBE BY "plan directory" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://POSTGRES_HOST:5432/plan",
  username "POSTGRES_USER", password "POSTGRES_PASSWORD", schema "public");
REGISTER DATASOURCE TABLES FROM PLAN_PG;

-- CSVs, after uploading them in the Zetaris UI (NDP File System, then Virtual File Sources)
CREATE LIGHTNING DATABASE GNA_FILES DESCRIBE BY "roster and claims extracts";
CREATE LIGHTNING FILESTORE TABLE roster FROM GNA_FILES FORMAT CSV
  OPTIONS (PATH "FILE_STORE_PATH/roster.csv", header "true", inferSchema "true");
CACHE TABLE GNA_FILES.roster;
CREATE LIGHTNING FILESTORE TABLE claims FROM GNA_FILES FORMAT CSV
  OPTIONS (PATH "FILE_STORE_PATH/claims.csv", header "true", inferSchema "true");
CACHE TABLE GNA_FILES.claims;

-- NPPES organizations over REST, cached so queries don't call the API again
CREATE LIGHTNING DATABASE NPPES DESCRIBE BY "NPI Registry API v2.1";
CREATE LIGHTNING REST TABLE orgs_raw FROM NPPES REQUEST(
  endpoint "https://npiregistry.cms.hhs.gov/api/?version=2.1&enumeration_type=NPI-2&postal_code=112*&limit=200",
  method "get", response_type "json", http_encoding "URLENCODED"
) HEADER (user-agent "ghost-network-auditor CONTACT_EMAIL") BODY ();
CACHE TABLE NPPES.orgs_raw;
CREATE SCHEMASTORE CONTAINER gna;
CREATE SCHEMASTORE VIEW nppes_org_locations WITH CONTAINER gna AS
SELECT r.number AS npi, r.basic.organization_name AS org_name,
       r.addresses[0].address_1 AS address_1, r.addresses[0].postal_code AS postal_code,
       r.addresses[0].telephone_number AS phone
FROM NPPES.orgs_raw LATERAL VIEW explode(results) AS r;
