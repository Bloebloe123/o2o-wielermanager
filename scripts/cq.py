"""Gedeelde hulpfuncties om pagina's van cqranking.com op te halen.

Elk verzoek wacht tot er minstens 2 seconden voorbij zijn sinds het vorige,
zodat we CQ nooit overbelasten.
"""
import time

import requests
from bs4 import BeautifulSoup

BASIS = "https://cqranking.com/men/"
WACHTTIJD = 2.0  # seconden tussen twee verzoeken

_sessie = requests.Session()
_sessie.headers["User-Agent"] = "o2o-wielermanager (fantasy-wielerspel; 1 verzoek per 2 s)"
_laatste_verzoek = 0.0


def haal(pad, data=None, binair=False):
    """Haal een pagina op (GET, of POST als er data is) en geef tekst of bytes terug."""
    global _laatste_verzoek
    wacht = WACHTTIJD - (time.monotonic() - _laatste_verzoek)
    if wacht > 0:
        time.sleep(wacht)
    url = pad if pad.startswith("http") else BASIS + pad
    for poging in range(3):
        try:
            if data is None:
                antwoord = _sessie.get(url, timeout=60)
            else:
                antwoord = _sessie.post(url, data=data, timeout=60)
            antwoord.raise_for_status()
            break
        except requests.RequestException:
            if poging == 2:
                raise
            time.sleep(10)
        finally:
            _laatste_verzoek = time.monotonic()
    if binair:
        return antwoord.content
    antwoord.encoding = "cp1252"  # CQ gebruikt Windows-tekens (bv. ç, é)
    return antwoord.text


def soep(pad, data=None):
    """Haal een pagina op en geef ze terug als BeautifulSoup-object."""
    return BeautifulSoup(haal(pad, data), "html.parser")
