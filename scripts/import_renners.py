"""Maakt renners.json: alle renners van de WorldTeams en ProTeams (mannen).

Werkwijze:
1. Lees het spelseizoen uit config.json (bv. 2027).
2. Ploegen: neem de ploegen van dat seizoen. Heeft CQ die nog niet online
   (bv. in de winter), dan nemen we tijdelijk de ploegen van het seizoen ervoor.
3. Renners per ploeg: van de ploegpagina op CQ (id, naam, land).
4. Prijsbasis: CQ-punten van het vorige seizoen, uit de officiële
   rankingdownload (xls in een zip). Renners zonder punten krijgen 0.
"""
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import xlrd

from cq import haal, soep

MAP = Path(__file__).resolve().parent.parent
UITVOER = MAP / "data" / "renners.json"


def beschikbare_jaren():
    """Jaren waarvoor CQ ploegen kent (keuzelijst op de zoekpagina voor ploegen)."""
    pagina = soep("asp/gen/searchTeams.asp")
    return {int(o["value"]) for o in pagina.select("#listYears option") if o["value"].isdigit() and o["value"] != "0"}


def ploegen(jaar, klassen):
    """Geeft [(ploegcode, ploegnaam, ploegtype)] voor de gevraagde ploegklassen."""
    pagina = soep("asp/gen/searchTeams.asp")
    # De keuzelijst koppelt een klasse (WTT, PROT) aan een intern nummer; dat lezen we uit.
    klasse_nr = {o.get_text(strip=True): o["value"] for o in pagina.select("#listClasses option")}
    resultaat = []
    for klasse, ploegtype in klassen.items():
        if klasse not in klasse_nr:
            sys.exit(f"Klasse {klasse} niet gevonden op CQ (wel: {sorted(klasse_nr)})")
        lijst = soep("asp/gen/searchTeams.asp", {
            "listYears": jaar, "listClasses": klasse_nr[klasse], "listNats": "0",
            "codecontains": "", "namecontains": "", "butSearch": " Search ",
        })
        for link in lijst.find_all("a", href=re.compile(r"team\.asp\?year=\d+&teamcode=")):
            code = re.search(r"teamcode=(\w+)", link["href"]).group(1)
            resultaat.append((code, " ".join(link.get_text().split()), ploegtype))
    return resultaat


def renners_van_ploeg(jaar, code):
    """Geeft [(riderid, naam, land, vertrokken)] van de ploegpagina.

    `vertrokken` is True als CQ bij de renner "Contract until ..." zet: hij
    verliet de ploeg tijdens het seizoen.
    """
    pagina = soep(f"asp/gen/team.asp?year={jaar}&teamcode={code}")
    renners = []
    for link in pagina.find_all("a", href=re.compile(r"rider\.asp\?riderid=\d+")):
        rij = link.find_parent("tr")
        vlag = rij.find("img", src=re.compile(r"/flags/")) if rij else None
        renners.append((
            int(re.search(r"riderid=(\d+)", link["href"]).group(1)),
            link.get_text(" ", strip=True),
            vlag["title"] if vlag else "",
            bool(rij and "Contract until" in rij.get_text()),
        ))
    return renners


def punten_vorig_seizoen(jaar):
    """Leest de CQ-jaarranking van `jaar` uit de recentste officiële download.

    Geeft (punten per riderid, datum van de download) terug.
    """
    pagina = soep("asp/gen/downloads.asp")
    bestanden = sorted(
        o["value"] for o in pagina.select("#listCQRankings option")
        if o["value"].startswith(f"{jaar}/")
    )
    if not bestanden:
        sys.exit(f"Geen rankingdownload gevonden voor {jaar}")
    recentste = bestanden[-1]  # namen zijn cqJJJJMMDD.zip, dus alfabetisch = chronologisch
    zip_bytes = haal(f"xls/{recentste}", binair=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        xls = z.read(next(n for n in z.namelist() if n.lower().endswith(".xls")))
    blad = xlrd.open_workbook(file_contents=xls).sheet_by_name("Year Ranking")

    # Controleer dat dit echt de jaarranking van het juiste jaar is.
    titel = " ".join(str(c) for r in range(6) for c in blad.row_values(r))
    if f"CQ {jaar} Ranking" not in titel:
        sys.exit(f"Onverwachte ranking in {recentste}: {titel.strip()}")

    # Zoek de kolomkoppen (rij met 'RiderID' en 'CQ').
    for r in range(blad.nrows):
        rij = [str(c).strip() for c in blad.row_values(r)]
        if "RiderID" in rij and "CQ" in rij:
            kol_id, kol_cq, start = rij.index("RiderID"), rij.index("CQ"), r + 1
            break
    else:
        sys.exit("Kolommen RiderID/CQ niet gevonden in de download")

    punten = {}
    for r in range(start, blad.nrows):
        rij = blad.row_values(r)
        if isinstance(rij[kol_id], float):
            punten[int(rij[kol_id])] = int(rij[kol_cq])
    datum = re.search(r"cq(\d{8})", recentste).group(1)
    return punten, f"{datum[:4]}-{datum[4:6]}-{datum[6:]}"


def main():
    config = json.loads((MAP / "config.json").read_text())
    seizoen = config["seizoen"]
    vorig = seizoen - 1

    ploegjaar = seizoen if seizoen in beschikbare_jaren() else vorig
    if ploegjaar != seizoen:
        print(f"Let op: CQ heeft nog geen ploegen voor {seizoen}, we gebruiken die van {ploegjaar}.")

    punten, punten_datum = punten_vorig_seizoen(vorig)
    print(f"CQ-punten {vorig}: {len(punten)} renners (stand {punten_datum})")

    renners = {}
    for code, ploegnaam, ploegtype in ploegen(ploegjaar, config["ploegklassen"]):
        lijst = renners_van_ploeg(ploegjaar, code)
        print(f"  {ploegtype:9} {ploegnaam}: {len(lijst)} renners")
        for riderid, naam, land, vertrokken in lijst:
            # Wisselde een renner van ploeg tijdens het seizoen, dan telt de nieuwe ploeg.
            if riderid in renners and (vertrokken or not renners[riderid]["_vertrokken"]):
                continue
            renners[riderid] = {
                "_vertrokken": vertrokken,
                "cq_riderid": riderid,
                "naam": naam,
                "land": land,
                "ploeg": ploegnaam,
                "ploegtype": ploegtype,
                "cq_punten_vorig_seizoen": punten.get(riderid, 0),
            }

    if len(renners) < 500:
        sys.exit(f"Maar {len(renners)} renners gevonden; renners.json niet overschreven.")

    for renner in renners.values():
        renner.pop("_vertrokken")
    lijst = sorted(renners.values(), key=lambda r: (-r["cq_punten_vorig_seizoen"], r["naam"]))
    inhoud = {
        "seizoen": seizoen,
        "ploegen_van_seizoen": ploegjaar,
        "punten_van_seizoen": vorig,
        "punten_stand_op": punten_datum,
        "aantal": len(lijst),
        "renners": lijst,
    }
    # Enkel schrijven als de inhoud veranderd is, zodat er geen lege commits komen.
    oud = json.loads(UITVOER.read_text()) if UITVOER.exists() else {}
    oud.pop("bijgewerkt", None)
    if oud == inhoud:
        print("renners.json: geen wijzigingen")
        return
    inhoud = {"bijgewerkt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **inhoud}
    UITVOER.parent.mkdir(exist_ok=True)
    UITVOER.write_text(json.dumps(inhoud, ensure_ascii=False, indent=1) + "\n")
    print(f"renners.json geschreven: {len(lijst)} renners")


if __name__ == "__main__":
    main()
