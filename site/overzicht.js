// Overzicht: de startpagina met je ploeg, de volgende koers, de laatste uitslag en de top 5.
import { berekenStand, ploegInPeriode, ploegModus, vandaagISO } from "./spel.js";

const $ = (id) => document.getElementById(id);

function kort(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
}

export async function tekenOverzicht(ctx) {
  const { staat, maak, pt, typeVan, laadDeelnemers, naarTab } = ctx;
  const vandaag = vandaagISO();
  const m = ploegModus(staat.inst);

  // Punten die elke renner al voor jou verdiende.
  const mijnStand = berekenStand(staat.mijnSelecties, staat.resultaten)[0];
  const puntenVan = new Map((mijnStand?.renners || []).map((r) => [r.cq_riderid, r]));
  const naam = (id) => staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`;

  // ---- Mijn ploeg (zoals ze nu rijdt; voor het seizoen: zoals je ze koos) ----
  const ploeg = ploegInPeriode(staat.mijnSelecties, m.huidige ?? m.doel ?? 1)
    .sort((a, b) => (puntenVan.get(b.cq_riderid)?.punten || 0) - (puntenVan.get(a.cq_riderid)?.punten || 0) ||
      staat.prijzen.get(b.cq_riderid) - staat.prijzen.get(a.cq_riderid));
  $("ov-ploegnaam").textContent = $("mijn-ploegnaam").textContent;
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

  // ---- Laatste uitslag van je ploeg: de koersen van de laatste dag waarop je renners scoorden ----
  const gereden = staat.koersen.koersen.filter((k) => !k.geannuleerd);
  const laatsteKoersdag = gereden.map((k) => k.datum).sort().pop();
  const gescoord = new Set([...puntenVan.values()].flatMap((r) => r.resultaten.map((x) => x.cq_raceid)));
  const laatsteDag = gereden.filter((k) => gescoord.has(k.cq_raceid)).map((k) => k.datum).sort().pop() ?? laatsteKoersdag;
  // Enkel de koersen waarin je ploeg scoorde; scoorde ze nog nergens, dan de laatste koersdag.
  const laatste = gereden.filter((k) => k.datum === laatsteDag && (gescoord.has(k.cq_raceid) || !gescoord.size));
  $("ov-laatste-titel").textContent = laatsteDag ? `Laatste uitslag van je ploeg · ${kort(laatsteDag)}` : "Laatste uitslag van je ploeg";
  $("ov-laatste-later").textContent = laatsteKoersdag && laatsteKoersdag !== laatsteDag
    ? `Op latere koersdagen (laatste: ${kort(laatsteKoersdag)}) haalde je ploeg geen punten.` : "";
  $("ov-laatste").replaceChildren(...(laatste.length ? laatste.map((k) => {
    const podium = k.uitslag.slice(0, 3).map((u) => `${u.positie}. ${naam(u.cq_riderid)}`).join("  ");
    const mijn = [...puntenVan.values()]
      .flatMap((r) => r.resultaten.filter((x) => x.cq_raceid === k.cq_raceid).map((x) => ({ ...x, id: r.cq_riderid })))
      .sort((a, b) => a.positie - b.positie);
    return maak("li", {}, [
      maak("strong", { tekst: k.naam }),
      maak("span", { klasse: "klein", tekst: podium }),
      mijn.length
        ? maak("ul", { klasse: "mijn-uitslag" }, mijn.map((x) => maak("li", {}, [
          maak("span", { tekst: `${x.positie}. ${naam(x.id)}` }),
          maak("span", { klasse: "punten-renner", tekst: `+${pt(x.punten)} pt` }),
        ])))
        : maak("span", { klasse: "klein geen", tekst: "Geen renners van je ploeg in de punten." }),
    ]);
  }) : [maak("li", { klasse: "klein", tekst: "Nog geen uitslagen dit seizoen." })]));

  // ---- Top 5 van de stand, en waar jouw ploeg staat ----
  $("ov-top").replaceChildren(maak("li", { klasse: "klein", tekst: "Stand wordt berekend…" }));
  await laadDeelnemers();
  const stand = berekenStand(staat.alleSelecties, staat.resultaten, null, staat.deelnemers);
  const ikIndex = stand.findIndex((r) => r.email === staat.ik.email);
  const standRij = (r) => maak("li", { klasse: r.email === staat.ik.email ? "ik" : "" }, [
    maak("span", { klasse: `plaats plaats-${r.plaats}`, tekst: r.plaats }),
    maak("span", { tekst: staat.ploegnaamVan.get(r.email) || staat.naamVan.get(r.email) || r.email }),
    maak("span", { klasse: "punten-renner", tekst: `${pt(r.punten)} pt` }),
  ]);
  const rijen = stand.slice(0, 5).map(standRij);
  if (ikIndex >= 5) rijen.push(maak("li", { klasse: "klein puntjes", tekst: "…" }), standRij(stand[ikIndex]));
  $("ov-top").replaceChildren(...(rijen.length ? rijen : [maak("li", { klasse: "klein", tekst: "Nog geen ploegen." })]));
  $("ov-mijn-plaats").textContent = ikIndex >= 0 ? `Jouw ploeg staat ${stand[ikIndex].plaats}e van ${stand.length}.` : "";
}
