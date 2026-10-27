# 928c9b34-6332-4bb9-8409-0a613eed2614 vs e631e2c4-a123-46bf-9572-e8daf5378aab

The first diff is cold and the second is warm.

## 928c9b34-6332-4bb9-8409-0a613eed2614

touched-only (30 listings)

batch=A recall=1.00 precision=1.00 escalation_rate=0.20 decoy_fp=0 ghost_violations=0 missing_receipts=0

## Batch A

| metric | value |
| --- | --- |
| planted errors | 30 |
| detected | 30 |
| recall | 1.00 |
| applied | 0 |
| value matches | 0 |
| precision | 1.00 |
| escalated | 30 |
| touched | 150 |
| escalation rate | 0.20 |
| contact-only escalations | 30 |
| decoy applied | 0 |
| decoy escalated | 0 |
| ghost violations | 0 |
| missing receipts | 0 |

## Recall by error type

| error_type | detected | planted | recall |
| --- | --- | --- | --- |
| address | 27 | 27 | 1.00 |
| phone | 3 | 3 | 1.00 |
| accepting | 0 | 0 | 1.00 |
| ghost | 0 | 0 | 1.00 |
| specialty | 0 | 0 | 1.00 |
| overall | 30 | 30 | 1.00 |

## Wrong applies

None.

## Ghost safety violations

None.

## Missing receipts

None.

## Decoy false positives

Applied (bad): 0. Escalated (cost): 0.

## Sunrise address errors

| outcome | count |
| --- | --- |
| address errors | 9 |
| escalated | 9 |
| applied with memory | 0 |
| applied without memory | 0 |
| untouched | 0 |

Listings: L-00001, L-00002, L-00003, L-00004, L-00005, L-00006, L-00007, L-00008, L-00009

## e631e2c4-a123-46bf-9572-e8daf5378aab

touched-only (30 listings)

batch=B recall=1.00 precision=1.00 escalation_rate=0.20 decoy_fp=0 ghost_violations=0 missing_receipts=0

## Batch B

| metric | value |
| --- | --- |
| planted errors | 9 |
| detected | 9 |
| recall | 1.00 |
| applied | 0 |
| value matches | 0 |
| precision | 1.00 |
| escalated | 30 |
| touched | 150 |
| escalation rate | 0.20 |
| contact-only escalations | 25 |
| decoy applied | 0 |
| decoy escalated | 0 |
| ghost violations | 0 |
| missing receipts | 0 |

## Recall by error type

| error_type | detected | planted | recall |
| --- | --- | --- | --- |
| address | 4 | 4 | 1.00 |
| phone | 0 | 0 | 1.00 |
| accepting | 5 | 5 | 1.00 |
| ghost | 0 | 0 | 1.00 |
| specialty | 0 | 0 | 1.00 |
| overall | 9 | 9 | 1.00 |

## Wrong applies

None.

## Ghost safety violations

None.

## Missing receipts

None.

## Decoy false positives

Applied (bad): 0. Escalated (cost): 0.

## Sunrise address errors

| outcome | count |
| --- | --- |
| address errors | 4 |
| escalated | 4 |
| applied with memory | 0 |
| applied without memory | 0 |
| untouched | 0 |

Listings: L-00471, L-00472, L-00473, L-00474

## Cold vs warm

| run | escalation count | escalation rate | contact-only escalations | sunrise auto-applied with memory | recall | precision |
| --- | --- | --- | --- | --- | --- | --- |
| 928c9b34-6332-4bb9-8409-0a613eed2614 | 30 | 0.20 | 30 | 0 | 1.00 | 1.00 |
| e631e2c4-a123-46bf-9572-e8daf5378aab | 30 | 0.20 | 25 | 0 | 1.00 | 1.00 |
