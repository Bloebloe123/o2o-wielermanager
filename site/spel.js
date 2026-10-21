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
