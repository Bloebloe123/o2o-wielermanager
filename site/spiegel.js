// Spiegel: vergelijk je ploeg met een andere ploeg. Welke renners hebben jullie samen,
// welke alleen jij of alleen zij, en waar komt het verschil in punten vandaan?
import { berekenStand, jokerBonus, ploegInPeriode, ploegModus, vandaagISO } from "./spel.js";
import { truiDragers, truiIcoon } from "./truien.js";

const $ = (id) => document.getElementById(id);

export async function tekenSpiegel(ctx) {
  const { staat, maak, pt, typeVan, laadDeelnemers } = ctx;
  $("spiegel-inhoud").replaceChildren(maak("p", { klasse: "klein", tekst: "Ploegen worden geladen…" }));
  await laadDeelnemers();

  const stand = berekenStand(staat.alleSelecties, staat.resultaten, null, staat.deelnemers, jokerBonus(staat.alleSelecties, staat.inst));
  const ik = stand.find((r) => r.email === staat.ik.email);
  const anderen = stand.filter((r) => r.email !== staat.ik.email);
  const ploegnaam = (email) => staat.ploegnaamVan.get(email) || staat.naamVan.get(email) || email;
  const keuze = $("spiegel-keuze");

  if (!ik || !anderen.length) {
    keuze.hidden = true;
    $("spiegel-inhoud").replaceChildren(maak("p", { tekst: ik ? "Er zijn nog geen andere ploegen om mee te vergelijken." : "Maak eerst je eigen ploeg." }));
    return;
  }
  // Standaard: de ploeg net voor jou in de stand (of de leider als jij eerst staat).
  const vorige = keuze.value;
  keuze.hidden = false;
  keuze.replaceChildren(...anderen.map((r) => maak("option", { value: r.email, tekst: `${r.plaats}. ${ploegnaam(r.email)}` })));
  const voorMij = [...anderen].reverse().find((r) => r.punten >= ik.punten) || anderen[0];
  keuze.value = anderen.some((r) => r.email === vorige) ? vorige : voorMij.email;
  keuze.onchange = () => teken();
  teken();

  function teken() {
    const zij = stand.find((r) => r.email === keuze.value);
    const m = ploegModus(staat.inst);
    const nr = m.huidige ?? m.doel ?? 1;
    const datum = m.huidige ? vandaagISO() : null;
    const ploegVan = (email) => new Set(ploegInPeriode(staat.alleSelecties.filter((s) => s.createdBy?.email === email), nr, datum).map((s) => s.cq_riderid));
    const mijnPloeg = ploegVan(ik.email);
    const hunPloeg = ploegVan(zij.email);
    const puntenBij = (rij) => new Map(rij.renners.map((r) => [r.cq_riderid, r.punten]));
    const mijnPunten = puntenBij(ik), hunPunten = puntenBij(zij);
    const naam = (id) => staat.rennerOpId.get(id)?.naam ?? `Renner ${id}`;
    const budget = (ploeg) => [...ploeg].reduce((som, id) => som + (staat.prijzen.get(id) ?? 0), 0);
    const dragers = truiDragers(staat);

    const kop = (rij, ploeg) => maak("div", { klasse: `spiegel-ploeg${rij.email === ik.email ? " ik" : ""}` }, [
      maak("h3", {}, [maak("span", { tekst: ploegnaam(rij.email) }), ...(dragers.get(rij.email) || []).map(truiIcoon)]),
      maak("p", { klasse: "spiegel-punten", tekst: `${pt(rij.punten)} pt` }),
      maak("p", { klasse: "klein", tekst: `${rij.plaats}e · ${rij.overwinningen} overwinningen · ${ploeg.size} renners · ${budget(ploeg)} credits` }),
    ]);

    // Een lijst renners met hun punten bij jou en/of bij de andere ploeg.
    const lijst = (titel, ids, kolommen) => {
      const rijen = [...ids].sort((a, b) =>
        Math.max(mijnPunten.get(b) || 0, hunPunten.get(b) || 0) - Math.max(mijnPunten.get(a) || 0, hunPunten.get(a) || 0));
      return maak("div", { klasse: "kaart spiegel-lijst" }, [
        maak("h3", { tekst: `${titel} (${rijen.length})` }),
        rijen.length
          ? maak("table", { klasse: "tabel" }, [
            maak("thead", {}, [maak("tr", {}, [
              maak("th", { tekst: "Renner" }), maak("th", { tekst: "Type" }),
              ...kolommen.map(([k]) => maak("th", { klasse: "getal", tekst: k })),
            ])]),
            maak("tbody", {}, rijen.map((id) => maak("tr", {}, [
              maak("td", { tekst: naam(id) }),
              maak("td", {}, [maak("span", { klasse: `type type-${typeVan(id).toLowerCase()}`, tekst: typeVan(id) })]),
              ...kolommen.map(([, punten]) => maak("td", { klasse: "getal", tekst: pt(punten.get(id) || 0) })),
            ]))),
          ])
          : maak("p", { klasse: "klein", tekst: "Geen." }),
      ]);
    };
    const samen = [...mijnPloeg].filter((id) => hunPloeg.has(id));
    const enkelIk = [...mijnPloeg].filter((id) => !hunPloeg.has(id));
    const enkelZij = [...hunPloeg].filter((id) => !mijnPloeg.has(id));
    const verschil = ik.punten - zij.punten;
    const somVan = (ids, punten) => ids.reduce((som, id) => som + (punten.get(id) || 0), 0);

    $("spiegel-inhoud").replaceChildren(
      maak("div", { klasse: "kaart spiegel-kop" }, [
        kop(ik, mijnPloeg),
        maak("div", { klasse: "spiegel-vs" }, [
          maak("strong", { tekst: verschil === 0 ? "Gelijk" : `${verschil > 0 ? "+" : "−"}${pt(Math.abs(verschil))}` }),
          maak("span", { klasse: "klein", tekst: `${samen.length} renners gemeen` }),
        ]),
        kop(zij, hunPloeg),
      ]),
      maak("p", { klasse: "klein spiegel-uitleg", tekst:
        `Je eigen renners brachten je ${pt(somVan(enkelIk, mijnPunten))} punten op, die van ${ploegnaam(zij.email)} hun ${pt(somVan(enkelZij, hunPunten))}. ` +
        "Punten bij een ploeg tellen enkel zolang de renner in die ploeg zat. Renners die eerder in een ploeg zaten, staan niet in deze lijsten." }),
      maak("div", { klasse: "spiegel-lijsten" }, [
        lijst("Bij allebei", samen, [["Bij jou", mijnPunten], ["Bij hen", hunPunten]]),
        lijst("Alleen bij jou", enkelIk, [["Jouw punten", mijnPunten]]),
        lijst(`Alleen bij ${ploegnaam(zij.email)}`, enkelZij, [["Hun punten", hunPunten]]),
      ]),
    );
  }
}
