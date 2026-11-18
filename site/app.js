import {
  berekenPrijzen, berekenStand, jokerBonus, prijsScore, jokersGebruikt, magToevoegen, normaliseer, ploegInPeriode, ploegModus, rennerResultaten,
  rennerTypes, transfersVan, dagNa,
  TYPES, vandaagISO, zetTestdatum,
} from "./spel.js";
import { toonAdmin } from "./admin.js";
import { tekenKalender } from "./kalender.js";
import { inHetKort, tekenRegels } from "./regels.js";
import { tekenOverzicht } from "./overzicht.js";
import { truiDragers, truiIcoon } from "./truien.js";
import { tekenStatistieken } from "./statistieken.js";
import { tekenSpiegel } from "./spiegel.js";

const $ = (id) => document.getElementById(id);
const profielen = window.vibers.db.collection("profielen");
const selecties = window.vibers.db.collection("selecties");
const correcties = window.vibers.db.collection("correcties");
// Ploegnamen die een admin wijzigde: { email, ploegnaam }. Die gaan voor op de naam in het profiel.
const ploegnamen = window.vibers.db.collection("ploegnamen");
// Ploegen die een admin verwijderde: { email }. Alles wat die deelnemer voordien maakte
// (profiel, renners, ploegnaam) telt niet meer; daarna kan die opnieuw beginnen.
const verwijderingen = window.vibers.db.collection("verwijderingen");

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
  typeFilter: "", // "" = alle types
  jokerModus: false, // speelt de deelnemer nu een joker uit (buiten een transferperiode)?
  planModus: false, // zet de deelnemer nu transfers klaar voor de volgende transferperiode?
  poolPagina: 0, // welke pagina van de rennerspool (telt vanaf 0)
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
  // Testploegen (enkel in de testversie) tellen als aparte deelnemers, niet als die van de admin.
  const metTest = items.map(alsTestdeelnemer);
  return query?.mine ? metTest.filter((r) => !r.testdeelnemer) : metTest;
}

// Een record van een testploeg krijgt de testploeg als maker.
function alsTestdeelnemer(record) {
  if (!record.testdeelnemer) return record;
  return { ...record, mine: false, createdBy: { email: record.testdeelnemer, name: record.testnaam } };
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
    // Instellingen van voor de prijs over meerdere seizoenen: neem ook de nieuwe prijsschijven over,
    // want de oude grenzen hoorden bij de punten van één seizoen.
    if (!opgeslagen.prijs_gewichten) delete opgeslagen.prijsschijven;
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
    // Rustigere lay-out (voorlopig enkel op de testsite): aan of uit via de instelling "layout".
    // "gemengd" = de rustige structuur met het karakter van de klassieke lay-out.
    document.body.classList.toggle("rustig", ["rustig", "gemengd"].includes(staat.inst.layout));
    document.body.classList.toggle("gemengd", staat.inst.layout === "gemengd");
    try { localStorage.setItem("layout", staat.inst.layout || "klassiek"); } catch { /* geen opslag: niet erg */ }
    const [renners, koersen, mijnProfielen, mijn, alleCorrecties, kalender, alleNaamwijzigingen, koersenVorig, alleVerwijderingen] = await Promise.all([
      haalJson(staat.inst.renners_url),
      haalJson(staat.inst.koersen_url),
      alleRecords(profielen, { mine: true }),
      alleRecords(selecties, { mine: true }),
      alleRecords(correcties, {}),
      // De kalender is mooi meegenomen; lukt hij niet, dan werkt de rest gewoon verder.
      haalJson(staat.inst.kalender_url).catch(() => null),
      alleRecords(ploegnamen, {}),
      // Uitslagen van vorig seizoen, om de renners in te delen per type.
      haalJson(staat.inst.koersen_vorig_url.replace("{vorig}", staat.inst.seizoen - 1)).catch(() => null),
      alleRecords(verwijderingen, {}),
    ]);
    staat.renners = renners.renners;
    staat.rennerOpId = new Map(staat.renners.map((r) => [r.cq_riderid, r]));
    staat.koersen = koersen;
    if (staat.inst.testmodus) await zetTestmodusKlaar();
    staat.kalender = kalender;
    staat.koersenVorig = koersenVorig?.koersen || [];
    staat.alleCorrecties = alleCorrecties;
    staat.alleNaamwijzigingen = alleNaamwijzigingen;
    staat.alleVerwijderingen = alleVerwijderingen;
    herbereken();
    staat.profiel = mijnProfielen.filter((r) => geldig(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
    staat.mijnSelecties = mijn.filter((r) => geldig(r));
    if (!staat.profiel && mijnProfielen.length) {
      melding("Een admin heeft je vorige ploeg verwijderd. Je kunt opnieuw beginnen.");
      ruimOudeRecordsOp([...mijnProfielen, ...mijn].filter((r) => !geldig(r)));
    }
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
// Telt dit record nog mee? Niet als een admin de ploeg van `email` (standaard: de maker)
// nadien verwijderde.
function geldig(record, email = record.createdBy?.email) {
  const op = staat.verwijderdOp.get(email);
  return !op || record.createdAt > op;
}

// Je eigen records van een verwijderde ploeg opruimen (lukt dat niet, dan tellen ze toch niet mee).
async function ruimOudeRecordsOp(records) {
  for (const r of records) {
    const collectie = "ploegnaam" in r ? profielen : selecties;
    await collectie.delete(r.id).catch(() => {});
  }
}

function herbereken() {
  // Enkel verwijderingen door een admin tellen; per deelnemer de recentste.
  staat.verwijderdOp = new Map();
  for (const v of staat.alleVerwijderingen) {
    if (!staat.inst.admins.includes(v.createdBy?.email)) continue;
    if (!staat.verwijderdOp.has(v.email) || v.createdAt > staat.verwijderdOp.get(v.email)) staat.verwijderdOp.set(v.email, v.createdAt);
  }
  staat.prijzen = berekenPrijzen(staat.renners, staat.inst);
  staat.scores = new Map(staat.renners.map((r) => [r.cq_riderid, prijsScore(r, staat.inst)]));
  staat.correcties = staat.alleCorrecties.filter((c) => staat.inst.admins.includes(c.createdBy?.email));
  // Enkel naamwijzigingen van een admin tellen; per deelnemer de recentste.
  staat.nieuweNaam = new Map();
  for (const w of [...staat.alleNaamwijzigingen].sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""))) {
    if (staat.inst.admins.includes(w.createdBy?.email) && geldig(w, w.email)) staat.nieuweNaam.set(w.email, w.ploegnaam);
  }
  staat.resultaten = rennerResultaten(staat.koersen.koersen, staat.correcties, staat.inst, staat.kalender?.koersen);
  staat.types = rennerTypes(staat.koersenVorig, staat.inst);
}

function typeVan(riderid) {
  return staat.types.get(riderid) || "Knecht";
}

// De ploegnaam van een deelnemer: die van de admin als die hem wijzigde, anders die uit het profiel.
function ploegnaamVan(email, profielnaam) {
  return staat.nieuweNaam.get(email) ?? profielnaam;
}

function isAdmin() {
  return staat.inst.admins.includes(staat.ik.email);
}

// ---------- Testversie ----------

// In de testversie (instelling testmodus) speelt de site een oud seizoen na met een
// gesimuleerde datum. Elke deelnemer heeft zijn eigen datum en zet die zelf verder, op
// eigen tempo. Enkel koersen tot die datum tellen.
async function zetTestmodusKlaar() {
  const rij = await window.storage.get("testdatum", false);
  const datum = rij?.value || staat.inst.testmodus_startdatum;
  zetTestdatum(datum);
  staat.alleKoersen = staat.koersen.koersen;
  const gereden = staat.alleKoersen.filter((k) => k.datum <= datum);
  staat.koersen = { ...staat.koersen, koersen: gereden, aantal: gereden.length };

  $("testbalk").hidden = false;
  // De volgende koersdagen. Een sprong stopt altijd aan het begin van een transferperiode,
  // zodat je er niet overheen springt en je transfers kunt doen.
  const koersdagen = [...new Set(staat.alleKoersen.filter((k) => k.datum > datum).map((k) => k.datum))].sort();
  const stopBijTransfers = (doel) => {
    const venster = staat.inst.transferperiodes.find((tp) => tp.open > datum && tp.open <= doel);
    return venster ? venster.open : doel;
  };
  const volgende = koersdagen[0] && stopBijTransfers(koersdagen[0]);
  const vijfde = koersdagen.length && stopBijTransfers(koersdagen[Math.min(4, koersdagen.length - 1)]);
  const vandaag = staat.alleKoersen.filter((k) => k.datum === datum).map((k) => k.naam);
  const openVenster = staat.inst.transferperiodes.find((tp) => tp.open <= datum && datum <= tp.sluit);
  $("test-datum").textContent = new Date(datum).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("test-info").textContent = (vandaag.length
    ? `Vandaag gereden: ${vandaag.slice(0, 3).join(" · ")}${vandaag.length > 3 ? ` en nog ${vandaag.length - 3}` : ""}.`
    : "Vandaag geen koersen.") +
    (openVenster ? ` Transferperiode ${openVenster.nr} is open tot en met ${new Date(openVenster.sluit).toLocaleDateString("nl-BE", { day: "numeric", month: "long" })}.` : "");
  // Iedereen mag zijn eigen datum verderzetten; testploegen aanmaken blijft voor admins.
  $("test-ploegen").hidden = !staat.inst.admins.includes(staat.ik.email);
  const zet = async (nieuw) => {
    await window.storage.set("testdatum", nieuw, false);
    location.reload();
  };
  $("test-volgende").disabled = !volgende;
  $("test-volgende").onclick = () => zet(volgende);
  $("test-vijf").disabled = !vijfde;
  $("test-vijf").onclick = () => zet(vijfde);
  $("test-ploegen").onclick = maakTestploegen;
  $("test-reset").onclick = () => {
    if (bevestigd($("test-reset"), "Zeker? Klik nogmaals")) zet(staat.inst.testmodus_startdatum);
    else melding("Klik nogmaals op de knop om terug te gaan naar de seizoensstart. De ploegen blijven bewaard; alle punten gaan terug naar 0.");
  };
}

// Maakt 3 testploegen (A, B, C) met elk een volledige ploeg, volgens "Vul mijn ploeg aan".
// Bestaat een testploeg al, dan slaan we die over.
async function maakTestploegen() {
  const knop = $("test-ploegen");
  knop.disabled = true;
  try {
    const bestaande = new Set((await alleRecords(profielen, {})).filter((p) => geldig(p)).map((p) => p.createdBy?.email));
    let gemaakt = 0;
    for (const letter of ["A", "B", "C"]) {
      const testdeelnemer = `testploeg-${letter.toLowerCase()}@test.o2o`;
      if (bestaande.has(testdeelnemer)) continue;
      const testnaam = `Testploeg ${letter}`;
      melding(`${testnaam} wordt aangemaakt…`);
      await profielen.create({ ploegnaam: testnaam, debuutjaar: staat.inst.seizoen, testdeelnemer, testnaam });
      for (const id of maakVoorstel([])) {
        await selecties.create({ cq_riderid: id, vanaf_periode: 1, tot_periode: null, testdeelnemer, testnaam });
      }
      gemaakt += 1;
    }
    melding(gemaakt ? `${gemaakt} testploegen aangemaakt.` : "De 3 testploegen bestaan al.");
    if (gemaakt) setTimeout(() => location.reload(), 800);
  } catch (fout) {
    melding(`Testploegen aanmaken lukte niet: ${fout.message}`, true);
  } finally {
    knop.disabled = false;
  }
}

function toonKop(renners) {
  $("seizoen").textContent = staat.inst.seizoen;
  $("wie").textContent = staat.ik.name || staat.ik.email;
  $("kop-punten").textContent = "Score";
  $("kop-punten").title = "Gewogen gemiddelde van de CQ-punten van de vorige seizoenen; bepaalt de prijs.";
  const laatste = staat.koersen.laatste_import;
  if (staat.inst.testmodus) {
    $("import-info").textContent = `Testversie · ${staat.koersen.aantal} van ${staat.alleKoersen.length} uitslagen van ${staat.inst.seizoen} gereden`;
    return;
  }
  $("import-info").textContent = laatste && staat.koersen.aantal
    ? `Laatste nieuwe uitslagen: ${datumTijd(laatste)} · ${staat.koersen.aantal} uitslagen verwerkt`
    : `Nog geen uitslagen van ${staat.inst.seizoen}`;
}

// ---------- Profiel ----------

function toonProfielformulier() {
  $("welkom-uitleg").replaceChildren(inHetKort({ inst: staat.inst, maak }));
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
      const bestaande = (await alleRecords(profielen, {})).filter((r) => geldig(r));
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
// Buiten een transferperiode kan een deelnemer:
// - een joker uitspelen (modus "joker"): de wissel geldt vanaf morgen;
// - transfers plannen voor de volgende transferperiode (modus "transfers" met `gepland`): die werken
//   precies zoals transfers in de transferperiode (ze gaan in bij de start van de volgende periode)
//   en kunnen aangepast worden tot het einde van die transferperiode.
function modus() {
  const m = ploegModus(staat.inst);
  const vandaag = vandaagISO();
  const morgen = dagNa(vandaag);
  const kanJoker = m.modus === "gesloten" && m.huidige && vandaag <= staat.inst.seizoen_einde && staat.inst.jokers > 0;
  const kanPlannen = m.modus === "gesloten" && !!m.volgende;
  if (kanJoker && staat.jokerModus) return { ...m, modus: "joker", vandaag, morgen, kanPlannen };
  if (kanPlannen && staat.planModus) {
    return { ...m, modus: "transfers", gepland: true, doel: m.volgende.nr + 1, sluit: m.volgende.sluit,
      deadline: dagNa(m.volgende.sluit), vandaag, morgen, kanJoker };
  }
  return { ...m, kanJoker, kanPlannen, vandaag, morgen };
}

// De ploeg waaraan je werkt. Bij een joker: de ploeg zoals ze er morgen uitziet.
function doelPloeg(m = modus()) {
  if (m.modus === "joker" || m.modus === "gesloten") return ploegInPeriode(staat.mijnSelecties, m.huidige ?? 1, m.morgen);
  return ploegInPeriode(staat.mijnSelecties, m.doel ?? m.huidige ?? 1);
}

function transfersVoorDoel(m) {
  return transfersVan(staat.mijnSelecties).find((t) => t.periode === m.doel && !t.joker) || { uit: [], in: [] };
}

// Jokers: hoeveel heb je nog, en welke wissels staan voor morgen klaar?
function jokerStand(m = modus()) {
  const gebruikt = jokersGebruikt(staat.mijnSelecties);
  const uitVandaag = staat.mijnSelecties.filter((s) => s.tot_datum === m.vandaag);
  const inMorgen = staat.mijnSelecties.filter((s) => s.vanaf_datum === m.morgen);
  return { gebruikt, over: staat.inst.jokers - gebruikt, uitVandaag, inMorgen };
}

function datumLang(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" });
}

// Waarom mag deze renner er niet bij? null als het wel mag.
function redenNiet(riderid, m = modus()) {
  if (m.modus === "gesloten") return "Je ploeg ligt vast tot de volgende transferperiode. Je kunt wel een joker inzetten.";
  if (m.modus === "joker") {
    const terugJoker = staat.mijnSelecties.find((s) => s.cq_riderid === riderid && s.tot_datum === m.vandaag);
    if (!terugJoker && jokerStand(m).over <= 0) return `Je gebruikte al je ${staat.inst.jokers} jokers.`;
    return magToevoegen(riderid, doelPloeg(m), staat.prijzen, staat.inst);
  }
  const terug = staat.mijnSelecties.find((s) => s.cq_riderid === riderid && s.tot_periode === m.huidige && !s.tot_datum);
  if (m.modus === "transfers" && !terug && transfersVoorDoel(m).in.length >= staat.inst.max_transfers) {
    return `Je gebruikte al je ${staat.inst.max_transfers} transfers voor periode ${m.doel}.`;
  }
  return magToevoegen(riderid, doelPloeg(m), staat.prijzen, staat.inst);
}

// ---------- Tabs ----------

// In de rustige lay-out staan sommige tabbladen samen onder één hoofdtab, met subtabs.
const GROEPEN = { stand: ["stand", "spiegel", "statistieken"], meer: ["regels", "admin"] };
const SUBNAAM = { stand: "Klassement", spiegel: "Spiegel", statistieken: "Statistieken", regels: "Spelregels", admin: "Admin" };

function toonSubtabs(tab) {
  const rustig = document.body.classList.contains("rustig");
  const groep = rustig ? Object.keys(GROEPEN).find((g) => GROEPEN[g].includes(tab)) : null;
  // De hoofdtab van de groep oplichten (bv. "Stand" ook bij Spiegel).
  if (groep) document.querySelectorAll(".tab").forEach((k) => k.classList.toggle("actief", k.dataset.tab === groep));
  const nav = $("subtabs");
  nav.hidden = !groep;
  if (!groep) return;
  const beschikbaar = GROEPEN[groep].filter((t) => document.querySelector(`.tab[data-tab="${t}"]`));
  nav.replaceChildren(...beschikbaar.map((t) => maak("button", {
    type: "button", klasse: `subtab${t === tab ? " actief" : ""}`, tekst: SUBNAAM[t], onclick: () => naarTab(t),
  })));
}

function zetTabsKlaar() {
  // De adminpagina bestaat enkel voor admins: voor anderen komt de tab er niet.
  if (!isAdmin()) document.querySelector('.tab[data-tab="admin"]').remove();
  document.querySelectorAll(".tab").forEach((knop) => {
    knop.addEventListener("click", () => {
      if (knop.dataset.tab === "meer") return naarTab(GROEPEN.meer[0]);
      document.querySelectorAll(".tab").forEach((k) => k.classList.toggle("actief", k === knop));
      toonSubtabs(knop.dataset.tab);
      for (const tab of ["overzicht", "ploeg", "stand", "spiegel", "statistieken", "kalender", "regels", "admin"]) $(`tab-${tab}`).hidden = knop.dataset.tab !== tab;
      if (knop.dataset.tab === "overzicht") toonOverzicht();
      if (knop.dataset.tab === "spiegel") {
        tekenSpiegel({ staat, maak, pt, typeVan, laadDeelnemers })
          .catch((fout) => melding(`De spiegel laden lukte niet: ${fout.message}`, true));
      }
      if (knop.dataset.tab === "statistieken") {
        tekenStatistieken({ staat, maak, pt, typeVan, laadDeelnemers })
          .catch((fout) => melding(`De statistieken laden lukte niet: ${fout.message}`, true));
      }
      if (knop.dataset.tab === "stand") toonStand();
      if (knop.dataset.tab === "kalender") tekenKalender({ staat, maak, pt });
      if (knop.dataset.tab === "regels") tekenRegels({ staat, maak, pt });
      if (knop.dataset.tab === "admin") {
        toonAdmin({
          staat, maak, melding, pt, datumTijd, correcties, profielen, ploegnamen, verwijderingen, alleRecords, herbereken, tekenAlles, ploegnaamVan, geldig,
          laadDeelnemers, bevestigd,
        });
      }
    });
  });
}

// Vraagt bevestiging in de knop zelf, want vensters zoals confirm() werken niet op vibers.
// De eerste klik zet een vraag in de knop en geeft false; een tweede klik binnen 5 seconden geeft true.
function bevestigd(knop, vraag) {
  if (knop.dataset.bevestig === "ja") {
    clearTimeout(Number(knop.dataset.wacht));
    delete knop.dataset.bevestig;
    knop.textContent = knop.dataset.tekst;
    return true;
  }
  knop.dataset.tekst = knop.textContent;
  knop.dataset.bevestig = "ja";
  knop.textContent = vraag;
  knop.dataset.wacht = setTimeout(() => {
    delete knop.dataset.bevestig;
    knop.textContent = knop.dataset.tekst;
  }, 5000);
  return false;
}

// Naar een tab gaan, alsof je erop klikt.
function naarTab(tab) {
  document.querySelector(`.tab[data-tab="${tab}"]`).click();
}

function toonOverzicht() {
  const vulAan = async () => { await doeVoorstel(); toonOverzicht(); };
  tekenOverzicht({ staat, maak, pt, typeVan, laadDeelnemers, naarTab, vulAan })
    .catch((fout) => melding(`Het overzicht laden lukte niet: ${fout.message}`, true));
}

// Notities: een eigen kladblok, bewaard per persoon (vibers' localStorage volgt je naar elke browser).
function zetNotitiesKlaar() {
  const veld = $("notities");
  try {
    veld.value = localStorage.getItem("notities") || "";
  } catch {
    veld.value = "";
  }
  let wacht;
  veld.addEventListener("input", () => {
    $("notities-status").textContent = "…";
    clearTimeout(wacht);
    wacht = setTimeout(() => {
      try {
        localStorage.setItem("notities", veld.value);
        $("notities-status").textContent = "Opgeslagen";
      } catch {
        $("notities-status").textContent = "Opslaan lukte niet";
      }
    }, 500);
  });
}

function toonPloeg() {
  zetTabsKlaar();
  zetNotitiesKlaar();
  $("mijn-ploegnaam").textContent = ploegnaamVan(staat.ik.email, staat.profiel.ploegnaam) || "Mijn ploeg";
  const ploegen = [...new Set(staat.renners.map((r) => r.ploeg))].sort();
  for (const p of ploegen) $("filter-ploeg").append(maak("option", { tekst: p }));
  // Prijsfilter: van … tot … credits (standaard alle prijzen).
  const hoogste = Math.max(...staat.prijzen.values());
  for (const id of ["filter-prijs-van", "filter-prijs-tot"]) {
    $(id).replaceChildren(...Array.from({ length: hoogste }, (_, i) => maak("option", { value: i + 1, tekst: i + 1 })));
  }
  $("filter-prijs-van").value = 1;
  $("filter-prijs-tot").value = hoogste;
  for (const id of ["zoek", "filter-type", "filter-ploeg", "filter-betaalbaar", "filter-prijs-van", "filter-prijs-tot"]) {
    $(id).addEventListener("input", () => { staat.poolPagina = 0; tekenPool(); });
  }
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const veld = th.dataset.sort;
      staat.sorteer = { veld, af: staat.sorteer.veld === veld ? !staat.sorteer.af : veld === "prijs" || veld === "punten" };
      staat.poolPagina = 0;
      tekenPool();
    });
  });
  const blader = (stap) => {
    staat.poolPagina += stap;
    tekenPool();
    document.querySelector(".pool .tabel-wrap").scrollTop = 0;
  };
  $("pagina-vorige").onclick = () => blader(-1);
  $("pagina-volgende").onclick = () => blader(1);
  tekenAlles();
  naarTab("overzicht");
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
  if (m.modus === "transfers" && m.gepland) {
    const t = transfersVoorDoel(m);
    return `Transfers plannen voor periode ${m.doel}: ze gaan in op ${datumLang(m.deadline)}. ` +
      `Je kunt ze aanpassen tot het einde van de transferperiode (${datumLang(m.sluit)}). ` +
      `${t.uit.length} verkocht en ${t.in.length} gekocht, maximaal ${inst.max_transfers}. ` +
      "Verkochte renners rijden nog voor je tot het einde van deze periode.";
  }
  if (m.modus === "transfers") {
    const t = transfersVoorDoel(m);
    return `Transferperiode tot en met ${datumLang(m.sluit)}, voor periode ${m.doel}: ${t.uit.length} verkocht en ${t.in.length} gekocht, ` +
      `maximaal ${inst.max_transfers}. ` +
      "Verkochte renners rijden nog voor je tot het einde van deze periode.";
  }
  if (m.modus === "joker") {
    const j = jokerStand(m);
    return `Joker: wissel een renner buiten de transferperiode. De wissel geldt vanaf morgen; tot dan kun je hem ongedaan maken. ` +
      `Je hebt nog ${j.over} van ${inst.jokers} jokers. Verkoop een renner met −, kies dan een vervanger in de rennerspool.`;
  }
  if (m.volgende) {
    const gepland = transfersVan(staat.mijnSelecties).find((t) => t.periode === m.volgende.nr + 1 && !t.joker);
    return `Volgende transferperiode: ${datumLang(m.volgende.open)} tot en met ${datumLang(m.volgende.sluit)}, voor periode ${m.volgende.nr + 1}. ` +
      (gepland
        ? `Je hebt al ${gepland.uit.length} ${gepland.uit.length === 1 ? "verkoop" : "verkopen"} en ` +
          `${gepland.in.length} ${gepland.in.length === 1 ? "aankoop" : "aankopen"} gepland.`
        : "Je kunt je transfers al plannen.");
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

  // Voor het seizoen: een willekeurig voorstel om de lege plaatsen te vullen.
  const voorstel = $("voorstel");
  voorstel.hidden = m.modus !== "inschrijving";
  voorstel.disabled = staat.bezig || ploeg.length >= inst.ploeggrootte;
  voorstel.title = ploeg.length >= inst.ploeggrootte ? "Je ploeg is al compleet." : "Vult de lege plaatsen met willekeurige renners, binnen je budget.";
  voorstel.onclick = doeVoorstel;

  // Tips zolang je je ploeg voor het seizoen samenstelt.
  $("ploeg-tips").hidden = m.modus !== "inschrijving";
  if (m.modus === "inschrijving" && !$("ploeg-tips-lijst").children.length) {
    $("ploeg-tips-lijst").replaceChildren(...[
      "Meng de types met de knoppen boven de rennerspool: ronderenners scoren vooral in rittenkoersen, klassiekerrenners in eendagskoersen, sprinters in ritten.",
      "Al je renners tellen altijd mee, je hoeft per koers niets te kiezen. Een brede ploeg scoort dus het hele seizoen door.",
      "Weet je niet waar te beginnen? Klik op \"Vul mijn ploeg aan\" en wissel daarna renners naar je zin.",
    ].map((tekst) => maak("li", { tekst })));
  }

  // In de transferperiode tonen we ook wie eruit gaat, met een knop om dat ongedaan te maken.
  const vertrekkers = m.modus === "transfers"
    ? ploegInPeriode(staat.mijnSelecties, m.huidige).filter((s) => s.tot_periode === m.huidige && !s.tot_datum)
    : m.modus === "joker" || m.modus === "gesloten" ? jokerStand(m).uitVandaag : [];

  // Jokerknop: buiten een transferperiode kun je een joker inzetten (of stoppen met wisselen).
  const jokerKnop = $("joker-knop");
  const j = jokerStand(m);
  jokerKnop.hidden = !(m.kanJoker || m.modus === "joker") || !!m.gepland;
  jokerKnop.textContent = m.modus === "joker" ? "Klaar met wisselen" : `Joker inzetten (${j.over} van ${inst.jokers} over)`;
  jokerKnop.disabled = m.modus !== "joker" && j.over <= 0;
  jokerKnop.onclick = () => { staat.jokerModus = !staat.jokerModus; staat.planModus = false; tekenAlles(); };

  // Transfers plannen: buiten een transferperiode al transfers voor de volgende klaarzetten.
  const planKnop = $("plan-knop");
  planKnop.hidden = !(m.kanPlannen || m.gepland) || m.modus === "joker";
  planKnop.textContent = m.gepland ? "Klaar met plannen" : "Transfers plannen";
  planKnop.onclick = () => { staat.planModus = !staat.planModus; staat.jokerModus = false; tekenAlles(); };

  const lijst = $("ploeg-lijst");
  lijst.replaceChildren();
  // Ligt de ploeg vast (geen transferperiode), dan tonen we enkel je ploeg, breed en op punten gesorteerd.
  const vast = m.modus === "gesloten";
  const jokerNieuw = (sel) => sel.vanaf_datum === m.morgen;
  $("tab-ploeg").classList.toggle("vast", vast);
  const rijen = [...ploeg, ...vertrekkers].sort(vast
    ? (a, b) => (puntenVan.get(b.cq_riderid) || 0) - (puntenVan.get(a.cq_riderid) || 0)
    : (a, b) => staat.prijzen.get(b.cq_riderid) - staat.prijzen.get(a.cq_riderid));
  for (const sel of rijen) {
    const r = staat.rennerOpId.get(sel.cq_riderid);
    const vertrekt = vertrekkers.includes(sel);
    const nieuw = (m.modus === "transfers" && sel.vanaf_periode === m.doel) || jokerNieuw(sel);
    let knop;
    if (vertrekt) {
      knop = maak("button", {
        klasse: "knop-klein knop-plus", tekst: "↺",
        title: redenNiet(sel.cq_riderid, m.modus === "gesloten" ? { ...m, modus: "joker" } : m) || "Toch houden",
        disabled: staat.bezig || !!redenNiet(sel.cq_riderid, m.modus === "gesloten" ? { ...m, modus: "joker" } : m), onclick: () => houd(sel),
      });
    } else {
      knop = minKnop(sel, m);
    }
    const label = vertrekt
      ? (sel.tot_datum ? " · gaat eruit vanaf morgen (joker)" : ` · gaat eruit na periode ${m.huidige}`)
      : jokerNieuw(sel) ? " · nieuw vanaf morgen (joker)" : nieuw ? ` · nieuw vanaf periode ${m.doel}` : "";
    lijst.append(maak("li", { klasse: vertrekt ? "vertrekt" : nieuw ? "nieuw" : "" }, [
      maak("div", {}, [
        maak("div", { klasse: "renner-naam", tekst: r ? r.naam : `Renner ${sel.cq_riderid}` }),
        maak("div", {
          klasse: "renner-sub",
          // Ligt de ploeg vast, dan staan de punten groot en de prijs in de onderregel; anders omgekeerd.
          tekst: `${r ? `${r.land} · ${r.ploeg}` : "Niet meer in de rennerslijst"} · ${typeVan(sel.cq_riderid)} · ${
            vast ? `${staat.prijzen.get(sel.cq_riderid) ?? "?"} cr` : `${pt(puntenVan.get(sel.cq_riderid) || 0)} pt`}${label}`,
        }),
      ]),
      maak("span", { klasse: "prijs", tekst: vast ? `${pt(puntenVan.get(sel.cq_riderid) || 0)} pt` : `${staat.prijzen.get(sel.cq_riderid) ?? "?"} cr` }),
      m.modus === "gesloten" && !vertrekt && !jokerNieuw(sel) ? maak("span") : knop,
    ]));
  }
  if (!rijen.length) lijst.append(maak("li", { klasse: "leeg", tekst: "Nog geen renners gekozen. Kies ze in de rennerspool." }));

  // Geplande transfers in een eigen kader; hieronder enkel de transfers die al ingingen.
  const plan = tekenGeplandeTransfers(m);
  const blok = $("mijn-transfers");
  blok.replaceChildren();
  const eerder = transfersVan(staat.mijnSelecties).filter((t) => t.joker || !plan || t.periode !== plan.doel);
  blok.hidden = !eerder.length;
  if (eerder.length) {
    blok.append(maak("h3", { tekst: "Eerdere transfers" }), transferLijst(eerder));
  }
}

// De modus om transfers voor de volgende periode te bekijken of te wijzigen, of null als dat niet kan.
function planModusVoor(m) {
  if (m.modus === "transfers") return m;
  if (m.modus === "gesloten" && m.volgende) {
    return { ...m, modus: "transfers", gepland: true, doel: m.volgende.nr + 1, sluit: m.volgende.sluit, deadline: dagNa(m.volgende.sluit) };
  }
  return null;
}

// Kader "Geplande transfers": wie eruit gaat en wie erbij komt in de volgende periode,
// met een knop om elke transfer ongedaan te maken. Geeft de planmodus terug (of null).
function tekenGeplandeTransfers(m) {
  const kader = $("gepland");
  const pm = planModusVoor(m);
  const uit = pm ? staat.mijnSelecties.filter((s) => s.tot_periode === pm.huidige && !s.tot_datum) : [];
  const erin = pm ? staat.mijnSelecties.filter((s) => s.vanaf_periode === pm.doel && !s.vanaf_datum) : [];
  // Tonen tijdens het plannen of in de transferperiode, en anders zodra er iets gepland is.
  kader.hidden = !pm || (m.modus !== "transfers" && !uit.length && !erin.length);
  if (kader.hidden) return pm;

  const naam = (s) => staat.rennerOpId.get(s.cq_riderid)?.naam ?? `Renner ${s.cq_riderid}`;
  const prijs = (s) => staat.prijzen.get(s.cq_riderid) ?? 0;
  const saldo = uit.reduce((som, s) => som + prijs(s), 0) - erin.reduce((som, s) => som + prijs(s), 0);
  const kolom = (titel, klasse, lijst, knop) => maak("div", { klasse: `gepland-kolom ${klasse}` }, [
    maak("h4", { tekst: `${titel} (${lijst.length})` }),
    lijst.length
      ? maak("ul", {}, lijst.map((s) => maak("li", {}, [
        maak("span", { tekst: naam(s) }),
        maak("span", { klasse: "klein", tekst: `${prijs(s)} cr` }),
        knop(s),
      ])))
      : maak("p", { klasse: "klein", tekst: "Nog niemand." }),
  ]);
  const terugKnop = (s) => {
    const reden = redenNiet(s.cq_riderid, pm);
    return maak("button", {
      type: "button", klasse: "knop-klein knop-plus", tekst: "↺", title: reden || "Toch houden",
      disabled: staat.bezig || !!reden, onclick: () => houd(s),
    });
  };
  const schrapKnop = (s) => maak("button", {
    type: "button", klasse: "knop-klein knop-min", tekst: "×", title: "Aankoop schrappen",
    disabled: staat.bezig, onclick: () => verwijder(s, pm),
  });
  kader.replaceChildren(
    maak("div", { klasse: "gepland-kop" }, [
      maak("h3", { tekst: `Geplande transfers voor periode ${pm.doel}` }),
      maak("span", { klasse: "klein", tekst: `${Math.max(uit.length, erin.length)} van ${staat.inst.max_transfers}` }),
    ]),
    maak("p", { klasse: "klein", tekst: `Ze gaan in op ${datumLang(pm.deadline)}. Aanpassen kan tot en met ${datumLang(pm.sluit)}. ` +
      (saldo ? `Budget na deze transfers: ${saldo > 0 ? "+" : "−"}${Math.abs(saldo)} credits.` : "") }),
    maak("div", { klasse: "gepland-kolommen" }, [
      kolom("Eruit", "eruit", uit, terugKnop),
      kolom("Erin", "erin", erin, schrapKnop),
    ]),
    ...(!uit.length && !erin.length
      ? [maak("p", { klasse: "klein", tekst: "Verkoop een renner met − in je ploeg en kies een vervanger met + in de rennerspool." })] : []),
  );
  return pm;
}

// De knop om een renner uit je ploeg te halen (in je ploeg én in de rennerspool).
// Voor het seizoen of bij een nieuwe aankoop: schrappen. Anders: verkopen na de lopende periode.
function minKnop(sel, m) {
  if (m.modus === "joker" || (m.modus === "gesloten" && sel.vanaf_datum === m.morgen)) {
    const nieuwJoker = sel.vanaf_datum === m.morgen;
    // Niet meer renners verkopen dan je jokers hebt (wissels van vandaag tellen al mee).
    const j = jokerStand(m);
    const ruimte = staat.inst.jokers - (j.gebruikt - j.inMorgen.length);
    const magNiet = !nieuwJoker && (m.modus !== "joker" || j.uitVandaag.length >= ruimte);
    return maak("button", {
      klasse: "knop-klein knop-min", tekst: "−",
      title: nieuwJoker ? "Jokerwissel ongedaan maken" : "Verkopen met een joker (vanaf morgen)",
      disabled: staat.bezig || magNiet, onclick: () => verwijder(sel, m),
    });
  }
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
  const prijsVan = Number($("filter-prijs-van").value) || 0;
  const prijsTot = Number($("filter-prijs-tot").value) || Infinity;

  // Eerst de gewone filters; de typeknoppen tonen hoeveel renners daarvan per type overblijven.
  const gefilterd = staat.renners.filter((r) =>
    (!zoek || `${r.naam} ${r.land} ${r.ploeg}`.toLowerCase().includes(zoek)) &&
    (!type || r.ploegtype === type) &&
    (!ploegnaam || r.ploeg === ploegnaam) &&
    staat.prijzen.get(r.cq_riderid) >= prijsVan && staat.prijzen.get(r.cq_riderid) <= prijsTot &&
    (!betaalbaar || !redenNiet(r.cq_riderid, m)),
  );
  tekenTypeKnoppen(gefilterd);
  let rijen = gefilterd.filter((r) => !staat.typeFilter || typeVan(r.cq_riderid) === staat.typeFilter);
  const { veld, af } = staat.sorteer;
  const waarde = {
    naam: (r) => r.naam, land: (r) => r.land, ploeg: (r) => r.ploeg, type: (r) => typeVan(r.cq_riderid),
    punten: (r) => staat.scores.get(r.cq_riderid), prijs: (r) => staat.prijzen.get(r.cq_riderid),
  }[veld];
  rijen.sort((a, b) => {
    const x = waarde(a), y = waarde(b);
    const verschil = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
    return (af ? -verschil : verschil) || staat.scores.get(b.cq_riderid) - staat.scores.get(a.cq_riderid);
  });
  document.querySelectorAll("th[data-sort]").forEach((th) => th.classList.toggle("gesorteerd", th.dataset.sort === veld));

  // Per pagina een vast aantal renners, met knoppen Vorige en Volgende.
  const perPagina = 100;
  const paginas = Math.max(1, Math.ceil(rijen.length / perPagina));
  staat.poolPagina = Math.min(staat.poolPagina, paginas - 1);
  const vanaf = staat.poolPagina * perPagina;
  const tbody = $("pool-lijst");
  tbody.replaceChildren();
  for (const r of rijen.slice(vanaf, vanaf + perPagina)) {
    const reden = redenNiet(r.cq_riderid, m);
    tbody.append(maak("tr", { klasse: gekozen.has(r.cq_riderid) ? "gekozen" : "" }, [
      maak("td", {}, [maak("span", { klasse: "renner-naam", tekst: r.naam })]),
      maak("td", { tekst: r.land }),
      maak("td", { tekst: r.ploeg }),
      maak("td", {}, [maak("span", { klasse: `type type-${typeVan(r.cq_riderid).toLowerCase()}`, tekst: typeVan(r.cq_riderid) })]),
      maak("td", {
        klasse: "getal", tekst: Math.round(staat.scores.get(r.cq_riderid)),
        // Enkel de seizoenen die meetellen voor de prijs.
        title: (staat.inst.prijs_gewichten || [1]).map((g, i) => staat.inst.seizoen - 1 - i)
          .map((j) => `${j}: ${r.cq_punten_per_seizoen?.[j] ?? (j === staat.inst.seizoen - 1 ? r.cq_punten_vorig_seizoen : 0)}`).join(" · "),
      }),
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
  $("pool-info").textContent = rijen.length
    ? `Renners ${vanaf + 1} tot ${Math.min(vanaf + perPagina, rijen.length)} van ${rijen.length}.`
    : "Geen renners gevonden.";
  $("pagina-tekst").textContent = `Pagina ${staat.poolPagina + 1} van ${paginas}`;
  $("pagina-vorige").disabled = staat.poolPagina === 0;
  $("pagina-volgende").disabled = staat.poolPagina >= paginas - 1;
  $("paginas").hidden = paginas <= 1;
}

// Knoppen om op type renner te filteren, met het aantal renners per type.
function tekenTypeKnoppen(renners) {
  const aantal = new Map(TYPES.map((t) => [t, 0]));
  for (const r of renners) aantal.set(typeVan(r.cq_riderid), aantal.get(typeVan(r.cq_riderid)) + 1);
  const knop = (waarde, tekst, n) => maak("button", {
    type: "button",
    klasse: `type-knop${waarde ? ` type-${waarde.toLowerCase()}` : ""}${staat.typeFilter === waarde ? " actief" : ""}`,
    tekst: `${tekst} (${n})`,
    onclick: () => { staat.typeFilter = staat.typeFilter === waarde ? "" : waarde; staat.poolPagina = 0; tekenPool(); },
  });
  $("type-knoppen").replaceChildren(
    knop("", "Alle", renners.length),
    ...TYPES.map((t) => knop(t, t, aantal.get(t))),
  );
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
// Vult de lege plaatsen van de ploeg met willekeurige renners:
// - eerst 1 of 2 toppers (renners met een eigen topprijs), tenzij je er al zoveel hebt;
// - daarna telkens een renner van het type dat nu het minst in de ploeg zit, zodat alle
//   types gemengd worden, met een prijs rond wat gemiddeld nog per lege plaats over is
//   (zo gaat het budget zo goed als op).
// Elke renner moet de gewone controle doorstaan, zodat de ploeg altijd past.
async function doeVoorstel() {
  const m = modus();
  if (m.modus !== "inschrijving") return;
  const gekozen = maakVoorstel(doelPloeg(m).map((s) => s.cq_riderid));
  await bewaar(async () => {
    for (const id of gekozen) {
      melding(`Voorstel wordt opgeslagen: ${gekozen.indexOf(id) + 1} van ${gekozen.length} renners…`);
      staat.mijnSelecties.push(await selecties.create({ cq_riderid: id, vanaf_periode: m.doel, tot_periode: null }));
    }
  }, "Het voorstel opslaan lukte niet helemaal");
}

// Kiest renners om een ploeg met deze renners (`bestaand`, lijst van id's) aan te vullen.
// Geeft de id's van de gekozen renners.
function maakVoorstel(bestaand) {
  const { inst, prijzen } = staat;
  const proef = bestaand.map((id) => ({ cq_riderid: id }));
  const gekozen = [];
  const willekeurig = (lijst) => lijst[Math.floor(Math.random() * lijst.length)];
  const neem = (r) => { proef.push({ cq_riderid: r.cq_riderid }); gekozen.push(r.cq_riderid); };
  const mogelijk = () => staat.renners.filter((r) => !magToevoegen(r.cq_riderid, proef, prijzen, inst));

  const topprijs = Math.min(...inst.prijzen_top);
  const isTopper = (id) => prijzen.get(id) >= topprijs;
  const toppersNodig = 1 + Math.floor(Math.random() * 2) - proef.filter((s) => isTopper(s.cq_riderid)).length;
  for (let i = 0; i < toppersNodig && proef.length < inst.ploeggrootte; i++) {
    const toppers = mogelijk().filter((r) => isTopper(r.cq_riderid));
    if (toppers.length) neem(willekeurig(toppers));
  }

  while (proef.length < inst.ploeggrootte) {
    const kandidaten = mogelijk().filter((r) => !isTopper(r.cq_riderid));
    if (!kandidaten.length) break;
    const over = inst.budget - proef.reduce((som, s) => som + prijzen.get(s.cq_riderid), 0);
    const doel = over / (inst.ploeggrootte - proef.length);
    // Het type dat het minst voorkomt (bij gelijkstand willekeurig), als er een renner van bestaat.
    const telling = new Map(TYPES.map((t) => [t, 0]));
    for (const s of proef) telling.set(typeVan(s.cq_riderid), telling.get(typeVan(s.cq_riderid)) + 1);
    const types = TYPES.filter((t) => kandidaten.some((r) => typeVan(r.cq_riderid) === t))
      .sort((a, b) => telling.get(a) - telling.get(b) || Math.random() - 0.5);
    const vanType = kandidaten.filter((r) => typeVan(r.cq_riderid) === types[0]);
    const rond = vanType.filter((r) => Math.abs(prijzen.get(r.cq_riderid) - doel) <= 1.5);
    neem(willekeurig(rond.length ? rond : vanType));
  }
  return gekozen;
}

async function voegToe(riderid) {
  const m = modus();
  const reden = redenNiet(riderid, m);
  if (reden) return melding(reden, true);
  // Verkocht je deze renner net? Dan maken we de verkoop ongedaan in plaats van hem opnieuw te kopen.
  const verkocht = staat.mijnSelecties.find((s) => s.cq_riderid === riderid && (
    (m.modus === "transfers" && s.tot_periode === m.huidige && !s.tot_datum) || (m.modus === "joker" && s.tot_datum === m.vandaag)));
  if (verkocht) return houd(verkocht);
  await bewaar(async () => {
    // Een joker: de nieuwe renner telt vanaf morgen, nog in de lopende periode.
    const record = await selecties.create(m.modus === "joker"
      ? { cq_riderid: riderid, vanaf_periode: m.huidige, tot_periode: null, vanaf_datum: m.morgen }
      : { cq_riderid: riderid, vanaf_periode: m.doel, tot_periode: null });
    staat.mijnSelecties.push(record);
  }, "Toevoegen lukte niet");
}

// Een renner uit de ploeg halen: voor het seizoen of bij een nieuwe aankoop gewoon schrappen,
// anders verkopen na de lopende periode.
async function verwijder(selectie, m = modus()) {
  // Een jokerwissel van vandaag ongedaan maken, of met een joker verkopen.
  if (selectie.vanaf_datum && selectie.vanaf_datum === m.morgen) {
    return bewaar(async () => {
      await selecties.delete(selectie.id);
      staat.mijnSelecties = staat.mijnSelecties.filter((s) => s.id !== selectie.id);
    }, "Ongedaan maken lukte niet");
  }
  if (m.modus === "joker") {
    return bewaar(async () => vervang(await selecties.update(selectie.id, { tot_periode: m.huidige, tot_datum: m.vandaag })), "Verkopen lukte niet");
  }
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
  await bewaar(async () => vervang(await selecties.update(selectie.id, { tot_periode: null, tot_datum: null })), "Terugzetten lukte niet");
}

// Transfers als lijst per periode: "Periode 3 · Uit: … · In: …".
function transferLijst(transfers) {
  const naam = (id) => `${staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`} (${staat.prijzen.get(id) ?? "?"} cr)`;
  return maak("ul", { klasse: "transfers" }, transfers.map((t) => maak("li", {}, [
    maak("strong", {
      tekst: t.joker
        ? `Joker · vanaf ${new Date(t.joker).toLocaleDateString("nl-BE", { day: "numeric", month: "long" })} (periode ${t.periode})`
        : `Periode ${t.periode}`,
    }),
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
    await laadDeelnemers();
    tekenStand();
  } catch (fout) {
    melding(`De stand laden lukte niet: ${fout.message}`, true);
  }
}

// Haalt (altijd vers) de ploegen van iedereen en hun ploegnamen op, voor de stand en het overzicht.
async function laadDeelnemers() {
  const [alleSelecties, alleProfielen] = (await Promise.all([alleRecords(selecties, {}), alleRecords(profielen, {})]))
    .map((lijst) => lijst.filter((r) => geldig(r)));
  staat.alleSelecties = alleSelecties;
  staat.ploegnaamVan = new Map(alleProfielen.filter((p) => p.createdBy).map((p) => [p.createdBy.email, ploegnaamVan(p.createdBy.email, p.ploegnaam)]));
  staat.debutanten = new Set(alleProfielen.filter((p) => p.createdBy && p.debuutjaar === staat.inst.seizoen).map((p) => p.createdBy.email));
  staat.naamVan = new Map([...alleSelecties, ...alleProfielen].filter((r) => r.createdBy).map((r) => [r.createdBy.email, r.createdBy.name]));
  // Iedereen met een ploeg (profiel), ook wie nog geen renners koos.
  staat.deelnemers = [...new Set(alleProfielen.filter((p) => p.createdBy).map((p) => p.createdBy.email))];
}

function tekenStand() {
  const periodeNr = $("stand-keuze").value ? Number($("stand-keuze").value) : null;
  // Debutantenklassement: enkel wie dit seizoen voor het eerst meespeelt (plaatsen opnieuw geteld).
  const enkelDebutanten = $("stand-groep").value === "debutanten";
  const meetellend = enkelDebutanten
    ? staat.alleSelecties.filter((s) => staat.debutanten.has(s.createdBy?.email))
    : staat.alleSelecties;
  const deelnemers = enkelDebutanten ? staat.deelnemers.filter((e) => staat.debutanten.has(e)) : staat.deelnemers;
  // Groene trui: enkel eendagskoersen; bolletjestrui: enkel rittenkoersen.
  // De jokerbonus (na het seizoen) telt enkel in het algemeen klassement.
  const groep = $("stand-groep").value;
  const soort = { groen: "eendags", bolletjes: "meerdaags" }[groep] ?? null;
  const bonus = !soort && periodeNr == null ? jokerBonus(meetellend, staat.inst) : new Map();
  const rijen = berekenStand(meetellend, staat.resultaten, periodeNr, deelnemers, bonus, soort);
  const dragers = truiDragers(staat);
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
        maak("td", {}, [
          maak("span", { tekst: staat.ploegnaamVan.get(rij.email) || "(nog geen ploegnaam)" }),
          ...(dragers.get(rij.email) || []).map(truiIcoon),
        ]),
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
  return [
    zegesBlok(rij),
    maak("h4", { tekst: "Renners" }), detailLijst(rij, periodeNr),
    maak("h4", { tekst: "Transfers" }), transfersVanDeelnemer(rij.email, periodeNr),
  ];
}

// De overwinningen als inklapbaar blok (standaard dicht), zodat de renners meteen zichtbaar zijn.
function zegesBlok(rij) {
  const titel = maak("h4", { tekst: `Overwinningen (${rij.overwinningen})` });
  if (!rij.overwinningen) return maak("div", { klasse: "zeges-blok" }, [titel, overwinningenLijst(rij)]);
  return maak("details", { klasse: "zeges-blok" }, [maak("summary", {}, [titel]), overwinningenLijst(rij)]);
}

// De overwinningen van een ploeg (ritten, eendagskoersen, eindklassementen), recentste eerst.
// Enkel van renners die toen in de ploeg zaten, en binnen de gekozen periode.
function overwinningenLijst(rij) {
  const zeges = rij.renners.flatMap((r) => r.resultaten.filter((x) => x.overwinning).map((x) => ({ ...x, renner: r.cq_riderid })))
    .sort((a, b) => b.datum.localeCompare(a.datum));
  if (!zeges.length) return maak("p", { klasse: "klein", tekst: "Nog geen overwinningen." });
  return maak("ul", { klasse: "zeges" }, zeges.map((z) => maak("li", {}, [
    maak("span", { klasse: "klein zege-datum", tekst: new Date(z.datum).toLocaleDateString("nl-BE", { day: "numeric", month: "short" }) }),
    maak("span", { tekst: z.naam }),
    maak("strong", { tekst: staat.rennerOpId.get(z.renner)?.naam ?? `Renner ${z.renner}` }),
    maak("span", { klasse: "punten-renner", tekst: `${pt(z.punten)} pt` }),
  ])));
}

// Transfers van één deelnemer, voor één periode of (algemeen klassement) allemaal.
// Transfers voor een periode die nog niet begonnen is, zie je enkel bij je eigen ploeg.
function transfersVanDeelnemer(email, periodeNr) {
  const vandaag = vandaagISO();
  const gestart = new Set(staat.inst.periodes.filter((p) => p.start <= vandaag).map((p) => p.nr));
  const transfers = transfersVan(staat.alleSelecties.filter((s) => s.createdBy?.email === email))
    .filter((t) => (periodeNr == null || t.periode === periodeNr) &&
      // Andermans transfers zie je pas als ze gelden (een joker: vanaf zijn datum).
      (email === staat.ik.email || (t.joker ? t.joker <= vandaag : gestart.has(t.periode))));
  if (!transfers.length) {
    return maak("p", { klasse: "klein", tekst: periodeNr ? `Geen transfers bij de start van periode ${periodeNr}.` : "Nog geen transfers." });
  }
  return transferLijst(transfers);
}

// Alle renners van een ploeg (in de gekozen periode, of nu), met type, prijs en punten.
// Klik op een renner voor zijn resultaten. Renners die vroeger in de ploeg zaten en punten
// haalden, staan apart onderaan.
function detailLijst(rij, periodeNr) {
  const m = modus();
  const nr = periodeNr ?? m.huidige ?? m.doel ?? 1;
  const sel = staat.alleSelecties.filter((s) => s.createdBy?.email === rij.email);
  // Zonder gekozen periode: de ploeg van vandaag (met jokers); anders de ploeg van die periode.
  const nu = ploegInPeriode(sel, nr, periodeNr == null && m.huidige ? m.vandaag : null).map((s) => s.cq_riderid);
  const perRenner = new Map(rij.renners.map((r) => [r.cq_riderid, r]));
  const leeg = (id) => ({ cq_riderid: id, punten: 0, resultaten: [] });
  const opPunten = (a, b) => b.punten - a.punten || (staat.prijzen.get(b.cq_riderid) ?? 0) - (staat.prijzen.get(a.cq_riderid) ?? 0);
  const inPloeg = nu.map((id) => perRenner.get(id) || leeg(id)).sort(opPunten);
  const vroeger = rij.renners.filter((r) => !nu.includes(r.cq_riderid) && r.punten > 0).sort(opPunten);

  const rennerRij = (renner, weg) => {
    const r = staat.rennerOpId.get(renner.cq_riderid);
    const resultaten = [...renner.resultaten].sort((a, b) => b.datum.localeCompare(a.datum));
    return maak("li", { klasse: weg ? "weg" : "" }, [maak("details", {}, [
      maak("summary", {}, [
        maak("span", { klasse: "renner-naam", tekst: r ? r.naam : `Renner ${renner.cq_riderid}` }),
        maak("span", { klasse: `type type-${typeVan(renner.cq_riderid).toLowerCase()}`, tekst: typeVan(renner.cq_riderid) }),
        maak("span", { klasse: "klein", tekst: `${staat.prijzen.get(renner.cq_riderid) ?? "?"} cr` }),
        maak("span", { klasse: "punten-renner", tekst: `${pt(renner.punten)} pt` }),
      ]),
      resultaten.length
        ? maak("table", { klasse: "tabel renner-resultaten" }, [maak("tbody", {}, resultaten.map((k) => maak("tr", {}, [
          maak("td", { klasse: "klein", tekst: `${k.datum.slice(8, 10)}/${k.datum.slice(5, 7)}` }),
          maak("td", { tekst: k.naam }),
          maak("td", { klasse: "getal", tekst: `${k.positie}e` }),
          maak("td", { klasse: "getal", tekst: pt(k.punten) }),
        ])))])
        : maak("p", { klasse: "klein geen-resultaten", tekst: "Nog geen punten." }),
    ])]);
  };

  const blok = maak("div", { klasse: "ploeg-detail" }, [
    maak("ul", { klasse: "ploeg-renners" }, inPloeg.map((r) => rennerRij(r, false))),
  ]);
  if (!inPloeg.length) blok.append(maak("p", { klasse: "klein", tekst: "Nog geen renners gekozen." }));
  if (vroeger.length) {
    blok.append(
      maak("p", { klasse: "klein vroeger-kop", tekst: "Vroeger in de ploeg (punten voor deze ploeg):" }),
      maak("ul", { klasse: "ploeg-renners" }, vroeger.map((r) => rennerRij(r, true))),
    );
  }
  return blok;
}

start();
