'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Klein gedrag van de shell dat bij elke navigatie hoort (geen eigen markup):
//   - tabrijen die horizontaal scrollen (Boekhouding, uitgaven, klanten, .sl-tabrij; zie
//     app.css "subnavigatie"): het actieve tabblad in beeld schuiven, anders staat bv.
//     "Instellingen" op een telefoon buiten beeld terwijl je er wel op zit.
const RIJEN = '.bh-tabs, .ug-tabs, .kl-tabs, .sl-tabrij';
const ACTIEF = '[aria-current="page"], [aria-selected="true"], .is-aan';

function actieveTabsInBeeld() {
  for (const rij of document.querySelectorAll<HTMLElement>(RIJEN)) {
    if (rij.scrollWidth <= rij.clientWidth) continue;
    const tab = rij.querySelector<HTMLElement>(ACTIEF);
    if (!tab) continue;
    // Alleen de rij zelf scrollen (scrollIntoView zou ook de pagina kunnen verschuiven).
    const r = rij.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left >= r.left + 16 && t.right <= r.right - 28) continue;
    rij.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }
}

export function ShellGedrag() {
  const pad = usePathname();
  useEffect(() => {
    // De nieuwe pagina staat er soms pas een frame later (streaming): twee pogingen.
    const f = requestAnimationFrame(actieveTabsInBeeld);
    const t = window.setTimeout(actieveTabsInBeeld, 400);
    return () => {
      cancelAnimationFrame(f);
      window.clearTimeout(t);
    };
  }, [pad]);
  return null;
}
