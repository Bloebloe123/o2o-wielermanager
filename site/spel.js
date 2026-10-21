// Spelregels: pure rekenfuncties zonder schermcode.
// Alle getallen komen uit de instellingen; hier staat geen enkel spelgetal vast.

// Geeft een Map cq_riderid -> prijs (credits).
// De beste renners (volgens CQ-punten vorig seizoen) krijgen een unieke prijs uit
// `prijzen_top`; de rest valt in de eerste prijsschijf waarvan ze de grens halen.
export function berekenPrijzen(renners, inst) {
  const volgorde = [...renners].sort(
    (a, b) => b.cq_punten_vorig_seizoen - a.cq_punten_vorig_seizoen || a.naam.localeCompare(b.naam),
  );
  const schijven = [...inst.prijsschijven].sort((a, b) => b.vanaf_punten - a.vanaf_punten);
  const prijzen = new Map();
  volgorde.forEach((renner, i) => {
    let prijs = inst.prijzen_top[i];
    if (prijs === undefined) {
      const schijf = schijven.find((s) => renner.cq_punten_vorig_seizoen >= s.vanaf_punten);
      prijs = schijf ? schijf.prijs : schijven[schijven.length - 1].prijs;
    }
    prijzen.set(renner.cq_riderid, prijs);
  });
  return prijzen;
}

// Datum als "JJJJ-MM-DD" in Belgische tijd.
export function vandaagISO(nu = new Date()) {
  return nu.toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
}

// De periode waarin een datum valt, of null (voor de eerste of na de laatste).
export function periodeVan(datum, inst) {
  return inst.periodes.find((p) => datum >= p.start && datum <= p.eind) || null;
}

// Mag je je ploeg nog vrij samenstellen? Ja, zolang periode 1 niet begonnen is.
export function inschrijvingOpen(inst, vandaag = vandaagISO()) {
  const eerste = [...inst.periodes].sort((a, b) => a.nr - b.nr)[0];
  return !eerste || vandaag < eerste.start;
}

// Selecties die in een bepaalde periode in de ploeg zitten.
export function ploegInPeriode(selecties, nr) {
  return selecties.filter((s) => s.vanaf_periode <= nr && (s.tot_periode == null || s.tot_periode >= nr));
}

// ---------- Punten ----------

// De puntenschaal die bij een koers hoort.
function schaalVoor(koers, inst) {
  const s = inst.puntenschaal;
  if (koers.type === "rit") return s.rit;
  if (["punten", "berg", "jongeren"].includes(koers.type)) return s.trui;
  if (koers.type === "eindklassement" && koers.is_grote_ronde) return s.eindklassement_grote_ronde;
  return s.eendags_en_eindklassement; // eendagskoers of eindklassement van een andere rittenkoers
}

function factorVoor(koers, inst) {
  return koers.is_grote_ronde ? inst.klassefactoren.grote_ronde : inst.klassefactoren[koers.klasse] ?? 0;
}

// De uitslag van een koers, met de correcties van de admin erover.
// Een correctie zet renner X op positie P: wie automatisch op P stond, valt weg,
// en X verdwijnt van zijn automatische plaats. Een correctie zonder renner maakt P leeg.
export function uitslagMetCorrecties(koers, correcties) {
  const eigen = correcties.filter((c) => c.cq_raceid === koers.cq_raceid);
  if (!eigen.length) return koers.uitslag;
  const posities = new Set(eigen.map((c) => c.positie));
  const renners = new Set(eigen.filter((c) => c.cq_riderid != null).map((c) => c.cq_riderid));
  return [
    ...koers.uitslag.filter((u) => !posities.has(u.positie) && !renners.has(u.cq_riderid)),
    ...eigen.filter((c) => c.cq_riderid != null).map((c) => ({ cq_riderid: c.cq_riderid, positie: c.positie })),
  ].sort((a, b) => a.positie - b.positie);
}

// Telt als overwinning: een eerste plaats in een rit, eendagskoers of eindklassement.
const OVERWINNING = new Set(["rit", "eendags", "eindklassement"]);

// Alle punten die renners verdienden, per renner een lijst van resultaten:
// { cq_raceid, naam, datum, periode, positie, punten, overwinning }.
// Koersen buiten de periodes of geschrapte koersen tellen niet.
export function rennerResultaten(koersen, correcties, inst) {
  const perRenner = new Map();
  for (const koers of koersen) {
    if (koers.geannuleerd) continue;
    const periode = periodeVan(koers.datum, inst);
    if (!periode) continue;
    const schaal = schaalVoor(koers, inst);
    const factor = factorVoor(koers, inst);
    for (const { cq_riderid, positie } of uitslagMetCorrecties(koers, correcties)) {
      const basis = schaal[positie - 1];
      if (!basis) continue;
      if (!perRenner.has(cq_riderid)) perRenner.set(cq_riderid, []);
      perRenner.get(cq_riderid).push({
        cq_raceid: koers.cq_raceid, naam: koers.naam, datum: koers.datum, periode: periode.nr,
        positie, punten: basis * factor, overwinning: positie === 1 && OVERWINNING.has(koers.type),
      });
    }
  }
  return perRenner;
}

// De stand. `periodeNr` = null voor het algemeen klassement.
// Een renner scoort voor een deelnemer enkel in de periodes waarin hij in diens ploeg zat.
// Geeft rijen { email, punten, overwinningen, renners: [{ cq_riderid, punten, resultaten }], plaats },
// gesorteerd op punten en dan op aantal overwinningen.
export function berekenStand(selecties, resultaten, periodeNr = null) {
  const perDeelnemer = new Map();
  for (const sel of selecties) {
    const email = sel.createdBy?.email;
    if (!email) continue;
    if (!perDeelnemer.has(email)) perDeelnemer.set(email, { email, punten: 0, overwinningen: 0, renners: new Map() });
    const rij = perDeelnemer.get(email);
    const geteld = (resultaten.get(sel.cq_riderid) || []).filter((r) =>
      r.periode >= sel.vanaf_periode && (sel.tot_periode == null || r.periode <= sel.tot_periode) &&
      (periodeNr == null || r.periode === periodeNr));
    const renner = rij.renners.get(sel.cq_riderid) || { cq_riderid: sel.cq_riderid, punten: 0, resultaten: [] };
    for (const r of geteld) {
      renner.punten += r.punten;
      renner.resultaten.push(r);
      rij.punten += r.punten;
      if (r.overwinning) rij.overwinningen += 1;
    }
    rij.renners.set(sel.cq_riderid, renner);
  }
  const rijen = [...perDeelnemer.values()].map((r) => ({
    ...r, renners: [...r.renners.values()].sort((a, b) => b.punten - a.punten),
  }));
  rijen.sort((a, b) => b.punten - a.punten || b.overwinningen - a.overwinningen);
  rijen.forEach((r, i) => {
    const vorige = rijen[i - 1];
    r.plaats = vorige && vorige.punten === r.punten && vorige.overwinningen === r.overwinningen ? vorige.plaats : i + 1;
  });
  return rijen;
}

// Controleert of een renner bij de ploeg mag. Geeft null of de reden waarom niet.
export function magToevoegen(riderid, ploeg, prijzen, inst) {
  if (ploeg.some((s) => s.cq_riderid === riderid)) return "Deze renner zit al in je ploeg.";
  if (ploeg.length >= inst.ploeggrootte) return `Je ploeg is vol (${inst.ploeggrootte} renners).`;
  const besteed = ploeg.reduce((som, s) => som + (prijzen.get(s.cq_riderid) ?? 0), 0);
  const over = inst.budget - besteed;
  if (prijzen.get(riderid) > over) return `Te duur: je hebt nog ${over} credits over.`;
  // Hou genoeg over om de resterende plaatsen met de goedkoopste renners te vullen.
  const goedkoopst = Math.min(...prijzen.values());
  const nodigVoorRest = (inst.ploeggrootte - ploeg.length - 1) * goedkoopst;
  if (prijzen.get(riderid) > over - nodigVoorRest) {
    return `Te duur: hou ${nodigVoorRest} credits over om je ploeg te vullen.`;
  }
  return null;
}
