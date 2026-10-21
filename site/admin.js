// Adminpagina: import starten, correcties op uitslagen en de instellingen.
// Enkel admins krijgen deze tab te zien (zie zetTabsKlaar in app.js).
import { factorVoor, schaalVoor, uitslagMetCorrecties } from "./spel.js";

const $ = (id) => document.getElementById(id);
let ctx = null;
let klaar = false;

export function toonAdmin(context) {
  ctx = context;
  toonImport();
  if (!klaar) {
    zetCorrectiesKlaar();
    klaar = true;
  }
  tekenKoerskeuze();
  tekenInstellingen();
}

// ---------- Import ----------

function toonImport() {
  const { staat, datumTijd } = ctx;
  const k = staat.koersen;
  $("admin-import").textContent = k.laatste_import
    ? `Laatste nieuwe uitslagen: ${datumTijd(k.laatste_import)} (${k.aantal} uitslagen van ${k.seizoen}).`
    : "Nog geen import gebeurd.";
  $("admin-import-knop").href = staat.inst.workflow_url;
}

// ---------- Correcties ----------

function rennerLabel(r) {
  return `${r.naam} (${r.ploeg})`;
}

function zetCorrectiesKlaar() {
  const { staat, maak } = ctx;
  const lijst = $("renners-lijst");
  for (const r of staat.renners) lijst.append(maak("option", { value: rennerLabel(r) }));
  $("admin-koers-zoek").addEventListener("input", tekenKoerskeuze);
  $("admin-koers").addEventListener("input", tekenUitslag);
  $("admin-correctie").addEventListener("submit", bewaarCorrectie);
}

function tekenKoerskeuze() {
  const { staat, maak } = ctx;
  const zoek = $("admin-koers-zoek").value.trim().toLowerCase();
  const select = $("admin-koers");
  const gekozen = select.value;
  const koersen = [...staat.koersen.koersen]
    .filter((k) => !zoek || k.naam.toLowerCase().includes(zoek))
    .sort((a, b) => b.datum.localeCompare(a.datum) || b.cq_raceid - a.cq_raceid);
  select.replaceChildren(...koersen.map((k) => maak("option", {
    value: k.cq_raceid,
    tekst: `${k.datum} · ${k.naam}${k.geannuleerd ? " (geschrapt)" : ""}${staat.correcties.some((c) => c.cq_raceid === k.cq_raceid) ? " · gecorrigeerd" : ""}`,
  })));
  if (koersen.some((k) => String(k.cq_raceid) === gekozen)) select.value = gekozen;
  tekenUitslag();
}

function gekozenKoers() {
  const id = Number($("admin-koers").value);
  return ctx.staat.koersen.koersen.find((k) => k.cq_raceid === id) || null;
}

function tekenUitslag() {
  const { staat, maak, pt } = ctx;
  const vak = $("admin-uitslag");
  const koers = gekozenKoers();
  $("admin-correctie").hidden = !koers;
  if (!koers) {
    vak.replaceChildren(maak("p", { klasse: "klein", tekst: "Geen koers gevonden." }));
    return;
  }
  const schaal = schaalVoor(koers, staat.inst);
  const factor = factorVoor(koers, staat.inst);
  const naam = (id) => (id == null ? "–" : staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`);
  const auto = new Map(koers.uitslag.map((u) => [u.positie, u.cq_riderid]));
  const na = new Map(uitslagMetCorrecties(koers, staat.correcties).map((u) => [u.positie, u.cq_riderid]));
  $("correctie-positie").max = schaal.length;

  const rijen = schaal.map((basis, i) => {
    const positie = i + 1;
    const anders = auto.get(positie) !== na.get(positie);
    return maak("tr", { klasse: anders ? "gecorrigeerd" : "" }, [
      maak("td", { klasse: "getal", tekst: positie }),
      maak("td", { tekst: naam(auto.get(positie)) }),
      maak("td", { tekst: naam(na.get(positie)) }),
      maak("td", { klasse: "getal", tekst: pt(basis * factor) }),
    ]);
  });
  const tabel = maak("table", { klasse: "tabel" }, [
    maak("thead", {}, [maak("tr", {}, [
      maak("th", { klasse: "getal", tekst: "Plaats" }), maak("th", { tekst: "Automatisch (CQ)" }),
      maak("th", { tekst: "Telt voor het spel" }), maak("th", { klasse: "getal", tekst: "Punten" }),
    ])]),
    maak("tbody", {}, rijen),
  ]);

  // De correcties op deze koers, met een knop om ze te schrappen.
  const eigen = staat.correcties.filter((c) => c.cq_raceid === koers.cq_raceid).sort((a, b) => a.positie - b.positie);
  const lijst = maak("ul", { klasse: "correcties" }, eigen.map((c) => maak("li", {}, [
    maak("span", { tekst: `Plaats ${c.positie}: ${c.cq_riderid == null ? "leeg" : naam(c.cq_riderid)} · door ${c.createdBy?.name ?? "iemand"}` }),
    c.mine
      ? maak("button", { klasse: "knop-klein knop-min", tekst: "−", title: "Correctie schrappen", onclick: () => schrapCorrectie(c) })
      : maak("span", { klasse: "klein", tekst: "enkel de maker kan schrappen" }),
  ])));
  vak.replaceChildren(
    maak("p", { klasse: "klein", tekst: `${koers.type} · ${koers.klasse}${koers.is_grote_ronde ? " · grote ronde" : ""} · factor ${pt(factor)}` }),
    maak("div", { klasse: "tabel-wrap kort" }, [tabel]),
    ...(eigen.length ? [maak("h3", { tekst: "Correcties op deze koers" }), lijst] : []),
  );
}

async function bewaarCorrectie(e) {
  e.preventDefault();
  const { staat, melding, correcties } = ctx;
  const koers = gekozenKoers();
  const positie = Number($("correctie-positie").value);
  const tekst = $("correctie-renner").value.trim();
  let riderid = null;
  if (tekst) {
    const renner = staat.renners.find((r) => rennerLabel(r) === tekst) ||
      staat.renners.find((r) => r.naam.toLowerCase() === tekst.toLowerCase());
    if (!renner) return melding(`Renner "${tekst}" niet gevonden. Kies een naam uit de lijst.`, true);
    riderid = renner.cq_riderid;
  }
  const knop = e.submitter;
  knop.disabled = true;
  try {
    // Had je zelf al een correctie op deze plaats? Dan passen we die aan.
    const bestaand = staat.alleCorrecties.find((c) => c.mine && c.cq_raceid === koers.cq_raceid && c.positie === positie);
    const record = bestaand
      ? await correcties.update(bestaand.id, { cq_riderid: riderid })
      : await correcties.create({ cq_raceid: koers.cq_raceid, positie, cq_riderid: riderid });
    staat.alleCorrecties = [...staat.alleCorrecties.filter((c) => c.id !== record.id), record];
    naWijziging();
    $("correctie-renner").value = "";
    melding(`Correctie opgeslagen: plaats ${positie} in ${koers.naam}.`);
  } catch (fout) {
    melding(`Opslaan lukte niet: ${fout.message}`, true);
  } finally {
    knop.disabled = false;
  }
}

async function schrapCorrectie(c) {
  const { staat, melding, correcties } = ctx;
  try {
    await correcties.delete(c.id);
    staat.alleCorrecties = staat.alleCorrecties.filter((x) => x.id !== c.id);
    naWijziging();
    melding("Correctie geschrapt.");
  } catch (fout) {
    melding(`Schrappen lukte niet: ${fout.message}`, true);
  }
}

function naWijziging() {
  ctx.herbereken();
  ctx.tekenAlles();
  tekenKoerskeuze();
}

// ---------- Instellingen ----------

// Elk veld: [sleutel in de instellingen, label, soort].
const VELDEN = [
  ["seizoen", "Seizoen", "getal"],
  ["budget", "Budget (credits)", "getal"],
  ["ploeggrootte", "Renners per ploeg", "getal"],
  ["max_transfers", "Transfers per periode", "getal"],
  ["klassefactoren.grote_ronde", "Factor grote ronde", "getal"],
  ["klassefactoren.WT", "Factor WorldTour", "getal"],
  ["klassefactoren.PS", "Factor ProSeries", "getal"],
  ["prijzen_top", "Prijzen van de top (nr 1, nr 2, …)", "lijst"],
  ["prijsschijven", "Prijsschijven (punten:prijs)", "schijven"],
  ["puntenschaal.eindklassement_grote_ronde", "Punten eindklassement grote ronde", "lijst"],
  ["puntenschaal.eendags_en_eindklassement", "Punten eendagskoers en eindklassement", "lijst"],
  ["puntenschaal.rit", "Punten rit", "lijst"],
  ["puntenschaal.trui", "Punten eindstand truien", "lijst"],
  ["admins", "Admins (e-mailadressen)", "emails"],
  ["renners_url", "Adres renners.json", "tekst"],
  ["koersen_url", "Adres koersen.json", "tekst"],
  ["kalender_url", "Adres kalender.json", "tekst"],
  ["workflow_url", "Adres van de GitHub-workflow", "tekst"],
];

const lees = (obj, pad) => pad.split(".").reduce((o, k) => o?.[k], obj);
function zet(obj, pad, waarde) {
  const delen = pad.split(".");
  const laatste = delen.pop();
  delen.reduce((o, k) => (o[k] ??= {}), obj)[laatste] = waarde;
}

function alsTekst(waarde, soort) {
  if (soort === "lijst" || soort === "emails") return waarde.join(", ");
  if (soort === "schijven") return waarde.map((s) => `${s.vanaf_punten}:${s.prijs}`).join(", ");
  return String(waarde);
}

// Zet een ingevuld veld om; gooit een fout met uitleg als het niet klopt.
function uitTekst(tekst, soort, label) {
  const stukken = tekst.split(",").map((s) => s.trim()).filter(Boolean);
  const getal = (s) => {
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: "${s}" is geen geldig getal.`);
    return n;
  };
  if (soort === "getal") return getal(tekst.trim());
  if (soort === "lijst") {
    if (!stukken.length) throw new Error(`${label}: vul minstens één getal in.`);
    return stukken.map(getal);
  }
  if (soort === "schijven") {
    return stukken.map((s) => {
      const [punten, prijs] = s.split(":");
      if (prijs === undefined) throw new Error(`${label}: "${s}" moet de vorm punten:prijs hebben.`);
      return { vanaf_punten: getal(punten), prijs: getal(prijs) };
    }).sort((a, b) => b.vanaf_punten - a.vanaf_punten);
  }
  if (soort === "emails") {
    for (const s of stukken) if (!/^[^@\s]+@[^@\s]+$/.test(s)) throw new Error(`${label}: "${s}" is geen e-mailadres.`);
    return stukken.map((s) => s.toLowerCase());
  }
  if (!tekst.trim()) throw new Error(`${label} mag niet leeg zijn.`);
  return tekst.trim();
}

function tekenInstellingen() {
  const { staat, maak } = ctx;
  const inst = staat.inst;
  const form = $("admin-instellingen");
  const velden = VELDEN.map(([pad, label, soort]) => maak("label", { klasse: soort === "getal" ? "" : "breed" }, [
    label,
    maak("input", { name: pad, value: alsTekst(lees(inst, pad), soort), type: "text" }),
  ]));
  const periodes = maak("fieldset", { klasse: "breed" }, [
    maak("legend", { tekst: "Periodes (een koers telt in de periode waarin zijn datum valt)" }),
    ...[...inst.periodes].sort((a, b) => a.nr - b.nr).map((p) => maak("div", { klasse: "periode-rij" }, [
      maak("strong", { tekst: `Periode ${p.nr}` }),
      maak("input", { type: "date", name: `periode-${p.nr}-start`, value: p.start }),
      maak("span", { tekst: "tot en met" }),
      maak("input", { type: "date", name: `periode-${p.nr}-eind`, value: p.eind }),
    ])),
  ]);
  form.replaceChildren(...velden, periodes, maak("button", { type: "submit", klasse: "knop", tekst: "Instellingen opslaan" }));
  form.onsubmit = bewaarInstellingen;
}

async function bewaarInstellingen(e) {
  e.preventDefault();
  const { staat, melding } = ctx;
  const data = new FormData(e.target);
  const nieuw = structuredClone(staat.inst);
  try {
    for (const [pad, label, soort] of VELDEN) zet(nieuw, pad, uitTekst(data.get(pad), soort, label));
    nieuw.periodes = nieuw.periodes.map((p) => ({ ...p, start: data.get(`periode-${p.nr}-start`), eind: data.get(`periode-${p.nr}-eind`) }));
    const volgorde = [...nieuw.periodes].sort((a, b) => a.nr - b.nr);
    volgorde.forEach((p, i) => {
      if (!p.start || !p.eind || p.start > p.eind) throw new Error(`Periode ${p.nr}: het einde ligt voor het begin.`);
      if (i && p.start <= volgorde[i - 1].eind) throw new Error(`Periode ${p.nr} begint voor periode ${volgorde[i - 1].nr} gedaan is.`);
    });
    if (!nieuw.admins.includes(staat.ik.email) &&
        !confirm("Je staat niet meer bij de admins. Daarna zie je deze pagina niet meer. Doorgaan?")) return;
  } catch (fout) {
    return melding(fout.message, true);
  }
  const knop = e.submitter;
  knop.disabled = true;
  try {
    await window.storage.set("instellingen", JSON.stringify(nieuw), true);
    staat.inst = nieuw;
    ctx.herbereken();
    ctx.tekenAlles();
    toonAdmin(ctx);
    melding("Instellingen opgeslagen. Ze gelden meteen voor iedereen.");
  } catch (fout) {
    melding(`Opslaan lukte niet: ${fout.message}`, true);
  } finally {
    knop.disabled = false;
  }
}
