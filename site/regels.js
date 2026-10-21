// Spelregels. Alle getallen komen uit de instellingen, zodat de regels altijd kloppen
// met wat de site berekent.
const $ = (id) => document.getElementById(id);

function datum(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", { day: "numeric", month: "long" });
}

export function tekenRegels({ staat, maak, pt }) {
  const { inst } = staat;
  const s = inst.puntenschaal;
  const f = inst.klassefactoren;
  const periodes = [...inst.periodes].sort((a, b) => a.nr - b.nr);
  const top = inst.prijzen_top;
  const schijven = [...inst.prijsschijven].sort((a, b) => b.vanaf_punten - a.vanaf_punten);
  const vorig = inst.seizoen - 1;

  const p = (tekst) => maak("p", { tekst });
  const h = (tekst) => maak("h3", { tekst });
  const lijst = (items) => maak("ul", {}, items.map((t) => maak("li", { tekst: t })));
  const tabel = (koppen, rijen) => maak("div", { klasse: "tabel-wrap regels-tabel" }, [maak("table", { klasse: "tabel" }, [
    maak("thead", {}, [maak("tr", {}, koppen.map((k, i) => maak("th", { klasse: i ? "getal" : "", tekst: k })))]),
    maak("tbody", {}, rijen.map((r) => maak("tr", {}, r.map((c, i) => maak("td", { klasse: i ? "getal" : "", tekst: c }))))),
  ])]);

  // Puntentabel: één rij per plaats, één kolom per soort uitslag.
  const soorten = [
    ["Eindkl. grote ronde", s.eindklassement_grote_ronde],
    ["Eendags of eindkl.", s.eendags_en_eindklassement],
    ["Rit", s.rit],
    ["Trui", s.trui],
  ];
  const plaatsen = Math.max(...soorten.map(([, r]) => r.length));
  const puntenRijen = Array.from({ length: plaatsen }, (_, i) => [`${i + 1}`, ...soorten.map(([, r]) => (r[i] != null ? pt(r[i]) : ""))]);

  // Prijsschijven als tekst: "800 of meer: 7 credits", "500 tot 799: 6 credits", …
  const schijfRijen = schijven.map((sch, i) => {
    const bovengrens = i ? schijven[i - 1].vanaf_punten - 1 : null;
    const bereik = bovengrens == null ? `${sch.vanaf_punten} of meer` : `${sch.vanaf_punten} tot ${bovengrens}`;
    return [bereik, `${sch.prijs}`];
  });

  $("regels-inhoud").replaceChildren(
    h("Het idee"),
    p(`Je stelt een ploeg samen van ${inst.ploeggrootte} echte renners uit de WorldTeams en ProTeams. ` +
      `Ze verdienen punten met hun uitslagen in de mannenkoersen van de WorldTour en de ProSeries van ${inst.seizoen}. ` +
      "Wie aan het einde van het seizoen de meeste punten heeft, wint."),

    h("Je ploeg"),
    lijst([
      `${inst.ploeggrootte} renners, samen hoogstens ${inst.budget} credits.`,
      "Iedereen mag dezelfde renners kiezen.",
      `Je kunt je ploeg vrij samenstellen tot ${datum(periodes[0].start)}, de start van periode 1.`,
      "Je moet altijd genoeg credits overhouden om de rest van je ploeg met de goedkoopste renners te vullen.",
    ]),

    h("Prijzen"),
    p(`De prijs van een renner hangt af van zijn CQ-punten in ${vorig} en blijft het hele seizoen hetzelfde. ` +
      `De ${top.length} beste renners krijgen elk een eigen prijs: nr. 1 kost ${top[0]} credits, nr. ${top.length} kost ${top[top.length - 1]} credits. ` +
      "De andere renners vallen in een prijsschijf:"),
    tabel([`CQ-punten ${vorig}`, "Credits"], schijfRijen),

    h("Punten"),
    p("Een renner scoort volgens zijn plaats in de uitslag. Daarna gaat de score maal de factor van de koers:"),
    lijst([
      `Grote ronde (Giro, Tour, Vuelta): ×${pt(f.grote_ronde)}`,
      `Andere WorldTour-koersen: ×${pt(f.WT)}`,
      `ProSeries-koersen: ×${pt(f.PS)}`,
    ]),
    tabel(["Plaats", ...soorten.map(([naam]) => naam)], puntenRijen),
    p("Eindkl. = eindklassement van een rittenkoers. Trui = eindstand van het punten-, berg- of jongerenklassement."),
    p("CQ Ranking publiceert geen jongerenklassement, dus de jongerentrui levert in de praktijk geen punten op. " +
      "Punten- en bergklassementen zijn er enkel bij WorldTour-rittenkoersen. " +
      "Bij een ploegentijdrit krijgt elke renner de plaats van zijn ploeg. Geschrapte koersen of ritten tellen niet."),

    h("Periodes en transfers"),
    p(`Het seizoen bestaat uit ${periodes.length} periodes. Op het einde van elke periode (behalve de laatste) is er een transferperiode:`),
    tabel(["Periode", "Van", "Tot en met", "Transferperiode"], periodes.map((x) => {
      const tp = inst.transferperiodes.find((t) => t.nr === x.nr);
      return [`${x.nr}`, datum(x.start), datum(x.eind), tp ? `${datum(tp.open)} – ${datum(tp.sluit)}` : "–"];
    })),
    lijst([
      `Enkel tijdens een transferperiode kun je transfers doen voor de volgende periode: hoogstens ${inst.max_transfers} renners verkopen en ${inst.max_transfers} kopen, binnen het budget. Daarbuiten ligt je ploeg vast.`,
      "Zolang de transferperiode loopt, kun je je transfers nog aanpassen of ongedaan maken.",
      "Een renner scoort voor jou enkel in de periodes waarin hij in je ploeg zat.",
      "Een koers telt in de periode waarin ze plaatsvindt. Een rittenkoers telt volledig in de periode van haar eerste rit: " +
        "de ploeg die je had bij de eerste rit, geldt voor de hele koers, ook als er tussendoor een nieuwe periode begint.",
      "Tijdens de laatste periode liggen de ploegen vast.",
      "Transfers van anderen zie je zodra hun periode begonnen is.",
    ]),

    h("Klassementen"),
    lijst([
      "Algemeen klassement: alle punten van het seizoen.",
      "Klassement per periode: enkel de punten van die periode.",
      `Debutanten: wie in ${inst.seizoen} voor het eerst meespeelt.`,
      "Bij gelijke stand beslist het aantal overwinningen: eerste plaatsen in ritten, eendagskoersen en eindklassementen.",
    ]),

    h("Uitslagen"),
    lijst([
      "De uitslagen komen van CQ Ranking (cqranking.com) en worden elke dag rond 18u30 automatisch opgehaald.",
      "Is een uitslag fout of gewijzigd (bv. een diskwalificatie), dan kan een admin ze corrigeren. Een correctie gaat altijd voor.",
      `Admins: ${inst.admins.join(", ")}.`,
    ]),
  );
}
