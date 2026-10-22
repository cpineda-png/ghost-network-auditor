CREATE TABLE directory_listing (
  listing_id             TEXT PRIMARY KEY,
  batch                  TEXT NOT NULL CHECK (batch IN ('A', 'B')),
  npi                    CHAR(10) NOT NULL,
  provider_name          TEXT NOT NULL,
  provider_type          TEXT NOT NULL CHECK (provider_type IN ('individual', 'organization')),
  specialty              TEXT,
  group_name             TEXT,
  address_line1          TEXT,
  city                   TEXT,
  state                  CHAR(2),
  zip                    TEXT,
  phone                  TEXT,
  accepting_new_patients BOOLEAN,
  network_status         TEXT CHECK (network_status IN ('in', 'out')),
  last_verified_date     DATE,
  county                 TEXT
);
