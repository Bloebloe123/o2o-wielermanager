import { berekenPrijzen, inschrijvingOpen, magToevoegen, ploegInPeriode } from "./spel.js";

const $ = (id) => document.getElementById(id);
const profielen = window.vibers.db.collection("profielen");
const selecties = window.vibers.db.collection("selecties");

const staat = {
  ik: null,
  inst: null,
  renners: [],
  rennerOpId: new Map(),
  prijzen: new Map(),
  koersen: null,
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

function datumTijd(iso) {
  return new Date(iso).toLocaleString("nl-BE", {
    timeZone: "Europe/Brussels", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

// ---------- Laden ----------

// De gedeelde instellingen. Bestaan ze nog niet, dan gebruiken we de standaardwaarden;
// een admin schrijft die meteen weg zodat iedereen dezelfde instellingen ziet.
async function laadInstellingen() {
  const rij = await window.storage.get("instellingen", true);
  if (rij) return JSON.parse(rij.value);
  const standaard = await (await fetch("./standaard-instellingen.json")).json();
  if (standaard.admins.includes(staat.ik.email)) {
    await window.storage.set("instellingen", JSON.stringify(standaard), true);
  }
  return standaard;
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
    const [renners, koersen, mijnProfielen, mijn] = await Promise.all([
      haalJson(staat.inst.renners_url),
      haalJson(staat.inst.koersen_url),
      profielen.find({ mine: true, limit: 1 }),
      alleRecords(selecties, { mine: true }),
    ]);
    staat.renners = renners.renners;
    staat.rennerOpId = new Map(staat.renners.map((r) => [r.cq_riderid, r]));
    staat.prijzen = berekenPrijzen(staat.renners, staat.inst);
    staat.koersen = koersen;
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
    knop.disabled = true;
    try {
      staat.profiel = await profielen.create({
        debuutjaar: Number(select.value),
        categorie: new FormData(e.target).get("categorie"),
      });
      $("profiel").hidden = true;
      toonPloeg();
    } catch (fout) {
      melding(`Opslaan lukte niet: ${fout.message}`, true);
      knop.disabled = false;
    }
  };
}

// ---------- Ploeg ----------

// De ploeg zoals ze nu is: de selecties die geldig zijn in periode 1.
// (Transfers in latere periodes komen in een volgende fase.)
function huidigePloeg() {
  return ploegInPeriode(staat.mijnSelecties, 1);
}

function toonPloeg() {
  $("tab-ploeg").hidden = false;
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

function tekenMijnPloeg() {
  const { inst } = staat;
  const ploeg = huidigePloeg();
  const uit = besteed(ploeg);
  const open = inschrijvingOpen(inst);
  const eerste = [...inst.periodes].sort((a, b) => a.nr - b.nr)[0];

  $("budget-tekst").textContent = `${uit} / ${inst.budget} credits`;
  $("budget-balk").style.width = `${Math.min(100, (uit / inst.budget) * 100)}%`;
  $("aantal-tekst").textContent = `${ploeg.length} / ${inst.ploeggrootte}`;
  $("aantal-balk").style.width = `${Math.min(100, (ploeg.length / inst.ploeggrootte) * 100)}%`;

  const datum = new Date(eerste.start).toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" });
  if (!open) {
    $("ploeg-status").textContent = `Je ploeg ligt vast sinds ${datum}.`;
  } else if (ploeg.length < inst.ploeggrootte) {
    $("ploeg-status").textContent = `Kies ${inst.ploeggrootte - ploeg.length} renners meer. Je kunt je ploeg vrij aanpassen tot ${datum}.`;
  } else {
    $("ploeg-status").textContent = `Je ploeg is compleet. Je kunt ze nog aanpassen tot ${datum}.`;
  }

  const lijst = $("ploeg-lijst");
  lijst.replaceChildren();
  const gesorteerd = [...ploeg].sort((a, b) => staat.prijzen.get(b.cq_riderid) - staat.prijzen.get(a.cq_riderid));
  for (const sel of gesorteerd) {
    const r = staat.rennerOpId.get(sel.cq_riderid);
    lijst.append(maak("li", {}, [
      maak("div", {}, [
        maak("div", { klasse: "renner-naam", tekst: r ? r.naam : `Renner ${sel.cq_riderid}` }),
        maak("div", { klasse: "renner-sub", tekst: r ? `${r.land} · ${r.ploeg}` : "Niet meer in de rennerslijst" }),
      ]),
      maak("span", { klasse: "prijs", tekst: `${staat.prijzen.get(sel.cq_riderid) ?? "?"} cr` }),
      maak("button", {
        klasse: "knop-klein knop-min", tekst: "−", title: "Uit je ploeg halen",
        disabled: !open || staat.bezig, onclick: () => verwijder(sel),
      }),
    ]));
  }
  if (!ploeg.length) lijst.append(maak("li", { klasse: "leeg", tekst: "Nog geen renners gekozen. Kies ze in de rennerspool." }));
}

function tekenPool() {
  const { inst } = staat;
  const ploeg = huidigePloeg();
  const gekozen = new Set(ploeg.map((s) => s.cq_riderid));
  const open = inschrijvingOpen(inst);
  const zoek = $("zoek").value.trim().toLowerCase();
  const type = $("filter-type").value;
  const ploegnaam = $("filter-ploeg").value;
  const betaalbaar = $("filter-betaalbaar").checked;

  let rijen = staat.renners.filter((r) =>
    (!zoek || `${r.naam} ${r.land} ${r.ploeg}`.toLowerCase().includes(zoek)) &&
    (!type || r.ploegtype === type) &&
    (!ploegnaam || r.ploeg === ploegnaam) &&
    (!betaalbaar || !magToevoegen(r.cq_riderid, ploeg, staat.prijzen, inst)),
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
    const reden = magToevoegen(r.cq_riderid, ploeg, staat.prijzen, inst);
    tbody.append(maak("tr", { klasse: gekozen.has(r.cq_riderid) ? "gekozen" : "" }, [
      maak("td", {}, [maak("span", { klasse: "renner-naam", tekst: r.naam })]),
      maak("td", { tekst: r.land }),
      maak("td", { tekst: r.ploeg }),
      maak("td", { klasse: "getal", tekst: r.cq_punten_vorig_seizoen }),
      maak("td", { klasse: "getal prijs", tekst: staat.prijzen.get(r.cq_riderid) }),
      maak("td", {}, [maak("button", {
        klasse: "knop-klein knop-plus", tekst: gekozen.has(r.cq_riderid) ? "✓" : "+",
        title: !open ? "De ploegen liggen vast" : reden || "In je ploeg zetten",
        disabled: !open || !!reden || staat.bezig, onclick: () => voegToe(r.cq_riderid),
      })]),
    ]));
  }
  $("pool-info").textContent = rijen.length > maxRijen
    ? `${maxRijen} van ${rijen.length} renners getoond. Zoek of filter om de rest te zien.`
    : `${rijen.length} renners.`;
}

async function voegToe(riderid) {
  const reden = magToevoegen(riderid, huidigePloeg(), staat.prijzen, staat.inst);
  if (reden || !inschrijvingOpen(staat.inst)) return melding(reden || "De ploegen liggen vast.", true);
  staat.bezig = true;
  tekenAlles();
  try {
    const record = await selecties.create({ cq_riderid: riderid, vanaf_periode: 1, tot_periode: null });
    staat.mijnSelecties.push(record);
    melding("");
  } catch (fout) {
    melding(`Toevoegen lukte niet: ${fout.message}`, true);
  } finally {
    staat.bezig = false;
    tekenAlles();
  }
}

async function verwijder(selectie) {
  if (!inschrijvingOpen(staat.inst)) return;
  staat.bezig = true;
  tekenAlles();
  try {
    await selecties.delete(selectie.id);
    staat.mijnSelecties = staat.mijnSelecties.filter((s) => s.id !== selectie.id);
    melding("");
  } catch (fout) {
    melding(`Verwijderen lukte niet: ${fout.message}`, true);
  } finally {
    staat.bezig = false;
    tekenAlles();
  }
}

start();
