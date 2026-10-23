# Data

Four sources feed the auditor:

| Source | What it is | License |
| --- | --- | --- |
| Directory | Synthetic plan provider directory in Postgres (`directory_listing`) | Generated for this project |
| Roster | Synthetic credentialing roster CSV | Generated for this project |
| Claims | Synthetic claims activity counts CSV | Generated for this project |
| NPPES | Public NPI Registry API v2.1 (organizations) | CMS NPI Registry terms of use |

All internal data is synthetic; no patient data; generated after the build window opened on Oct 22, 2026.

Seed 42, from `py -3 data/generator/generate.py --seed 42` (or `python3` elsewhere):

| File | Columns | Rows |
| --- | --- | --- |
| `sample/seed.sql` | `listing_id`, `batch`, `npi`, `provider_name`, `provider_type`, `specialty`, `group_name`, `address_line1`, `city`, `state`, `zip`, `phone`, `accepting_new_patients`, `network_status`, `last_verified_date`, `county` | 600 listings, 300 in batch A and 300 in batch B |
| `sample/roster.csv` | `npi`, `provider_name`, `provider_type`, `group_name`, `taxonomy_code`, `specialty`, `status`, `effective_date`, `term_date`, `address_line1`, `city`, `state`, `zip`, `phone` | 184 providers |
| `sample/claims.csv` | `npi`, `service_address_line1`, `service_zip`, `month`, `claim_count`, `new_patient_count` | 3330 count rows, no patient rows |
| `sample/nppes_snapshot.json` | `result_count`, `results[]` with `number`, `enumeration_type`, `basic`, `addresses[]`, `taxonomies[]` | 166 results |
| `sample/labels.csv` | `listing_id`, `field`, `error_type`, `true_value`, `is_decoy`, `notes` | 330 answer-key rows |
| `sample/generation_report.md` | counts, error rates, Sunrise pattern, taxonomy list | one report |

`nppes_snapshot.json` also holds synthetic organizations, because live NPPES never returns synthetic NPIs. `labels.csv` is the answer key and is read by `eval/` and by the generator tests.
