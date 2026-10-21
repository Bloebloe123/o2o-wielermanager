"""Maakt koersen.json: de uitslagen van de WorldTour- en ProSeries-koersen (mannen).

Werkwijze bij elke run:
1. Verzamel kandidaat-koersen uit twee bronnen:
   - de RSS-feed met recente koersen (snel, maar toont enkel de laatste dagen);
   - de CQ-kalender van elke maand van het seizoen tot nu. Zo halen we ook
     uitslagen op die CQ later online zette, of die een mislukte run miste.
     Van rittenkoersen lezen we de lijst met ritten en klassementen.
2. Sla koersen over die al in koersen.json staan of nog niet gereden zijn.
3. Haal de uitslag van elke nieuwe koers op. Nog geen uitslag? Dan proberen
   we het de volgende dag opnieuw (tot `opgeven_na_dagen` na de koers).
"""
import argparse
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

from cq import haal, soep

MAP = Path(__file__).resolve().parent.parent

# Naam van een klassement op CQ -> type in koersen.json
KLASSEMENTEN = {
    "General classification": "eindklassement",
    "Points classification": "punten",
    "Mountains classification": "berg",
    "Youth classification": "jongeren",
    "Young riders classification": "jongeren",
}


def lees_datum(tekst, jaar=None):
    """'4/07/2026' -> date(2026, 7, 4). Zonder jaar in de tekst gebruiken we `jaar`."""
    m = re.search(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", tekst)
    if not m or not (m.group(3) or jaar):
        return None
    return date(int(m.group(3) or jaar), int(m.group(2)), int(m.group(1)))


class Klassen:
    """Beslist of een CQ-categorie (bv. '2.WT1s', 'GT1', '1.PS') meetelt."""

    def __init__(self, patronen):
        self.patronen = {k: re.compile(p) for k, p in patronen.items()}

    def klasse(self, categorie):
        """Geeft 'GT', 'WT', 'PS' of None.

        Een slot-'s' (rit) of slot-'r' (punten-/bergklassement) telt niet mee.
        """
        basis = re.sub(r"[sr]$", "", categorie or "")
        for naam, patroon in self.patronen.items():
            if patroon.match(basis):
                return naam
        return None


def kandidaten_uit_rss(klassen, seizoen):
    """Race-id's uit de RSS-feed die tot onze klassen en ons seizoen horen."""
    ids = set()
    try:
        xml = ElementTree.fromstring(haal("xml/RSS_RecentRacesBasic.xml", binair=True))
    except Exception as fout:  # de kalender vangt dit op; RSS is enkel een extra bron
        print(f"RSS-feed niet leesbaar ({fout}); we gaan verder met de kalender.")
        return ids
    for item in xml.iter("item"):
        beschrijving = item.findtext("description") or ""
        categorie = re.search(r"Category:\s*([^<\s&]+)", beschrijving)
        datum = re.search(r"Date:\s*\d+ \w+ (\d{4})", beschrijving)
        raceid = re.search(r"raceid=(\d+)", item.findtext("link") or "")
        if categorie and datum and raceid and int(datum.group(1)) == seizoen \
                and klassen.klasse(categorie.group(1)):
            ids.add(int(raceid.group(1)))
    return ids


def lees_kalender(klassen, seizoen):
    """Alle WorldTour- en ProSeries-koersen van het seizoen op de CQ-kalender, ook de
    nog te rijden koersen. Geeft None als CQ nog geen kalender heeft voor dat jaar."""
    pagina = soep("asp/gen/RaceCal.asp")
    jaren = {o["value"] for o in pagina.select("select[name=listYears] option")}
    if str(seizoen) not in jaren:
        print(f"CQ heeft nog geen kalender voor {seizoen}.")
        return None

    kalender = []
    for maand in range(1, 13):
        maandpagina = soep("asp/gen/RaceCal.asp", {"listYears": seizoen, "listMonths": maand})
        for rij in maandpagina.find_all("tr"):
            race = rij.find("a", href=re.compile(r"race\.asp\?raceid=\d+"))
            if not race:
                continue
            cellen = [td.get_text(" ", strip=True) for td in rij.find_all("td")]
            categorie = next((c for c in cellen if klassen.klasse(c)), None)
            datums = [d for d in (lees_datum(c) for c in cellen if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", c)) if d]
            if not categorie or not datums:
                continue
            tour = rij.find("a", href=re.compile(r"tour\.asp\?tourid=\d+"))
            klasse = klassen.klasse(categorie)
            kalender.append({
                "naam": " ".join(race.get_text().split()),
                "start": datums[0].isoformat(),
                "eind": datums[-1].isoformat(),
                "klasse": "WT" if klasse == "GT" else klasse,
                "cq_categorie": categorie,
                "is_grote_ronde": klasse == "GT",
                "soort": "rittenkoers" if tour else "eendags",
                "cq_raceid": int(re.search(r"raceid=(\d+)", race["href"]).group(1)),
                "cq_tourid": int(re.search(r"tourid=(\d+)", tour["href"]).group(1)) if tour else None,
            })
    # Dezelfde koers kan in twee maanden staan (een rittenkoers over de maandgrens).
    uniek = {k["cq_raceid"]: k for k in kalender}
    return sorted(uniek.values(), key=lambda k: (k["start"], k["naam"]))


def kandidaten_uit_kalender(kalender, seizoen, vandaag, afgeronde_tours):
    """Geeft ({raceid: datum}, {tourid: einddatum}) voor alle koersen tot vandaag."""
    races, tours = {}, {}
    for koers in kalender:
        if date.fromisoformat(koers["start"]) > vandaag:
            continue
        if koers["cq_tourid"]:
            if koers["cq_tourid"] not in afgeronde_tours:
                tours[koers["cq_tourid"]] = date.fromisoformat(koers["eind"])
        else:
            races[koers["cq_raceid"]] = date.fromisoformat(koers["start"])

    # Van elke lopende of nog niet afgewerkte rittenkoers: alle ritten en klassementen.
    for tourid in tours:
        tourpagina = soep(f"asp/gen/tour.asp?tourid={tourid}")
        for rij in tourpagina.find_all("tr"):
            race = rij.find("a", href=re.compile(r"race\.asp\?raceid=\d+"))
            datumcel = rij.find("td", string=re.compile(r"^\s*\d{1,2}/\d{1,2}\s*$"))
            datum = lees_datum(datumcel.get_text(), seizoen) if datumcel else None
            if race and datum and datum <= vandaag:
                races[int(re.search(r"raceid=(\d+)", race["href"]).group(1))] = datum
    return races, tours


def schrijf_kalender(pad, seizoen, kalender):
    """Schrijft kalender.json, enkel als de inhoud veranderd is."""
    inhoud = {"seizoen": seizoen, "aantal": len(kalender), "koersen": kalender}
    if pad.exists() and json.loads(pad.read_text()) == inhoud:
        print("kalender.json: geen wijzigingen")
        return
    pad.parent.mkdir(parents=True, exist_ok=True)
    pad.write_text(json.dumps(inhoud, ensure_ascii=False, indent=1) + "\n")
    print(f"kalender.json geschreven: {len(kalender)} koersen")


def soort_en_rit(categorie, titel):
    """Bepaalt (type, rit_nr) uit de categorie en de titel van de koerspagina."""
    if categorie.startswith("1."):
        return "eendags", None
    deel = titel.rsplit(", ", 1)[-1]
    rit = re.match(r"(Stage|Prologue)\s*(\w*)", deel)
    if rit:
        nr = 0 if rit.group(1) == "Prologue" else rit.group(2)
        return "rit", int(nr) if str(nr).isdigit() else nr
    for naam, soort in KLASSEMENTEN.items():
        if deel.startswith(naam):
            return soort, None
    return None, None  # bv. ploegenklassement: telt niet mee


def lees_uitslag(pagina, ploegcodes, max_positie):
    """Leest [{cq_riderid, positie}] van een koerspagina.

    Bij een ploegentijdrit geeft CQ de positie per ploeg met één renner erbij,
    en daaronder alle renners met hun ploegcode. Elke renner krijgt dan de
    positie van zijn ploeg.
    """
    uitslag, ploegposities, ploegentijdrit = [], {}, False
    vorige_positie = None
    for rij in pagina.find_all("tr"):
        cellen = [td.get_text(" ", strip=True) for td in rij.find_all("td", recursive=False)]
        cellen = [c for c in cellen if c]
        if not cellen or "no result" in cellen:
            continue
        link = rij.find("a", href=re.compile(r"rider\.asp\?riderid=\d+"))
        riderid = int(re.search(r"riderid=(\d+)", link["href"]).group(1)) if link else None
        positie = re.fullmatch(r"(\d+)\.", cellen[0])

        if positie and not link:
            # Rij met een ploeg (ploegentijdrit); de renner op de volgende rij hoort erbij.
            ploegentijdrit, vorige_positie = True, int(positie.group(1))
        elif positie and link:
            uitslag.append({"cq_riderid": riderid, "positie": int(positie.group(1))})
        elif ploegentijdrit and link and len(cellen) == 1 and vorige_positie:
            code = ploegcodes.get(riderid)
            if code:
                ploegposities[code] = vorige_positie
            uitslag.append({"cq_riderid": riderid, "positie": vorige_positie})
            vorige_positie = None
        elif ploegentijdrit and link and cellen[0] == "-" and len(cellen) > 2:
            positie_ploeg = ploegposities.get(cellen[2])
            if positie_ploeg:
                uitslag.append({"cq_riderid": riderid, "positie": positie_ploeg})

    gezien, resultaat = set(), []
    for regel in sorted(uitslag, key=lambda r: r["positie"]):
        if regel["positie"] <= max_positie and regel["cq_riderid"] not in gezien:
            gezien.add(regel["cq_riderid"])
            resultaat.append(regel)
    return resultaat


def haal_koers(raceid, klassen, ploegcodes, max_positie):
    """Haalt één koers op. Geeft None als ze niet meetelt of nog geen uitslag heeft."""
    pagina = soep(f"asp/gen/race.asp?raceid={raceid}")
    tekst = pagina.get_text(" ", strip=True)
    categorie = re.search(r"Category:\s*(\S+)", tekst)
    datum = lees_datum(tekst)
    titel = (pagina.title.get_text(strip=True) if pagina.title else "").replace("CQ Ranking - ", "", 1)
    klasse = klassen.klasse(categorie.group(1)) if categorie else None
    if not klasse or not datum:
        return None
    soort, rit_nr = soort_en_rit(categorie.group(1), titel)
    if not soort:
        return None
    uitslag = lees_uitslag(pagina, ploegcodes, max_positie)
    # Een geschrapte koers of rit toont CQ als "no result": bewaren met lege uitslag.
    geannuleerd = not uitslag and "no result" in tekst
    if not uitslag and not geannuleerd:
        return None
    return {
        "cq_raceid": raceid,
        "naam": titel,
        "koers": titel.rsplit(", ", 1)[0] if soort != "eendags" else titel,
        "datum": datum.isoformat(),
        "klasse": "WT" if klasse == "GT" else klasse,
        "cq_categorie": categorie.group(1),
        "is_grote_ronde": klasse == "GT",
        "rit_nr": rit_nr,
        "type": soort,
        "geannuleerd": geannuleerd,
        "uitslag": uitslag,
    }


def main():
    config = json.loads((MAP / "config.json").read_text())
    parser = argparse.ArgumentParser()
    parser.add_argument("--seizoen", type=int, default=config["seizoen"])
    parser.add_argument("--uitvoer", default=str(MAP / "data" / "koersen.json"))
    parser.add_argument("--kalender", default=str(MAP / "data" / "kalender.json"))
    parser.add_argument("--alles", action="store_true", help="ook koersen ouder dan opgeven_na_dagen")
    args = parser.parse_args()
    opgeven_na = 10**6 if args.alles else config["opgeven_na_dagen"]
    uitvoer = Path(args.uitvoer)
    seizoen, vandaag = args.seizoen, date.today()
    klassen = Klassen(config["koersklassen"])

    oud = json.loads(uitvoer.read_text()) if uitvoer.exists() else {}
    if oud.get("seizoen") != seizoen:
        # Nieuw seizoen: bewaar de uitslagen van het vorige in data/archief (de spelsite
        # deelt de renners daarmee in volgens type) en begin met een lege lijst.
        if oud.get("koersen"):
            archief = MAP / "data" / "archief" / f"koersen-{oud['seizoen']}.json"
            archief.parent.mkdir(parents=True, exist_ok=True)
            archief.write_text(json.dumps(oud, ensure_ascii=False, indent=1) + "\n")
            print(f"Uitslagen van {oud['seizoen']} gearchiveerd in {archief.name}")
        oud = {}
    koersen = {k["cq_raceid"]: k for k in oud.get("koersen", [])}
    afgeronde_tours = set(oud.get("afgeronde_tours", []))

    renners = json.loads((MAP / "data" / "renners.json").read_text())["renners"]
    ploegcodes = {r["cq_riderid"]: r["ploegcode"] for r in renners}

    kalender = lees_kalender(klassen, seizoen)
    schrijf_kalender(Path(args.kalender), seizoen, kalender or [])
    kandidaten, tours = kandidaten_uit_kalender(kalender or [], seizoen, vandaag, afgeronde_tours)
    for raceid in kandidaten_uit_rss(klassen, seizoen):
        kandidaten.setdefault(raceid, vandaag)

    nieuw = 0
    for raceid, datum in sorted(kandidaten.items(), key=lambda x: x[1]):
        if raceid in koersen or (vandaag - datum).days > opgeven_na:
            continue
        koers = haal_koers(raceid, klassen, ploegcodes, config["uitslag_max_positie"])
        if koers:
            koersen[raceid] = koers
            nieuw += 1
            print(f"  + {koers['datum']} {koers['naam']} ({koers['type']}, {len(koers['uitslag'])} renners)")

    # Een rittenkoers is afgewerkt als ze voorbij is en het eindklassement binnen is.
    # Dan hoeven we haar pagina niet meer elke dag op te vragen.
    for tourid, einde in tours.items():
        if einde < vandaag and any(
            k["type"] == "eindklassement" and k["datum"] == einde.isoformat() for k in koersen.values()
        ):
            afgeronde_tours.add(tourid)

    inhoud = {
        "seizoen": seizoen,
        # CQ publiceerde in 2026 geen jongerenklassement; verschijnt er ooit een, dan zie je het hier.
        "jongerenklassement_beschikbaar": any(k["type"] == "jongeren" for k in koersen.values()),
        "afgeronde_tours": sorted(afgeronde_tours),
        "aantal": len(koersen),
        "koersen": sorted(koersen.values(), key=lambda k: (k["datum"], k["cq_raceid"])),
    }
    vergelijk = {k: v for k, v in oud.items() if k != "laatste_import"}
    if vergelijk == inhoud:
        print("koersen.json: geen nieuwe uitslagen")
        return
    inhoud = {"laatste_import": datetime.now(timezone.utc).isoformat(timespec="seconds"), **inhoud}
    uitvoer.parent.mkdir(parents=True, exist_ok=True)
    uitvoer.write_text(json.dumps(inhoud, ensure_ascii=False, indent=1) + "\n")
    print(f"koersen.json geschreven: {nieuw} nieuwe koersen, {len(koersen)} in totaal")


if __name__ == "__main__":
    sys.exit(main())
