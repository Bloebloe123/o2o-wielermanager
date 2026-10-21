import {
  berekenPrijzen, berekenStand, magToevoegen, normaliseer, ploegInPeriode, ploegModus, rennerResultaten, transfersVan, vandaagISO,
} from "./spel.js";
import { toonAdmin } from "./admin.js";
import { tekenKalender } from "./kalender.js";
import { tekenRegels } from "./regels.js";

const $ = (id) => document.getElementById(id);
const profielen = window.vibers.db.collection("profielen");
const selecties = window.vibers.db.collection("selecties");
const correcties = window.vibers.db.collection("correcties");
// Ploegnamen die een admin wijzigde: { email, ploegnaam }. Die gaan voor op de naam in het profiel.
const ploegnamen = window.vibers.db.collection("ploegnamen");

const staat = {
  ik: null,
  inst: null,
  renners: [],
  rennerOpId: new Map(),
  prijzen: new Map(),
  koersen: null,
  resultaten: new Map(), // cq_riderid -> punten per koers (zie spel.js)
  correcties: [], // enkel correcties gemaakt door een admin
  profiel: null,
  mijnSelecties: [],
  sorteer: { veld: "prijs", af: true },
  bezig: false,
};

// ---------- Hulpjes ----------

function melding(tekst, fout = false) {
  const el = $("melding");
  el.textContent = tekst;
  el.classList.toggle("fout", fout);
  el.hidden = !tekst;
}

function maak(tag, eigenschappen = {}, kinderen = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschappen)) {
    if (k === "tekst") el.textContent = v;
    else if (k === "klasse") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  for (const kind of kinderen) el.append(kind);
  return el;
}

async function alleRecords(collectie, query) {
  let pagina = await collectie.find({ ...query, limit: 200 });
  const items = [...pagina.items];
  while (pagina.nextCursor) {
    pagina = await collectie.find({ ...query, limit: 200, cursor: pagina.nextCursor });
    items.push(...pagina.items);
  }
  return items;
}

// Punten tonen: halve punten (ProSeries) met een komma, anders een geheel getal.
function pt(n) {
  return n.toLocaleString("nl-BE", { maximumFractionDigits: 1 });
}

function datumTijd(iso) {
  return new Date(iso).toLocaleString("nl-BE", {
    timeZone: "Europe/Brussels", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

// ---------- Laden ----------

// De gedeelde instellingen. Bestaan ze nog niet, dan gebruiken we de standaardwaarden;
// een admin schrijft die meteen weg zodat iedereen dezelfde instellingen ziet.
// Komt er later een nieuwe instelling bij, dan vullen de standaardwaarden die aan.
async function laadInstellingen() {
  const rij = await window.storage.get("instellingen", true);
  const standaard = await (await fetch("./standaard-instellingen.json")).json();
  if (rij) {
    const opgeslagen = JSON.parse(rij.value);
    // Oude instellingen met enkel periodes: geen standaard-transferperiodes eroverheen leggen.
    if (opgeslagen.periodes && !opgeslagen.transferperiodes) delete standaard.transferperiodes;
    return normaliseer({ ...standaard, ...opgeslagen });
  }
  if (standaard.admins.includes(staat.ik.email)) {
    await window.storage.set("instellingen", JSON.stringify(standaard), true);
  }
  return normaliseer(standaard);
}

async function haalJson(url) {
  const antwoord = await fetch(url, { cache: "no-cache" });
  if (!antwoord.ok) throw new Error(`${url} gaf ${antwoord.status}`);
  return antwoord.json();
}

async function start() {
  try {
    staat.ik = await window.vibers.me();
    staat.inst = await laadInstellingen();
    const [renners, koersen, mijnProfielen, mijn, alleCorrecties, kalender, alleNaamwijzigingen] = await Promise.all([
      haalJson(staat.inst.renners_url),
      haalJson(staat.inst.koersen_url),
      profielen.find({ mine: true, limit: 1 }),
      alleRecords(selecties, { mine: true }),
      alleRecords(correcties, {}),
      // De kalender is mooi meegenomen; lukt hij niet, dan werkt de rest gewoon verder.
      haalJson(staat.inst.kalender_url).catch(() => null),
      alleRecords(ploegnamen, {}),
    ]);
    staat.renners = renners.renners;
    staat.rennerOpId = new Map(staat.renners.map((r) => [r.cq_riderid, r]));
    staat.koersen = koersen;
    staat.kalender = kalender;
    staat.alleCorrecties = alleCorrecties;
    staat.alleNaamwijzigingen = alleNaamwijzigingen;
    herbereken();
    staat.profiel = mijnProfielen.items[0] || null;
    staat.mijnSelecties = mijn;
    toonKop(renners);
    $("laden").hidden = true;
    if (staat.profiel) toonPloeg();
    else toonProfielformulier();
  } catch (fout) {
    console.error(fout);
    $("laden").hidden = true;
    melding(`Er liep iets mis bij het laden: ${fout.message}. Probeer de pagina te herladen.`, true);
  }
}

// Prijzen en punten opnieuw berekenen (na laden, na een correctie of na nieuwe instellingen).
// Correcties tellen enkel als een admin ze maakte.
function herbereken() {
  staat.prijzen = berekenPrijzen(staat.renners, staat.inst);
  staat.correcties = staat.alleCorrecties.filter((c) => staat.inst.admins.includes(c.createdBy?.email));
  // Enkel naamwijzigingen van een admin tellen; per deelnemer de recentste.
  staat.nieuweNaam = new Map();
  for (const w of [...staat.alleNaamwijzigingen].sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""))) {
    if (staat.inst.admins.includes(w.createdBy?.email)) staat.nieuweNaam.set(w.email, w.ploegnaam);
  }
  staat.resultaten = rennerResultaten(staat.koersen.koersen, staat.correcties, staat.inst, staat.kalender?.koersen);
}

// De ploegnaam van een deelnemer: die van de admin als die hem wijzigde, anders die uit het profiel.
function ploegnaamVan(email, profielnaam) {
  return staat.nieuweNaam.get(email) ?? profielnaam;
}

function isAdmin() {
  return staat.inst.admins.includes(staat.ik.email);
}

function toonKop(renners) {
  $("seizoen").textContent = staat.inst.seizoen;
  $("wie").textContent = staat.ik.name || staat.ik.email;
  $("kop-punten").textContent = `CQ ${renners.punten_van_seizoen}`;
  const laatste = staat.koersen.laatste_import;
  $("import-info").textContent = laatste && staat.koersen.aantal
    ? `Laatste nieuwe uitslagen: ${datumTijd(laatste)} · ${staat.koersen.aantal} uitslagen verwerkt`
    : `Nog geen uitslagen van ${staat.inst.seizoen}`;
}

// ---------- Profiel ----------

function toonProfielformulier() {
  const select = $("debuutjaar");
  for (let jaar = staat.inst.seizoen; jaar >= staat.inst.seizoen - 15; jaar--) {
    select.append(maak("option", { value: jaar, tekst: jaar === staat.inst.seizoen ? `${jaar} (dit is mijn eerste keer)` : jaar }));
  }
  $("profiel").hidden = false;
  $("profiel-form").onsubmit = async (e) => {
    e.preventDefault();
    const knop = e.submitter;
    const ploegnaam = $("ploegnaam").value.trim().replace(/\s+/g, " ");
    if (!ploegnaam) return melding("Geef je ploeg een naam.", true);
    knop.disabled = true;
    try {
      // Elke ploegnaam mag maar één keer voorkomen (hoofdletters tellen niet mee).
      const bestaande = await alleRecords(profielen, {});
      const bezet = [...bestaande.map((p) => p.ploegnaam || ""), ...staat.nieuweNaam.values()];
      if (bezet.some((naam) => naam.toLowerCase() === ploegnaam.toLowerCase())) {
        knop.disabled = false;
        return melding(`De naam "${ploegnaam}" is al gekozen. Kies een andere naam.`, true);
      }
      staat.profiel = await profielen.create({ ploegnaam, debuutjaar: Number(select.value) });
      melding("");
      $("profiel").hidden = true;
      toonPloeg();
    } catch (fout) {
      melding(`Opslaan lukte niet: ${fout.message}`, true);
      knop.disabled = false;
    }
  };
}

// ---------- Ploeg ----------

// De modus van vandaag (zie ploegModus in spel.js) en de ploeg waaraan je werkt:
// voor het seizoen de ploeg van periode 1, tijdens periode N die van periode N+1.
function modus() {
  return ploegModus(staat.inst);
}

function doelPloeg(m = modus()) {
  return ploegInPeriode(staat.mijnSelecties, m.doel ?? m.huidige ?? 1);
}

function transfersVoorDoel(m) {
  return transfersVan(staat.mijnSelecties).find((t) => t.periode === m.doel) || { uit: [], in: [] };
}

function datumLang(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" });
}

// Waarom mag deze renner er niet bij? null als het wel mag.
function redenNiet(riderid, m = modus()) {
  if (m.modus === "gesloten") return "Je ploeg ligt vast tot de volgende transferperiode.";
  const terug = staat.mijnSelecties.find((s) => s.cq_riderid === riderid && s.tot_periode === m.huidige);
  if (m.modus === "transfers" && !terug && transfersVoorDoel(m).in.length >= staat.inst.max_transfers) {
    return `Je gebruikte al je ${staat.inst.max_transfers} transfers voor periode ${m.doel}.`;
  }
  return magToevoegen(riderid, doelPloeg(m), staat.prijzen, staat.inst);
}

// ---------- Tabs ----------

function zetTabsKlaar() {
  // De adminpagina bestaat enkel voor admins: voor anderen komt de tab er niet.
  if (!isAdmin()) document.querySelector('.tab[data-tab="admin"]').remove();
  document.querySelectorAll(".tab").forEach((knop) => {
    knop.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((k) => k.classList.toggle("actief", k === knop));
      for (const tab of ["ploeg", "stand", "kalender", "regels", "admin"]) $(`tab-${tab}`).hidden = knop.dataset.tab !== tab;
      if (knop.dataset.tab === "stand") toonStand();
      if (knop.dataset.tab === "kalender") tekenKalender({ staat, maak, pt });
      if (knop.dataset.tab === "regels") tekenRegels({ staat, maak, pt });
      if (knop.dataset.tab === "admin") {
        toonAdmin({ staat, maak, melding, pt, datumTijd, correcties, profielen, ploegnamen, alleRecords, herbereken, tekenAlles, ploegnaamVan });
      }
    });
  });
}

function toonPloeg() {
  zetTabsKlaar();
  $("tab-ploeg").hidden = false;
  $("mijn-ploegnaam").textContent = ploegnaamVan(staat.ik.email, staat.profiel.ploegnaam) || "Mijn ploeg";
  const ploegen = [...new Set(staat.renners.map((r) => r.ploeg))].sort();
  for (const p of ploegen) $("filter-ploeg").append(maak("option", { tekst: p }));
  for (const id of ["zoek", "filter-type", "filter-ploeg", "filter-betaalbaar"]) {
    $(id).addEventListener("input", tekenPool);
  }
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const veld = th.dataset.sort;
      staat.sorteer = { veld, af: staat.sorteer.veld === veld ? !staat.sorteer.af : veld === "prijs" || veld === "punten" };
      tekenPool();
    });
  });
  tekenAlles();
}

function tekenAlles() {
  tekenMijnPloeg();
  tekenPool();
}

function besteed(ploeg) {
  return ploeg.reduce((som, s) => som + (staat.prijzen.get(s.cq_riderid) ?? 0), 0);
}

function statusTekst(m, ploeg) {
  const { inst } = staat;
  if (m.modus === "inschrijving") {
    const tekort = inst.ploeggrootte - ploeg.length;
    return tekort > 0
      ? `Kies ${tekort} renners meer. Je kunt je ploeg vrij aanpassen tot ${datumLang(m.deadline)}.`
      : `Je ploeg is compleet. Je kunt ze nog aanpassen tot ${datumLang(m.deadline)}.`;
  }
  if (m.modus === "transfers") {
    const t = transfersVoorDoel(m);
    return `Transferperiode tot en met ${datumLang(m.sluit)}, voor periode ${m.doel}: ${t.uit.length} verkocht en ${t.in.length} gekocht, ` +
      `maximaal ${inst.max_transfers}. ` +
      "Verkochte renners rijden nog voor je tot het einde van deze periode.";
  }
  if (m.volgende) {
    return `Je ploeg ligt vast. Volgende transferperiode: ${datumLang(m.volgende.open)} tot en met ${datumLang(m.volgende.sluit)}, voor periode ${m.volgende.nr + 1}.`;
  }
  return "De ploegen liggen vast tot het einde van het seizoen.";
}

function tekenMijnPloeg() {
  const { inst } = staat;
  const m = modus();
  const ploeg = doelPloeg(m);
  const uit = besteed(ploeg);

  $("budget-tekst").textContent = `${uit} / ${inst.budget} credits`;
  $("budget-balk").style.width = `${Math.min(100, (uit / inst.budget) * 100)}%`;
  $("aantal-tekst").textContent = `${ploeg.length} / ${inst.ploeggrootte}`;
  $("aantal-balk").style.width = `${Math.min(100, (ploeg.length / inst.ploeggrootte) * 100)}%`;

  // Punten die elke renner al voor jou verdiende (enkel in de periodes dat hij in je ploeg zat).
  const mijnStand = berekenStand(staat.mijnSelecties, staat.resultaten)[0];
  const puntenVan = new Map((mijnStand?.renners || []).map((r) => [r.cq_riderid, r.punten]));
  $("ploeg-status").textContent = statusTekst(m, ploeg) + (mijnStand ? ` Totaal: ${pt(mijnStand.punten)} punten.` : "");

  // In de transferperiode tonen we ook wie eruit gaat, met een knop om dat ongedaan te maken.
  const vertrekkers = m.modus === "transfers"
    ? ploegInPeriode(staat.mijnSelecties, m.huidige).filter((s) => s.tot_periode === m.huidige)
    : [];

  const lijst = $("ploeg-lijst");
  lijst.replaceChildren();
  const rijen = [...ploeg, ...vertrekkers].sort((a, b) => staat.prijzen.get(b.cq_riderid) - staat.prijzen.get(a.cq_riderid));
  for (const sel of rijen) {
    const r = staat.rennerOpId.get(sel.cq_riderid);
    const vertrekt = vertrekkers.includes(sel);
    const nieuw = m.modus === "transfers" && sel.vanaf_periode === m.doel;
    let knop;
    if (vertrekt) {
      knop = maak("button", {
        klasse: "knop-klein knop-plus", tekst: "↺", title: "Toch houden",
        disabled: staat.bezig || !!redenNiet(sel.cq_riderid, m), onclick: () => houd(sel),
      });
    } else {
      knop = minKnop(sel, m);
    }
    const label = vertrekt ? ` · gaat eruit na periode ${m.huidige}` : nieuw ? ` · nieuw vanaf periode ${m.doel}` : "";
    lijst.append(maak("li", { klasse: vertrekt ? "vertrekt" : nieuw ? "nieuw" : "" }, [
      maak("div", {}, [
        maak("div", { klasse: "renner-naam", tekst: r ? r.naam : `Renner ${sel.cq_riderid}` }),
        maak("div", {
          klasse: "renner-sub",
          tekst: `${r ? `${r.land} · ${r.ploeg}` : "Niet meer in de rennerslijst"} · ${pt(puntenVan.get(sel.cq_riderid) || 0)} pt${label}`,
        }),
      ]),
      maak("span", { klasse: "prijs", tekst: `${staat.prijzen.get(sel.cq_riderid) ?? "?"} cr` }),
      m.modus === "gesloten" ? maak("span") : knop,
    ]));
  }
  if (!rijen.length) lijst.append(maak("li", { klasse: "leeg", tekst: "Nog geen renners gekozen. Kies ze in de rennerspool." }));

  // Je eigen transfers, ook de geplande.
  const blok = $("mijn-transfers");
  blok.replaceChildren();
  const alle = transfersVan(staat.mijnSelecties);
  blok.hidden = !alle.length;
  if (alle.length) {
    blok.append(maak("h3", { tekst: "Mijn transfers" }), transferLijst(alle));
  }
}

// De knop om een renner uit je ploeg te halen (in je ploeg én in de rennerspool).
// Voor het seizoen of bij een nieuwe aankoop: schrappen. Anders: verkopen na de lopende periode.
function minKnop(sel, m) {
  const nieuw = m.modus === "transfers" && sel.vanaf_periode === m.doel;
  const magNiet = m.modus === "gesloten" ||
    (m.modus === "transfers" && !nieuw && transfersVoorDoel(m).uit.length >= staat.inst.max_transfers);
  return maak("button", {
    klasse: "knop-klein knop-min", tekst: "−",
    title: m.modus === "gesloten" ? "Je ploeg ligt vast tot de volgende transferperiode."
      : m.modus === "inschrijving" || nieuw ? "Uit je ploeg halen"
      : magNiet ? "Geen transfers meer over" : "Verkopen na deze periode",
    disabled: staat.bezig || magNiet, onclick: () => verwijder(sel, m),
  });
}

function tekenPool() {
  const { inst } = staat;
  const m = modus();
  const ploeg = doelPloeg(m);
  const gekozen = new Set(ploeg.map((s) => s.cq_riderid));
  const zoek = $("zoek").value.trim().toLowerCase();
  const type = $("filter-type").value;
  const ploegnaam = $("filter-ploeg").value;
  const betaalbaar = $("filter-betaalbaar").checked;

  let rijen = staat.renners.filter((r) =>
    (!zoek || `${r.naam} ${r.land} ${r.ploeg}`.toLowerCase().includes(zoek)) &&
    (!type || r.ploegtype === type) &&
    (!ploegnaam || r.ploeg === ploegnaam) &&
    (!betaalbaar || !redenNiet(r.cq_riderid, m)),
  );
  const { veld, af } = staat.sorteer;
  const waarde = {
    naam: (r) => r.naam, land: (r) => r.land, ploeg: (r) => r.ploeg,
    punten: (r) => r.cq_punten_vorig_seizoen, prijs: (r) => staat.prijzen.get(r.cq_riderid),
  }[veld];
  rijen.sort((a, b) => {
    const x = waarde(a), y = waarde(b);
    const verschil = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
    return (af ? -verschil : verschil) || b.cq_punten_vorig_seizoen - a.cq_punten_vorig_seizoen;
  });
  document.querySelectorAll("th[data-sort]").forEach((th) => th.classList.toggle("gesorteerd", th.dataset.sort === veld));

  const maxRijen = 300;
  const tbody = $("pool-lijst");
  tbody.replaceChildren();
  for (const r of rijen.slice(0, maxRijen)) {
    const reden = redenNiet(r.cq_riderid, m);
    tbody.append(maak("tr", { klasse: gekozen.has(r.cq_riderid) ? "gekozen" : "" }, [
      maak("td", {}, [maak("span", { klasse: "renner-naam", tekst: r.naam })]),
      maak("td", { tekst: r.land }),
      maak("td", { tekst: r.ploeg }),
      maak("td", { klasse: "getal", tekst: r.cq_punten_vorig_seizoen }),
      maak("td", { klasse: "getal prijs", tekst: staat.prijzen.get(r.cq_riderid) }),
      maak("td", {}, [gekozen.has(r.cq_riderid)
        ? minKnop(ploeg.find((s) => s.cq_riderid === r.cq_riderid), m)
        : maak("button", {
          klasse: "knop-klein knop-plus", tekst: "+",
          title: reden || (m.modus === "transfers" ? `Kopen voor periode ${m.doel}` : "In je ploeg zetten"),
          disabled: !!reden || staat.bezig, onclick: () => voegToe(r.cq_riderid),
        })]),
    ]));
  }
  $("pool-info").textContent = rijen.length > maxRijen
    ? `${maxRijen} van ${rijen.length} renners getoond. Zoek of filter om de rest te zien.`
    : `${rijen.length} renners.`;
}

// Voert een wijziging uit, met de knoppen uitgeschakeld zolang ze loopt.
async function bewaar(actie, foutTekst) {
  staat.bezig = true;
  tekenAlles();
  try {
    await actie();
    melding("");
  } catch (fout) {
    melding(`${foutTekst}: ${fout.message}`, true);
  } finally {
    staat.bezig = false;
    tekenAlles();
  }
}

function vervang(record) {
  staat.mijnSelecties = staat.mijnSelecties.map((s) => (s.id === record.id ? record : s));
}

// Een renner kopen (of voor het seizoen: kiezen).
async function voegToe(riderid) {
  const m = modus();
  const reden = redenNiet(riderid, m);
  if (reden) return melding(reden, true);
  // Verkocht je deze renner net? Dan maken we de verkoop ongedaan in plaats van hem opnieuw te kopen.
  const verkocht = staat.mijnSelecties.find((s) => s.cq_riderid === riderid && m.modus === "transfers" && s.tot_periode === m.huidige);
  if (verkocht) return houd(verkocht);
  await bewaar(async () => {
    const record = await selecties.create({ cq_riderid: riderid, vanaf_periode: m.doel, tot_periode: null });
    staat.mijnSelecties.push(record);
  }, "Toevoegen lukte niet");
}

// Een renner uit de ploeg halen: voor het seizoen of bij een nieuwe aankoop gewoon schrappen,
// anders verkopen na de lopende periode.
async function verwijder(selectie, m = modus()) {
  if (m.modus === "gesloten") return;
  if (m.modus === "inschrijving" || selectie.vanaf_periode === m.doel) {
    return bewaar(async () => {
      await selecties.delete(selectie.id);
      staat.mijnSelecties = staat.mijnSelecties.filter((s) => s.id !== selectie.id);
    }, "Verwijderen lukte niet");
  }
  if (transfersVoorDoel(m).uit.length >= staat.inst.max_transfers) {
    return melding(`Je gebruikte al je ${staat.inst.max_transfers} transfers voor periode ${m.doel}.`, true);
  }
  await bewaar(async () => vervang(await selecties.update(selectie.id, { tot_periode: m.huidige })), "Verkopen lukte niet");
}

// Een verkoop ongedaan maken.
async function houd(selectie) {
  await bewaar(async () => vervang(await selecties.update(selectie.id, { tot_periode: null })), "Terugzetten lukte niet");
}

// Transfers als lijst per periode: "Periode 3 · Uit: … · In: …".
function transferLijst(transfers) {
  const naam = (id) => `${staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`} (${staat.prijzen.get(id) ?? "?"} cr)`;
  return maak("ul", { klasse: "transfers" }, transfers.map((t) => maak("li", {}, [
    maak("strong", { tekst: `Periode ${t.periode}` }),
    maak("span", { klasse: "uit", tekst: `Uit: ${t.uit.map(naam).join(", ") || "–"}` }),
    maak("span", { klasse: "in", tekst: `In: ${t.in.map(naam).join(", ") || "–"}` }),
  ])));
}

// ---------- Stand ----------

async function toonStand() {
  const keuze = $("stand-keuze");
  if (!keuze.options.length) {
    keuze.append(maak("option", { value: "", tekst: "Algemeen klassement" }));
    for (const p of staat.inst.periodes) {
      const van = new Date(p.start).toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
      const tot = new Date(p.eind).toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
      keuze.append(maak("option", { value: p.nr, tekst: `Periode ${p.nr} (${van} – ${tot})` }));
    }
    keuze.addEventListener("input", tekenStand);
    $("stand-groep").addEventListener("input", tekenStand);
  }
  $("stand-lijst").replaceChildren(maak("tr", {}, [maak("td", { colSpan: 5, tekst: "Stand wordt berekend…" })]));
  try {
    // Altijd vers ophalen: de ploegen van iedereen en hun ploegnamen.
    const [alleSelecties, alleProfielen] = await Promise.all([alleRecords(selecties, {}), alleRecords(profielen, {})]);
    staat.alleSelecties = alleSelecties;
    staat.ploegnaamVan = new Map(alleProfielen.filter((p) => p.createdBy).map((p) => [p.createdBy.email, ploegnaamVan(p.createdBy.email, p.ploegnaam)]));
    staat.debutanten = new Set(alleProfielen.filter((p) => p.createdBy && p.debuutjaar === staat.inst.seizoen).map((p) => p.createdBy.email));
    staat.naamVan = new Map(alleSelecties.filter((s) => s.createdBy).map((s) => [s.createdBy.email, s.createdBy.name]));
    tekenStand();
  } catch (fout) {
    melding(`De stand laden lukte niet: ${fout.message}`, true);
  }
}

function tekenStand() {
  const periodeNr = $("stand-keuze").value ? Number($("stand-keuze").value) : null;
  // Debutantenklassement: enkel wie dit seizoen voor het eerst meespeelt (plaatsen opnieuw geteld).
  const enkelDebutanten = $("stand-groep").value === "debutanten";
  const meetellend = enkelDebutanten
    ? staat.alleSelecties.filter((s) => staat.debutanten.has(s.createdBy?.email))
    : staat.alleSelecties;
  const rijen = berekenStand(meetellend, staat.resultaten, periodeNr);
  const tbody = $("stand-lijst");
  tbody.replaceChildren();
  if (!rijen.length) {
    tbody.append(maak("tr", {}, [maak("td", { colSpan: 5, tekst: $("stand-groep").value === "debutanten" ? "Nog geen debutanten." : "Nog geen ploegen." })]));
    return;
  }
  for (const rij of rijen) {
    const detail = maak("tr", { klasse: "detail", hidden: true }, [maak("td", { colSpan: 5 }, detailBlok(rij, periodeNr))]);
    tbody.append(
      maak("tr", { klasse: `deelnemer${rij.email === staat.ik.email ? " ik" : ""}`, onclick: () => { detail.hidden = !detail.hidden; } }, [
        maak("td", { klasse: `getal plaats plaats-${rij.plaats}`, tekst: rij.plaats }),
        maak("td", { tekst: staat.ploegnaamVan.get(rij.email) || "(nog geen ploegnaam)" }),
        maak("td", { tekst: staat.naamVan.get(rij.email) || rij.email }),
        maak("td", { klasse: "getal", tekst: rij.overwinningen }),
        maak("td", { klasse: "getal punten", tekst: pt(rij.punten) }),
      ]),
      detail,
    );
  }
}

// Wat je ziet als je een ploeg openklikt: de renners met hun punten en de transfers.
function detailBlok(rij, periodeNr) {
  return [maak("h4", { tekst: "Renners" }), detailLijst(rij), maak("h4", { tekst: "Transfers" }), transfersVanDeelnemer(rij.email, periodeNr)];
}

// Transfers van één deelnemer, voor één periode of (algemeen klassement) allemaal.
// Transfers voor een periode die nog niet begonnen is, zie je enkel bij je eigen ploeg.
function transfersVanDeelnemer(email, periodeNr) {
  const vandaag = vandaagISO();
  const gestart = new Set(staat.inst.periodes.filter((p) => p.start <= vandaag).map((p) => p.nr));
  const transfers = transfersVan(staat.alleSelecties.filter((s) => s.createdBy?.email === email))
    .filter((t) => (periodeNr == null || t.periode === periodeNr) && (email === staat.ik.email || gestart.has(t.periode)));
  if (!transfers.length) {
    return maak("p", { klasse: "klein", tekst: periodeNr ? `Geen transfers bij de start van periode ${periodeNr}.` : "Nog geen transfers." });
  }
  return transferLijst(transfers);
}

// De renners van een deelnemer met hun punten, en per renner de koersen waar ze scoorden.
function detailLijst(rij) {
  const lijst = maak("ul");
  for (const renner of rij.renners.filter((r) => r.punten > 0)) {
    const r = staat.rennerOpId.get(renner.cq_riderid);
    const resultaten = [...renner.resultaten].sort((a, b) => b.punten - a.punten);
    const kort = resultaten.slice(0, 3).map((k) => `${k.naam} (${k.positie}e)`).join(" · ");
    const alles = maak("ul", { klasse: "resultaten" }, resultaten.map((k) => maak("li", {}, [
      maak("span", { tekst: `${k.datum.slice(8, 10)}/${k.datum.slice(5, 7)} · ${k.naam} · ${k.positie}e` }),
      maak("span", { klasse: "punten-renner", tekst: pt(k.punten) }),
    ])));
    lijst.append(maak("li", {}, [
      maak("details", {}, [
        maak("summary", {}, [
          maak("strong", { tekst: r ? r.naam : `Renner ${renner.cq_riderid}` }),
          maak("span", { klasse: "klein", tekst: `${resultaten.length} resultaten · ${kort}${resultaten.length > 3 ? " …" : ""}` }),
          maak("span", { klasse: "punten-renner", tekst: `${pt(renner.punten)} pt` }),
        ]),
        alles,
      ]),
    ]));
  }
  if (!lijst.children.length) lijst.append(maak("li", { tekst: "Nog geen punten in deze periode." }));
  return lijst;
}

start();
