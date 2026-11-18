// Overzicht: de startpagina met je ploeg, de volgende koers, de laatste uitslag en de top 5.
import { berekenStand, ploegInPeriode, ploegModus, vandaagISO } from "./spel.js";
import { laatsteUitslagen } from "./uitslagen.js";
import { truiDragers, truiIcoon } from "./truien.js";
import { jokerBonus } from "./spel.js";

const $ = (id) => document.getElementById(id);

function kort(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
}

export async function tekenOverzicht(ctx) {
  const { staat, maak, pt, typeVan, laadDeelnemers, naarTab, vulAan } = ctx;
  const vandaag = vandaagISO();
  const m = ploegModus(staat.inst);

  // Punten die elke renner al voor jou verdiende.
  const mijnStand = berekenStand(staat.mijnSelecties, staat.resultaten)[0];
  const puntenVan = new Map((mijnStand?.renners || []).map((r) => [r.cq_riderid, r]));
  const naam = (id) => staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`;

  // ---- Mijn ploeg (zoals ze nu rijdt; voor het seizoen: zoals je ze koos) ----
  const ploeg = ploegInPeriode(staat.mijnSelecties, m.huidige ?? m.doel ?? 1, m.huidige ? vandaag : null)
    .sort((a, b) => (puntenVan.get(b.cq_riderid)?.punten || 0) - (puntenVan.get(a.cq_riderid)?.punten || 0) ||
      staat.prijzen.get(b.cq_riderid) - staat.prijzen.get(a.cq_riderid));
  $("ov-ploegnaam").textContent = $("mijn-ploegnaam").textContent;

  // ---- Startkaart: zolang je ploeg voor het seizoen nog niet compleet is ----
  const inst = staat.inst;
  const startkaart = $("ov-start");
  startkaart.hidden = !(m.modus === "inschrijving" && ploeg.length < inst.ploeggrootte);
  if (!startkaart.hidden) {
    const over = inst.budget - ploeg.reduce((som, s) => som + (staat.prijzen.get(s.cq_riderid) ?? 0), 0);
    const tekort = inst.ploeggrootte - ploeg.length;
    const tot = new Date(m.deadline).toLocaleDateString("nl-BE", { day: "numeric", month: "long" });
    startkaart.replaceChildren(
      maak("h2", { tekst: ploeg.length ? "Je ploeg is nog niet compleet" : "Kies je ploeg" }),
      maak("p", { tekst: `Kies nog ${tekort} ${tekort === 1 ? "renner" : "renners"}. Je hebt nog ${over} van de ${inst.budget} credits. ` +
        `Je kunt je ploeg vrij aanpassen tot ${tot}.` }),
      maak("div", { klasse: "start-knoppen" }, [
        maak("button", { klasse: "knop", type: "button", tekst: "Naar mijn ploeg", onclick: () => naarTab("ploeg") }),
        maak("button", {
          klasse: "knop knop-licht-rand", type: "button", tekst: "Vul mijn ploeg aan",
          title: "Vult de lege plaatsen met willekeurige renners binnen je budget. Je kunt ze daarna nog wisselen.",
          onclick: async (e) => { e.target.disabled = true; await vulAan(); },
        }),
      ]),
    );
  }
  $("ov-ploeg-totaal").textContent = mijnStand ? `${pt(mijnStand.punten)} punten` : "0 punten";
  $("ov-ploeg").replaceChildren(...(ploeg.length ? ploeg.map((s) => maak("li", {}, [
    maak("span", { klasse: "renner-naam", tekst: naam(s.cq_riderid) }),
    maak("span", { klasse: `type type-${typeVan(s.cq_riderid).toLowerCase()}`, tekst: typeVan(s.cq_riderid) }),
    maak("span", { klasse: "punten-renner", tekst: `${pt(puntenVan.get(s.cq_riderid)?.punten || 0)} pt` }),
  ])) : [maak("li", { klasse: "leeg" }, [
    maak("span", { tekst: "Je hebt nog geen renners. " }),
    maak("button", { klasse: "link-knop", tekst: "Kies je ploeg", onclick: () => naarTab("ploeg") }),
  ])]));

  // ---- Volgende koers (en wat er vandaag rijdt) ----
  const kalender = staat.kalender?.koersen || [];
  const bezig = kalender.filter((k) => k.start <= vandaag && vandaag <= k.eind);
  const volgende = kalender.filter((k) => k.start > vandaag).sort((a, b) => a.start.localeCompare(b.start));
  const koersRij = (k, label) => maak("li", {}, [
    maak("span", { klasse: "klein", tekst: label }),
    maak("strong", { tekst: k.naam }),
    maak("span", { klasse: "klein", tekst: `${k.start === k.eind ? kort(k.start) : `${kort(k.start)} – ${kort(k.eind)}`} · ${k.is_grote_ronde ? "Grote ronde" : k.klasse === "WT" ? "WorldTour" : "ProSeries"}` }),
  ]);
  const komend = [
    ...bezig.map((k) => koersRij(k, "Nu bezig")),
    ...volgende.filter((k) => k.start === volgende[0]?.start).map((k) => koersRij(k, "Volgende koers")),
  ];
  $("ov-volgende").replaceChildren(...(komend.length ? komend : [maak("li", {
    klasse: "klein", tekst: kalender.length ? "Geen koersen meer dit seizoen." : "De kalender is nog niet bekend.",
  })]));

  // ---- Laatste uitslagen ----
  $("ov-uitslagen").replaceChildren(laatsteUitslagen({ staat, maak, pt }));

  // ---- Top 5 van de stand, en waar jouw ploeg staat ----
  $("ov-top").replaceChildren(maak("li", { klasse: "klein", tekst: "Stand wordt berekend…" }));
  await laadDeelnemers();
  const stand = berekenStand(staat.alleSelecties, staat.resultaten, null, staat.deelnemers, jokerBonus(staat.alleSelecties, staat.inst));
  const dragers = truiDragers(staat);
  const ikIndex = stand.findIndex((r) => r.email === staat.ik.email);
  const standRij = (r) => maak("li", { klasse: r.email === staat.ik.email ? "ik" : "" }, [
    maak("span", { klasse: `plaats plaats-${r.plaats}`, tekst: r.plaats }),
    maak("span", {}, [
      maak("span", { tekst: staat.ploegnaamVan.get(r.email) || staat.naamVan.get(r.email) || r.email }),
      ...(dragers.get(r.email) || []).map(truiIcoon),
    ]),
    maak("span", { klasse: "punten-renner", tekst: `${pt(r.punten)} pt` }),
  ]);
  const rijen = stand.slice(0, 5).map(standRij);
  if (ikIndex >= 5) rijen.push(maak("li", { klasse: "klein puntjes", tekst: "…" }), standRij(stand[ikIndex]));
  $("ov-top").replaceChildren(...(rijen.length ? rijen : [maak("li", { klasse: "klein", tekst: "Nog geen ploegen." })]));
  $("ov-mijn-plaats").textContent = ikIndex >= 0 ? `Jouw ploeg staat ${stand[ikIndex].plaats}e van ${stand.length}.` : "";
}
