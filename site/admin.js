// Adminpagina: import starten, correcties op uitslagen en de instellingen.
// Enkel admins krijgen deze tab te zien (zie zetTabsKlaar in app.js).
import { factorVoor, normaliseer, schaalVoor, uitslagMetCorrecties } from "./spel.js";

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
  tekenPloegnamen();
}

// ---------- Ploegnamen ----------

async function tekenPloegnamen() {
  const { maak, melding, profielen, alleRecords, ploegnaamVan, geldig } = ctx;
  const tbody = $("admin-ploegnamen");
  let alle;
  try {
    alle = (await alleRecords(profielen, {})).filter((p) => p.createdBy && geldig(p));
  } catch (fout) {
    return melding(`De ploegen laden lukte niet: ${fout.message}`, true);
  }
  alle.sort((a, b) => (a.createdBy.name || a.createdBy.email).localeCompare(b.createdBy.name || b.createdBy.email));
  tbody.replaceChildren(...alle.map((p) => {
    const email = p.createdBy.email;
    const veld = maak("input", { type: "text", value: ploegnaamVan(email, p.ploegnaam) || "", maxLength: 40 });
    const knop = maak("button", { klasse: "knop knop-klein-tekst", tekst: "Opslaan", onclick: () => bewaarPloegnaam(email, veld, knop, alle) });
    const weg = maak("button", {
      klasse: "knop knop-klein-tekst knop-gevaar", tekst: "Verwijderen",
      onclick: () => verwijderPloeg(email, p.createdBy.name || email, ploegnaamVan(email, p.ploegnaam), weg),
    });
    return maak("tr", {}, [
      maak("td", { tekst: p.createdBy.name || email }),
      maak("td", {}, [veld]),
      maak("td", { klasse: "knoppen-cel" }, [knop, weg]),
    ]);
  }));
  if (!alle.length) tbody.append(maak("tr", {}, [maak("td", { colSpan: 3, tekst: "Nog geen deelnemers." })]));
}

// Een ploeg verwijderen: we bewaren enkel dat een admin ze verwijderde. Alles wat de
// deelnemer daarvoor maakte, telt vanaf dan niet meer (zie geldig in app.js).
async function verwijderPloeg(email, wie, ploegnaam, knop) {
  const { staat, melding, verwijderingen } = ctx;
  if (!confirm(`De ploeg "${ploegnaam}" van ${wie} verwijderen? Alle renners, transfers en punten van die ploeg verdwijnen. ${wie} kan daarna opnieuw beginnen.`)) return;
  knop.disabled = true;
  try {
    const record = await verwijderingen.create({ email });
    staat.alleVerwijderingen = [...staat.alleVerwijderingen, record];
    if (email === staat.ik.email) return location.reload();
    ctx.herbereken();
    ctx.tekenAlles();
    tekenPloegnamen();
    melding(`De ploeg "${ploegnaam}" is verwijderd.`);
  } catch (fout) {
    melding(`Verwijderen lukte niet: ${fout.message}`, true);
    knop.disabled = false;
  }
}

async function bewaarPloegnaam(email, veld, knop, alle) {
  const { staat, melding, ploegnamen, ploegnaamVan } = ctx;
  const naam = veld.value.trim().replace(/\s+/g, " ");
  if (!naam) return melding("Een ploegnaam mag niet leeg zijn.", true);
  const bezet = alle.filter((p) => p.createdBy.email !== email)
    .some((p) => (ploegnaamVan(p.createdBy.email, p.ploegnaam) || "").toLowerCase() === naam.toLowerCase());
  if (bezet) return melding(`De naam "${naam}" is al gekozen door een andere ploeg.`, true);
  knop.disabled = true;
  try {
    // Wijzigde je deze ploegnaam al eerder? Dan passen we die wijziging aan.
    const bestaand = staat.alleNaamwijzigingen.find((w) => w.mine && w.email === email);
    const record = bestaand
      ? await ploegnamen.update(bestaand.id, { ploegnaam: naam })
      : await ploegnamen.create({ email, ploegnaam: naam });
    staat.alleNaamwijzigingen = [...staat.alleNaamwijzigingen.filter((w) => w.id !== record.id), record];
    ctx.herbereken();
    if (email === staat.ik.email) $("mijn-ploegnaam").textContent = naam;
    melding(`Ploegnaam gewijzigd in "${naam}".`);
  } catch (fout) {
    melding(`Opslaan lukte niet: ${fout.message}`, true);
  } finally {
    knop.disabled = false;
  }
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
  ["type_drempel_punten", "Type renner: minimum punten vorig seizoen (anders Knecht)", "getal"],
  ["type_marge", "Type renner: marge voor een duidelijk type (anders Allrounder)", "getal"],
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
  ["koersen_vorig_url", "Adres uitslagen vorig seizoen ({vorig} = jaartal)", "tekst"],
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

function transferRij(tp = { open: "", sluit: "" }) {
  const { maak } = ctx;
  const rij = maak("div", { klasse: "periode-rij transfer-rij" }, [
    maak("strong", { klasse: "tp-nr" }),
    maak("input", { type: "date", klasse: "tp-open", value: tp.open }),
    maak("span", { tekst: "tot en met" }),
    maak("input", { type: "date", klasse: "tp-sluit", value: tp.sluit }),
    maak("button", {
      type: "button", klasse: "knop-klein knop-min", tekst: "−", title: "Transferperiode schrappen",
      onclick: () => { rij.remove(); nummer(); },
    }),
  ]);
  return rij;
}

// Nummert de transferperiodes opnieuw na toevoegen of schrappen.
function nummer() {
  document.querySelectorAll("#admin-instellingen .transfer-rij .tp-nr").forEach((el, i) => {
    el.textContent = `Transferperiode ${i + 1}`;
  });
}

function tekenInstellingen() {
  const { staat, maak } = ctx;
  const inst = staat.inst;
  const form = $("admin-instellingen");
  const velden = VELDEN.map(([pad, label, soort]) => maak("label", { klasse: soort === "getal" ? "" : "breed" }, [
    label,
    maak("input", { name: pad, value: alsTekst(lees(inst, pad), soort), type: "text" }),
  ]));
  const rijen = maak("div", { klasse: "transfer-rijen" }, inst.transferperiodes.map((tp) => transferRij(tp)));
  const kalender = maak("fieldset", { klasse: "breed" }, [
    maak("legend", { tekst: "Seizoen en transferperiodes" }),
    maak("div", { klasse: "periode-rij" }, [
      maak("strong", { tekst: "Seizoen" }),
      maak("input", { type: "date", name: "seizoen_start", value: inst.seizoen_start }),
      maak("span", { tekst: "tot en met" }),
      maak("input", { type: "date", name: "seizoen_einde", value: inst.seizoen_einde }),
    ]),
    maak("p", { klasse: "klein", tekst: "Ploegen kiezen kan tot de seizoensstart. Elke transferperiode sluit een periode af: de volgende periode begint de dag na het einde van de transferperiode." }),
    rijen,
    maak("button", {
      type: "button", klasse: "knop knop-klein-tekst", tekst: "+ Transferperiode",
      onclick: () => { rijen.append(transferRij()); nummer(); },
    }),
  ]);
  form.replaceChildren(...velden, kalender, maak("button", { type: "submit", klasse: "knop", tekst: "Instellingen opslaan" }));
  nummer();
  form.onsubmit = bewaarInstellingen;
}

async function bewaarInstellingen(e) {
  e.preventDefault();
  const { staat, melding } = ctx;
  const data = new FormData(e.target);
  const nieuw = structuredClone(staat.inst);
  try {
    for (const [pad, label, soort] of VELDEN) zet(nieuw, pad, uitTekst(data.get(pad), soort, label));
    nieuw.seizoen_start = data.get("seizoen_start");
    nieuw.seizoen_einde = data.get("seizoen_einde");
    if (!nieuw.seizoen_start || !nieuw.seizoen_einde || nieuw.seizoen_start >= nieuw.seizoen_einde) {
      throw new Error("Het seizoen moet een begin- en einddatum hebben, met het einde na het begin.");
    }
    const vensters = [...e.target.querySelectorAll(".transfer-rij")].map((rij) => ({
      open: rij.querySelector(".tp-open").value, sluit: rij.querySelector(".tp-sluit").value,
    }));
    // Elke transferperiode ligt binnen het seizoen, na de vorige, en met het einde na het begin.
    let vorigeSluit = null;
    [...vensters].sort((a, b) => a.open.localeCompare(b.open)).forEach((tp, i) => {
      const naam = `Transferperiode ${i + 1}`;
      if (!tp.open || !tp.sluit) throw new Error(`${naam}: vul een begin- en einddatum in.`);
      if (tp.open > tp.sluit) throw new Error(`${naam}: het einde ligt voor het begin.`);
      if (tp.open < nieuw.seizoen_start) throw new Error(`${naam} begint voor de seizoensstart.`);
      if (tp.sluit >= nieuw.seizoen_einde) throw new Error(`${naam} eindigt niet voor het seizoenseinde.`);
      if (vorigeSluit && tp.open <= vorigeSluit) throw new Error(`${naam} begint voor transferperiode ${i} gedaan is.`);
      vorigeSluit = tp.sluit;
    });
    nieuw.transferperiodes = vensters;
    delete nieuw.periodes; // die worden berekend, niet bewaard
    if (!nieuw.admins.includes(staat.ik.email) &&
        !confirm("Je staat niet meer bij de admins. Daarna zie je deze pagina niet meer. Doorgaan?")) return;
  } catch (fout) {
    return melding(fout.message, true);
  }
  const knop = e.submitter;
  knop.disabled = true;
  try {
    await window.storage.set("instellingen", JSON.stringify(nieuw), true);
    staat.inst = normaliseer(nieuw);
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
