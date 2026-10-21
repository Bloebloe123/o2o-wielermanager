# o2o-wielermanager

Data voor het fantasy-wielerspel van o2o-collega's. Een Python-script haalt
renners en (vanaf fase 2) koersuitslagen op van [CQ Ranking](https://cqranking.com)
en schrijft ze als JSON-bestanden in de map `data/`.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `config.json` | Spelseizoen en welke ploegklassen meedoen |
| `scripts/cq.py` | Haalt pagina's op bij CQ (maximaal 1 verzoek per 2 seconden) |
| `scripts/import_renners.py` | Maakt `data/renners.json` |
| `data/renners.json` | Alle renners van de WorldTeams en ProTeams |

## renners.json

```json
{
  "bijgewerkt": "2026-10-21T14:53:27+00:00",
  "seizoen": 2027,
  "ploegen_van_seizoen": 2026,
  "punten_van_seizoen": 2026,
  "punten_stand_op": "2026-10-11",
  "aantal": 956,
  "renners": [
    {"cq_riderid": 26526, "naam": "POGACAR Tadej", "land": "SLO",
     "ploeg": "UAE Team Emirates - XRG", "ploegtype": "WorldTeam",
     "cq_punten_vorig_seizoen": 4196}
  ]
}
```

- `ploegen_van_seizoen` is lager dan `seizoen` zolang CQ de nieuwe ploegen nog
  niet online heeft. Het script schakelt vanzelf over zodra ze er zijn.
- `punten_stand_op` is de datum van de officiële CQ-download. Na 31 december is
  dat de eindstand van het vorige seizoen.

## Lokaal draaien

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/import_renners.py
```
