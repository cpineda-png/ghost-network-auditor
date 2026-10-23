# Generator

Windows:

```bash
py -3 data/generator/generate.py --seed 42
py -3 -m unittest discover data/generator
```

Elsewhere:

```bash
python3 data/generator/generate.py --seed 42
python3 -m unittest discover data/generator
```

`generate.py` uses the standard library and a fixed seed. It overwrites these files in `data/sample/`:

- `seed.sql`, directory `INSERT`s
- `roster.csv`
- `claims.csv`
- `nppes_snapshot.json`
- `labels.csv`, the answer key for `eval/`
- `generation_report.md`

Names, streets, and `718-555-01xx` phones are synthetic. There is no patient data.

`check_npis_absent.py` spot-checks 20 roster NPIs against the public NPI Registry. Run it by hand. The unit tests do not call the network.
