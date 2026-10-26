// De truien van het spel: geel (leider algemeen klassement), groen (meeste punten in
// eendagskoersen) en bolletjes (meeste punten in rittenkoersen).
import { berekenStand, jokerBonus } from "./spel.js";

export const TRUIEN = {
  geel: { naam: "Gele trui", uitleg: "leider van het algemeen klassement" },
  groen: { naam: "Groene trui", uitleg: "meeste punten in eendagskoersen" },
  bolletjes: { naam: "Bolletjestrui", uitleg: "meeste punten in rittenkoersen" },
};

// Een klein truitje als SVG.
export function truiIcoon(soort) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `trui trui-${soort}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", TRUIEN[soort].naam);
  const titel = document.createElementNS(ns, "title");
  titel.textContent = `${TRUIEN[soort].naam}: ${TRUIEN[soort].uitleg}`;
  svg.append(titel);
  const vorm = document.createElementNS(ns, "path");
  vorm.setAttribute("d", "M8 2 L4 4 L1 9 L5 11 L6 9 L6 22 L18 22 L18 9 L19 11 L23 9 L20 4 L16 2 C15 4 9 4 8 2 Z");
  vorm.setAttribute("class", "trui-vorm");
  svg.append(vorm);
  if (soort === "bolletjes") {
    for (const [x, y] of [[9, 8], [15, 8], [12, 12], [9, 16], [15, 16], [12, 20]]) {
      const bol = document.createElementNS(ns, "circle");
      bol.setAttribute("cx", x);
      bol.setAttribute("cy", y);
      bol.setAttribute("r", 1.6);
      bol.setAttribute("class", "trui-bol");
      svg.append(bol);
    }
  }
  return svg;
}

// Wie draagt welke trui? Geeft een Map e-mail -> [soorten]. Enkel wie al punten heeft.
export function truiDragers(staat) {
  const dragers = new Map();
  const geef = (rijen, soort) => {
    const eerste = rijen[0];
    if (!eerste || eerste.punten <= 0) return;
    // Bij een volledige gelijkstand (ook in overwinningen) krijgen beide de trui.
    for (const r of rijen.filter((x) => x.plaats === 1)) dragers.set(r.email, [...(dragers.get(r.email) || []), soort]);
  };
  const bonus = jokerBonus(staat.alleSelecties, staat.inst);
  geef(berekenStand(staat.alleSelecties, staat.resultaten, null, staat.deelnemers, bonus), "geel");
  geef(berekenStand(staat.alleSelecties, staat.resultaten, null, staat.deelnemers, new Map(), "eendags"), "groen");
  geef(berekenStand(staat.alleSelecties, staat.resultaten, null, staat.deelnemers, new Map(), "meerdaags"), "bolletjes");
  return dragers;
}
