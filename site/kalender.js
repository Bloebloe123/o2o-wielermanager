// Kalender: alle koersen van het seizoen, per periode, met wanneer je transfers kunt doen.
import { periodeVan, vandaagISO } from "./spel.js";

const $ = (id) => document.getElementById(id);

function kort(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
}

function lang(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long" });
}

export function tekenKalender({ staat, maak, pt }) {
  const { inst } = staat;
  const vandaag = vandaagISO();
  const periodes = [...inst.periodes].sort((a, b) => a.nr - b.nr);
  const koersen = staat.kalender?.koersen || [];
  const metUitslag = new Set(staat.koersen.koersen.filter((k) => !k.geannuleerd).map((k) => k.cq_raceid));
  const geschrapt = new Set(staat.koersen.koersen.filter((k) => k.geannuleerd).map((k) => k.cq_raceid));
  const vak = $("kalender-lijst");

  if (!koersen.length) {
    vak.replaceChildren(maak("p", { tekst: `CQ heeft de kalender van ${inst.seizoen} nog niet gepubliceerd. Hij verschijnt hier vanzelf zodra hij er is.` }));
  } else {
    vak.replaceChildren();
  }

  const factor = (k) => (k.is_grote_ronde ? inst.klassefactoren.grote_ronde : inst.klassefactoren[k.klasse] ?? 0);
  const rij = (k) => {
    const periodeEind = periodeVan(k.eind, inst);
    const periodeStart = periodeVan(k.start, inst);
    const status = geschrapt.has(k.cq_raceid) ? "Geschrapt"
      : metUitslag.has(k.cq_raceid) ? "Uitslag binnen"
      : k.start <= vandaag && k.eind >= vandaag ? "Bezig"
      : k.eind < vandaag ? "Wacht op uitslag" : "";
    const opmerking = periodeStart && periodeEind && periodeStart.nr !== periodeEind.nr
      ? `Loopt door in periode ${periodeEind.nr}, maar telt volledig in periode ${periodeStart.nr}: de ploeg bij de eerste rit geldt voor de hele koers.` : "";
    return maak("li", { klasse: `koers ${k.eind < vandaag ? "voorbij" : ""}` }, [
      maak("span", { klasse: "koers-datum", tekst: k.start === k.eind ? kort(k.start) : `${kort(k.start)} – ${kort(k.eind)}` }),
      maak("span", { klasse: "koers-naam" }, [
        maak("span", { tekst: k.naam }),
        ...(opmerking ? [maak("span", { klasse: "klein", tekst: opmerking })] : []),
      ]),
      maak("span", {
        klasse: `badge ${k.is_grote_ronde ? "gt" : k.klasse.toLowerCase()}`,
        tekst: `${k.is_grote_ronde ? "Grote ronde" : k.klasse === "WT" ? "WorldTour" : "ProSeries"} ×${pt(factor(k))}`,
      }),
      maak("span", { klasse: "koers-status", tekst: status }),
    ]);
  };

  // Voor periode 1: tot wanneer je je ploeg kiest.
  if (periodes.length) {
    vak.append(maak("div", { klasse: "transfermoment" }, [
      maak("strong", { tekst: "Ploeg kiezen" }),
      maak("span", { tekst: `Stel je ploeg vrij samen tot ${lang(periodes[0].start)}. Daarna ligt ze vast tot de eerste transferperiode.` }),
    ]));
  }

  for (const p of periodes) {
    const bezig = p.start <= vandaag && vandaag <= p.eind;
    const inPeriode = koersen.filter((k) => k.start >= p.start && k.start <= p.eind);
    vak.append(maak("section", { klasse: `periode-blok ${bezig ? "bezig" : ""}` }, [
      maak("h3", {}, [
        maak("span", { tekst: `Periode ${p.nr}` }),
        maak("span", { klasse: "klein", tekst: `${kort(p.start)} – ${kort(p.eind)}${bezig ? " · nu bezig" : ""}` }),
      ]),
      inPeriode.length
        ? maak("ul", { klasse: "koersen" }, inPeriode.map(rij))
        : maak("p", { klasse: "klein", tekst: "Geen WorldTour- of ProSeries-koersen." }),
    ]));
    // De transferperiode op het einde van deze periode bepaalt de ploeg voor de volgende.
    const tp = inst.transferperiodes.find((t) => t.nr === p.nr);
    if (tp) {
      const open = tp.open <= vandaag && vandaag <= tp.sluit;
      vak.append(maak("div", { klasse: `transfermoment${open ? " open" : ""}` }, [
        maak("strong", { tekst: `Transferperiode ${tp.nr}: ${lang(tp.open)} tot en met ${lang(tp.sluit)}${open ? " · nu open" : ""}` }),
        maak("span", {
          tekst: `Maximaal ${inst.max_transfers} transfers voor periode ${tp.nr + 1}. Buiten deze dagen ligt je ploeg vast. ` +
            `Wie je verkoopt, rijdt nog voor je tot en met ${kort(p.eind)}, en ook in een rittenkoers die in periode ${p.nr} begon.`,
        }),
      ]));
    }
  }

  const buiten = koersen.filter((k) => !periodeVan(k.start, inst));
  if (buiten.length) {
    vak.append(maak("section", { klasse: "periode-blok buiten" }, [
      maak("h3", { tekst: "Buiten de periodes (telt niet mee)" }),
      maak("ul", { klasse: "koersen" }, buiten.map(rij)),
    ]));
  }
}
