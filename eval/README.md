# Eval

Scores agent runs against `data/sample/labels.csv`. Only `eval/` reads that answer key.

## Run diff

The agents service emits `GET /runs/:id/diff.csv`. One row per listing and field the run touched:

`run_id,listing_id,field,old_value,new_value,winning_source,status,confidence,receipt_ids,memory_ids`

- `field`: `address|phone|status|specialty|accepting`
- `status`: `applied|escalated|unchanged`
- `winning_source`: `directory|roster|claims|nppes`, empty when the row is escalated
- `receipt_ids`, `memory_ids`: `;`-separated, may be empty
- `confidence`: 0 to 1, empty if escalated without a proposal

## Score

Windows:

```bash
py -3 eval/score.py --diff eval/fixtures/perfect_A.csv --labels data/sample/labels.csv --out eval/reports/perfect_A.md
py -3 eval/score.py --diff eval/fixtures/cold_A.csv --diff eval/fixtures/warm_B.csv --out eval/reports/cold_vs_warm.md
py -3 -m unittest discover eval -v
```

Elsewhere, use `python3` instead of `py -3`.

Pass one `--diff`, or two in cold-then-warm order. The second file adds the cold vs warm table. `--labels` defaults to `data/sample/labels.csv`. `--out` defaults to `eval/reports/<diff stem>.md`. Reports in that folder stay untracked.

Stdout is one line per diff:

`batch=A recall=0.00 precision=0.00 escalation_rate=0.00 decoy_fp=0 ghost_violations=0 missing_receipts=0`

The scorer joins each `listing_id` to its batch through `data/sample/seed.sql`. A diff must stay inside one batch. Recall uses every planted error in that batch, including listings the diff never touches. `decoy_fp` counts decoy labels the run applied. Escalated decoys are reported separately as cost.

An applied `status` or `accepting` row is a ghost-safety violation whether or not that listing has a label. Changing either field always needs a human. Escalating the row is not a violation. Applied rows with an empty `receipt_ids` cell are missing receipts.

Value matches use `eval/normalize.py`. A decoy that was applied still counts as a false positive when the normalized value happens to match.

## Normalization

`eval/normalize.py` is the rule the agents service can mirror.

- `address`: case, collapsed whitespace, and `Suite`, `Ste`, `Ste.`, and `#` all become `suite`
- `phone`: digits only
- `accepting`: `true`/`yes` and `false`/`no`
- `status` and `specialty`: case and collapsed whitespace

Empty stays empty.

## Fixtures

```bash
py -3 eval/fixtures/make_fixture_diffs.py
```

That rewrites the committed diffs in `eval/fixtures/`:

- `perfect_A.csv`: every planted error in batch A is applied with the true value, except `ghost` and `accepting`, which are escalated. Decoys are left out.
- `naive_A.csv`: every batch A label, including decoys, is applied with the roster value and nothing is escalated. Roster has no accepting flag, so accepting is applied as `true`.
- `cold_A.csv`: same as perfect, except the 9 Sunrise address conflicts are escalated.
- `warm_B.csv`: batch B planted errors, with the 4 Sunrise address conflicts applied and `memory_ids` set to `mem-sunrise-move`.
