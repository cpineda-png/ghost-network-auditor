# Generation report

Seed: 42

## Counts
- Roster providers: 184
- Individuals: 154
- Organizations: 30
- Claims rows: 3330
- NPPES results: 166
- Ghost NPIs omitted from NPPES: 18 of 54
- Listings batch A: 300 (170 primary, 130 satellite)
- Listings batch B: 300 (174 primary, 126 satellite)

## Error rate

- Batch A: 135/300 (45.0%)
- Batch B: 135/300 (45.0%)

## Error types

- address: A 27, B 27
- phone: A 27, B 27
- accepting: A 27, B 27
- ghost: A 27, B 27
- specialty: A 27, B 27

## Decoys

- Batch A: 30 (10 suite, 10 phone punctuation, 10 mailing)
- Batch B: 30 (10 suite, 10 phone punctuation, 10 mailing)

## Behavioral health
- 110/184 (59.8%)

## Sunrise Behavioral Group
- Roster NPIs: 13
- Directory rows: 62
- Address-error listings: 13
- Batch A address-error listings: 9
- Batch B address-error listings: 4
- Clinicians only in batch B: 4
- Roster practice address (`address_line1`): 900 Old Pier St for all 13 NPIs. Credentialing was not updated after the move.
- Claims service address and NPPES LOCATION: 100 Harbor Sample Ave.
- Directory address-error rows use 900 Old Pier St and are labeled `address` with true_value 100 Harbor Sample Ave. That is 9 listings in batch A and 4 listings in batch B.
- The 9 returning NPIs keep a phone error in batch B. Their batch B directory address is 100 Harbor Sample Ave, and those listings have no address label.
- On the address-error rows the conflict is two sources against two: directory and roster at 900 Old Pier St, claims and NPPES at 100 Harbor Sample Ave.

## Taxonomy codes

- `2084P0800X` Psychiatry (individual, behavioral health)
- `103T00000X` Psychologist (individual, behavioral health)
- `363LP0808X` Nurse Practitioner, Psychiatric/Mental Health (individual, behavioral health)
- `101YM0800X` Counselor, Mental Health (individual, behavioral health)
- `261QM0801X` Clinic/Center, Mental Health (organization, behavioral health)
- `251S00000X` Community/Behavioral Health Agency (organization, behavioral health)
- `207Q00000X` Family Medicine (individual, other)
- `207R00000X` Internal Medicine (individual, other)
- `208000000X` Pediatrics (individual, other)
- `207V00000X` Obstetrics & Gynecology (individual, other)
- `207P00000X` Emergency Medicine (individual, other)
- `207X00000X` Orthopaedic Surgery (individual, other)
- `363L00000X` Nurse Practitioner (individual, other)
- `363A00000X` Physician Assistant (individual, other)
- `225100000X` Physical Therapist (individual, other)
- `1223G0001X` Dentist, General Practice (individual, other)
- `261QP2300X` Clinic/Center, Primary Care (organization, other)
- `261QM1300X` Clinic/Center, Multi-Specialty (organization, other)
- `261QC1500X` Clinic/Center, Community Health (organization, other)
