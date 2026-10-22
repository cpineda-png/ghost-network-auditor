# Data

Four sources feed the auditor:

| Source | What it is | License |
| --- | --- | --- |
| Directory | Synthetic plan provider directory in Postgres (`directory_listing`) | Generated for this project |
| Roster | Synthetic credentialing roster CSV | Generated for this project |
| Claims | Synthetic claims activity counts CSV | Generated for this project |
| NPPES | Public NPI Registry API v2.1 (organizations) | CMS NPI Registry terms of use |

All internal data is synthetic; no patient data; generated after the build window opened on Oct 22, 2026.

TODO: implement `data/generator` to emit roster.csv, claims.csv and directory rows.
