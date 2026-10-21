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
| `scripts/import_koersen.py` | Maakt `data/koersen.json` |
| `.github/workflows/import.yml` | Draait beide scripts elke dag om 18u30 Belgische tijd |
| `data/renners.json` | Alle renners van de WorldTeams en ProTeams |
| `data/koersen.json` | Uitslagen van de WorldTour- en ProSeries-koersen van het seizoen |
| `data/voorbeeld/koersen-2026.json` | Uitslagen van 2026, om de spelsite mee te testen |

De bestanden staan ook op GitHub Pages:
`https://bloebloe123.github.io/o2o-wielermanager/data/renners.json` en
`https://bloebloe123.github.io/o2o-wielermanager/data/koersen.json`.

## Import manueel starten

Op GitHub: **Actions > Import CQ-data > Run workflow**.

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

## koersen.json

```json
{
  "laatste_import": "2026-10-21T16:31:02+00:00",
  "seizoen": 2027,
  "jongerenklassement_beschikbaar": false,
  "afgeronde_tours": [4837],
  "aantal": 1,
  "koersen": [
    {"cq_raceid": 46293, "naam": "Tour de France, General classification",
     "koers": "Tour de France", "datum": "2026-07-26", "klasse": "WT",
     "cq_categorie": "GT1", "is_grote_ronde": true, "rit_nr": null,
     "type": "eindklassement",
     "uitslag": [{"cq_riderid": 26526, "positie": 1}]}
  ]
}
```

- `type` is `eendags`, `rit`, `eindklassement`, `punten`, `berg` of `jongeren`.
- `klasse` is `WT` of `PS`; grote rondes hebben `is_grote_ronde: true`.
- `laatste_import` verandert alleen als er nieuwe uitslagen zijn (anders komt er
  geen commit).
- Bij een ploegentijdrit krijgt elke renner de positie van zijn ploeg.
- CQ publiceert **geen jongerenklassement**. Punten- en bergklassementen zijn er
  alleen bij WorldTour-rittenkoersen.
- Het script doorloopt elke dag de hele CQ-kalender van het seizoen tot vandaag.
  Zo komt een uitslag die CQ later online zet of die een mislukte run miste,
  alsnog binnen. Na 60 dagen zonder uitslag stopt het met zoeken.

## Lokaal draaien

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/import_renners.py
.venv/bin/python scripts/import_koersen.py
```
