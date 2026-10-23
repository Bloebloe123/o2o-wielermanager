// Statistieken over renners en ploegen. Alles wordt berekend uit de selecties van alle
// deelnemers en de punten van de renners (zie spel.js); er wordt niets bewaard.
import { berekenStand, ploegInPeriode, ploegModus, transfersVan, TYPES, vandaagISO } from "./spel.js";

const $ = (id) => document.getElementById(id);
const AANTAL = 10; // regels per lijst

export async function tekenStatistieken(ctx) {
  const { staat, maak, pt, typeVan, laadDeelnemers } = ctx;
  $("stats-inhoud").replaceChildren(maak("p", { klasse: "klein", tekst: "Statistieken worden berekend…" }));
  await laadDeelnemers();

  const m = ploegModus(staat.inst);
  const periodeNu = m.huidige ?? m.doel ?? 1;
  const naam = (id) => staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`;
  const ploegnaam = (email) => staat.ploegnaamVan.get(email) || staat.naamVan.get(email) || email;
  const prijs = (id) => staat.prijzen.get(id) ?? 0;

  // Punten van elke renner dit seizoen (los van wie hem koos).
  const punten = new Map();
  for (const [id, lijst] of staat.resultaten) punten.set(id, lijst.reduce((som, r) => som + r.punten, 0));
  const ptVan = (id) => punten.get(id) || 0;

  // Hoeveel ploegen hebben elke renner nu in hun ploeg?
  const perDeelnemer = new Map();
  for (const s of staat.alleSelecties) {
    const email = s.createdBy?.email;
    if (!email) continue;
    if (!perDeelnemer.has(email)) perDeelnemer.set(email, []);
    perDeelnemer.get(email).push(s);
  }
  const aantalPloegen = perDeelnemer.size;
  const gekozen = new Map();
  const huidigePloeg = new Map();
  for (const [email, sel] of perDeelnemer) {
    const ploeg = ploegInPeriode(sel, periodeNu).map((s) => s.cq_riderid);
    huidigePloeg.set(email, ploeg);
    for (const id of ploeg) gekozen.set(id, (gekozen.get(id) || 0) + 1);
  }
  const keer = (id) => gekozen.get(id) || 0;
  const aandeel = (id) => (aantalPloegen ? `${Math.round((keer(id) / aantalPloegen) * 100)}%` : "–");

  // ---- Hulpjes om een kaart met een tabel te maken ----
  const tabel = (koppen, rijen, leeg) => (rijen.length
    ? maak("div", { klasse: "tabel-wrap" }, [maak("table", { klasse: "tabel stats-tabel" }, [
      maak("thead", {}, [maak("tr", {}, koppen.map((k, i) => maak("th", { klasse: i > 1 ? "getal" : "", tekst: k })))]),
      maak("tbody", {}, rijen.map((r) => maak("tr", {}, r.map((c, i) => maak("td", { klasse: i > 1 ? "getal" : "", tekst: c }))))),
    ])])
    : maak("p", { klasse: "klein", tekst: leeg }));
  const kaart = (titel, uitleg, inhoud) => maak("div", { klasse: "kaart stat" }, [
    maak("h3", { tekst: titel }), maak("p", { klasse: "klein", tekst: uitleg }), inhoud,
  ]);
  const nogGeenPunten = "Nog geen punten dit seizoen.";
  const renners = staat.renners.map((r) => r.cq_riderid);

  const kaarten = [];

  // 1. Waardevolste renners: punten per credit.
  kaarten.push(kaart("Waardevolste renners", "Meeste punten per credit die hij kost.", tabel(
    ["#", "Renner", "Punten", "Prijs", "Pt/credit"],
    renners.filter((id) => ptVan(id) > 0).sort((a, b) => ptVan(b) / prijs(b) - ptVan(a) / prijs(a)).slice(0, AANTAL)
      .map((id, i) => [`${i + 1}`, naam(id), pt(ptVan(id)), `${prijs(id)}`, pt(ptVan(id) / prijs(id))]),
    nogGeenPunten,
  )));

  // 2. Meest gekozen renners.
  kaarten.push(kaart("Meest gekozen renners", `In hoeveel van de ${aantalPloegen} ploegen een renner nu zit.`, tabel(
    ["#", "Renner", "Ploegen", "Aandeel", "Punten"],
    renners.filter((id) => keer(id) > 0).sort((a, b) => keer(b) - keer(a) || ptVan(b) - ptVan(a)).slice(0, AANTAL)
      .map((id, i) => [`${i + 1}`, naam(id), `${keer(id)}`, aandeel(id), pt(ptVan(id))]),
    "Nog geen ploegen.",
  )));

  // 3. Verborgen parels: weinig gekozen, veel punten.
  const grens = Math.max(1, Math.floor(aantalPloegen * 0.1)); // in hoogstens 10% van de ploegen
  kaarten.push(kaart("Verborgen parels", `Renners in hoogstens ${grens} ${grens === 1 ? "ploeg" : "ploegen"}, met de meeste punten.`, tabel(
    ["#", "Renner", "Punten", "Ploegen", "Prijs"],
    renners.filter((id) => ptVan(id) > 0 && keer(id) <= grens).sort((a, b) => ptVan(b) - ptVan(a)).slice(0, AANTAL)
      .map((id, i) => [`${i + 1}`, naam(id), pt(ptVan(id)), `${keer(id)}`, `${prijs(id)}`]),
    nogGeenPunten,
  )));

  // 4. Topscorers van het seizoen.
  kaarten.push(kaart("Topscorers", "De renners met de meeste punten dit seizoen.", tabel(
    ["#", "Renner", "Punten", "Prijs", "Aandeel"],
    renners.filter((id) => ptVan(id) > 0).sort((a, b) => ptVan(b) - ptVan(a)).slice(0, AANTAL)
      .map((id, i) => [`${i + 1}`, naam(id), pt(ptVan(id)), `${prijs(id)}`, aandeel(id)]),
    nogGeenPunten,
  )));

  // 5. Grootste tegenvallers: dure renners met weinig punten per credit.
  const duur = Math.min(...staat.inst.prijzen_top);
  kaarten.push(kaart("Grootste tegenvallers", `Toppers (${duur} credits of meer) met de minste punten per credit.`, tabel(
    ["#", "Renner", "Punten", "Prijs", "Pt/credit"],
    renners.filter((id) => prijs(id) >= duur).sort((a, b) => ptVan(a) / prijs(a) - ptVan(b) / prijs(b)).slice(0, 5)
      .map((id, i) => [`${i + 1}`, naam(id), pt(ptVan(id)), `${prijs(id)}`, pt(ptVan(id) / prijs(id))]),
    nogGeenPunten,
  )));

  // 6. Punten per type renner.
  const perType = new Map(TYPES.map((t) => [t, { renners: 0, punten: 0 }]));
  for (const id of renners) {
    const t = perType.get(typeVan(id));
    t.renners += 1;
    t.punten += ptVan(id);
  }
  kaarten.push(kaart("Punten per type renner", "Wat brengt elk type gemiddeld op?", tabel(
    ["Type", "Renners", "Punten", "Gemiddeld"],
    TYPES.map((t) => [t, `${perType.get(t).renners}`, pt(perType.get(t).punten), pt(perType.get(t).punten / (perType.get(t).renners || 1))]),
    "",
  )));

  // 7. Populairste transfers (enkel van periodes die al begonnen zijn).
  const vandaag = vandaagISO();
  const gestart = new Set(staat.inst.periodes.filter((p) => p.start <= vandaag).map((p) => p.nr));
  const gekocht = new Map(), verkocht = new Map();
  for (const sel of perDeelnemer.values()) {
    for (const t of transfersVan(sel).filter((x) => gestart.has(x.periode))) {
      for (const id of t.in) gekocht.set(id, (gekocht.get(id) || 0) + 1);
      for (const id of t.uit) verkocht.set(id, (verkocht.get(id) || 0) + 1);
    }
  }
  const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 5);
  kaarten.push(kaart("Populairste transfers", "Meest gekochte en meest verkochte renners.", maak("div", { klasse: "stats-twee" }, [
    tabel(["#", "Gekocht", "Keer"], top(gekocht).map(([id, n], i) => [`${i + 1}`, naam(id), `${n}`]), "Nog geen transfers."),
    tabel(["#", "Verkocht", "Keer"], top(verkocht).map(([id, n], i) => [`${i + 1}`, naam(id), `${n}`]), ""),
  ])));

  // 8. Winnaars per periode.
  const periodes = staat.inst.periodes.filter((p) => p.start <= vandaag);
  kaarten.push(kaart("Winnaars per periode", "De beste ploeg van elke periode (tot nu toe).", tabel(
    ["Periode", "Ploeg", "Punten"],
    periodes.map((p) => {
      const winnaar = berekenStand(staat.alleSelecties, staat.resultaten, p.nr)[0];
      return [`${p.nr}`, winnaar && winnaar.punten > 0 ? ploegnaam(winnaar.email) : "–", winnaar ? pt(winnaar.punten) : "–"];
    }),
    "Het seizoen is nog niet begonnen.",
  )));

  // 9. Origineelste ploegen: renners die weinig anderen kozen.
  const origineel = [...huidigePloeg].filter(([, ploeg]) => ploeg.length).map(([email, ploeg]) => {
    const anderen = aantalPloegen - 1;
    const gemiddeld = anderen ? ploeg.reduce((som, id) => som + (keer(id) - 1) / anderen, 0) / ploeg.length : 0;
    return { email, gemiddeld };
  }).sort((a, b) => a.gemiddeld - b.gemiddeld);
  kaarten.push(kaart("Origineelste ploegen", "Hoeveel procent van de andere ploegen heeft gemiddeld dezelfde renners? Hoe lager, hoe origineler.", tabel(
    ["#", "Ploeg", "Gemiddeld gedeeld"],
    aantalPloegen > 1 ? origineel.slice(0, 5).map((o, i) => [`${i + 1}`, ploegnaam(o.email), `${Math.round(o.gemiddeld * 100)}%`]) : [],
    "Daarvoor zijn minstens twee ploegen nodig.",
  )));

  $("stats-inhoud").replaceChildren(...kaarten);
}
