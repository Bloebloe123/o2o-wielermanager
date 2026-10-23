// "Laatste uitslagen": de laatste koersen met hun top 3. Klik je er een open, dan zie je
// de top 20 met de punten per plaats, en je eigen renners gemarkeerd.
import { berekenStand, factorVoor, schaalVoor, uitslagMetCorrecties } from "./spel.js";

// Binnen dezelfde dag eerst het eindklassement, dan ritten en eendagskoersen, dan de truien.
const VOLGORDE = { eindklassement: 0, rit: 1, eendags: 1, punten: 2, berg: 3, jongeren: 4 };

function kort(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
}

export function laatsteUitslagen({ staat, maak, pt }, aantal = 3) {
  const koersen = staat.koersen.koersen
    .filter((k) => !k.geannuleerd)
    .sort((a, b) => b.datum.localeCompare(a.datum) || (VOLGORDE[a.type] ?? 9) - (VOLGORDE[b.type] ?? 9) || b.cq_raceid - a.cq_raceid)
    .slice(0, aantal);
  if (!koersen.length) return maak("p", { klasse: "klein", tekst: "Nog geen uitslagen dit seizoen." });

  // Renners die in een koers punten haalden voor jou (zaten toen in je ploeg).
  const mijnStand = berekenStand(staat.mijnSelecties, staat.resultaten)[0];
  const voorMij = new Map();
  for (const r of mijnStand?.renners || []) {
    for (const x of r.resultaten) voorMij.set(`${x.cq_raceid}:${r.cq_riderid}`, x.punten);
  }
  // Renners buiten de WorldTeams en ProTeams staan niet in renners.json: dan de naam uit de uitslag.
  const naam = (u) => staat.rennerOpId.get(u.cq_riderid)?.naam ?? u.naam ?? `Renner ${u.cq_riderid}`;

  return maak("ul", { klasse: "uitslagen" }, koersen.map((k) => {
    const schaal = schaalVoor(k, staat.inst);
    const factor = factorVoor(k, staat.inst);
    const uitslag = uitslagMetCorrecties(k, staat.correcties).filter((u) => u.positie <= 20);
    const mijnAantal = uitslag.filter((u) => voorMij.has(`${k.cq_raceid}:${u.cq_riderid}`)).length;
    const top3 = uitslag.filter((u) => u.positie <= 3).map((u) => `${u.positie}. ${naam(u)}`).join("   ");
    return maak("li", {}, [maak("details", {}, [
      maak("summary", {}, [
        maak("span", { klasse: "uitslag-kop" }, [
          maak("strong", { tekst: k.naam }),
          maak("span", { klasse: "klein", tekst: kort(k.datum) }),
        ]),
        maak("span", { klasse: "klein uitslag-top3", tekst: top3 }),
        ...(mijnAantal ? [maak("span", { klasse: "mijn-teller", tekst: `${mijnAantal} van jou in de top 20` })] : []),
      ]),
      maak("table", { klasse: "tabel uitslag-tabel" }, [
        maak("thead", {}, [maak("tr", {}, [
          maak("th", { klasse: "getal", tekst: "#" }), maak("th", { tekst: "Renner" }),
          maak("th", { tekst: "Ploeg" }), maak("th", { klasse: "getal", tekst: "Punten" }),
        ])]),
        maak("tbody", {}, uitslag.map((u) => {
          const mijn = voorMij.has(`${k.cq_raceid}:${u.cq_riderid}`);
          const basis = schaal[u.positie - 1];
          return maak("tr", { klasse: mijn ? "mijn" : "" }, [
            maak("td", { klasse: "getal", tekst: u.positie }),
            maak("td", { tekst: naam(u) }),
            maak("td", { klasse: "klein", tekst: staat.rennerOpId.get(u.cq_riderid)?.ploeg ?? "" }),
            maak("td", { klasse: "getal", tekst: basis ? pt(basis * factor) : "–" }),
          ]);
        })),
      ]),
      maak("p", { klasse: "klein", tekst: `Punten na de factor ×${pt(factor)}. Je eigen renners zijn gemarkeerd.` }),
    ])]);
  }));
}
