// Versie van de losse statische bestanden van de shell (public/shell/*). Die staan buiten
// de Next-bundel en hebben dus geen hash in hun naam; Vercel geeft public/ standaard
// "max-age=0, must-revalidate", waardoor de browser ze bij elke paginalading opnieuw
// controleert.
//
// Met ?v=<commit> aan de URL zet next.config.ts er een lange cache op: elke deploy heeft een
// nieuwe commit en dus een nieuwe URL, zodat niemand na een deploy oude code houdt.
// Zonder commit-SHA (lokaal, of een deploy zonder git) blijft de URL kaal en verandert er
// niets: de lange cache geldt alleen voor URL's mét ?v=.
const VERSIE = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12);

/** "/shell/shell.js" → "/shell/shell.js?v=<commit>" (of ongewijzigd zonder commit). */
export function metVersie(url: string): string {
  return VERSIE ? `${url}?v=${encodeURIComponent(VERSIE)}` : url;
}
