'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { BEDRAG_RE, PRIVACY_ATTR, PRIVACY_SLEUTEL } from '@/lib/shell/privacy';

// Privacymodus ("cijfers verbergen", zie lib/shell/privacy.ts). Zolang hij aan staat, zoekt
// deze component in de pagina naar tekst met een bedrag en zet op het element eromheen
// data-sl-bedrag; app.css vervaagt die elementen tot de modus weer uit staat. Zo hoeft geen
// enkel scherm zelf iets te weten van de privacymodus, ook nieuwe schermen niet.
// Aan/uit: de oog-knop in de rail, "Cijfers verbergen" in het accountmenu of ⌥⇧P.

const BEDRAG_ATTR = 'data-sl-bedrag';
/** Langere tekst (uitleg met bv. "vanaf € 450") blijft leesbaar; korte waarden worden vaag. */
const MAX_LENGTE = 80;

const luisteraars = new Set<() => void>();
const isAan = () => document.documentElement.hasAttribute(PRIVACY_ATTR);

function abonneer(f: () => void) {
  luisteraars.add(f);
  return () => {
    luisteraars.delete(f);
  };
}

function zet(aan: boolean) {
  document.documentElement.toggleAttribute(PRIVACY_ATTR, aan);
  try {
    if (aan) localStorage.setItem(PRIVACY_SLEUTEL, '1');
    else localStorage.removeItem(PRIVACY_SLEUTEL);
  } catch {
    /* geen opslag (privévenster): alleen voor deze pagina */
  }
  for (const f of luisteraars) f();
}

export function wisselPrivacy() {
  zet(!isAan());
}

/** Markeert alle elementen met een bedrag in `wortel` (en haalt verouderde markeringen weg). */
function markeer(wortel: HTMLElement) {
  const nu = new Set<Element>();
  const loper = document.createTreeWalker(wortel, NodeFilter.SHOW_TEXT);
  for (let n = loper.nextNode(); n; n = loper.nextNode()) {
    const el = n.parentElement;
    if (!el || nu.has(el) || !n.nodeValue || !BEDRAG_RE.test(n.nodeValue)) continue;
    if (el.closest('script, style, textarea, [contenteditable="true"]')) continue;
    if ((el.textContent ?? '').length > MAX_LENGTE) continue;
    nu.add(el);
  }
  for (const el of wortel.querySelectorAll(`[${BEDRAG_ATTR}]`)) if (!nu.has(el)) el.removeAttribute(BEDRAG_ATTR);
  for (const el of nu) if (!el.hasAttribute(BEDRAG_ATTR)) el.setAttribute(BEDRAG_ATTR, '');
}

function usePrivacy() {
  return useSyncExternalStore(abonneer, isAan, () => false);
}

/** Gedrag zonder eigen markup: sneltoets en het bijhouden van de bedragen in de pagina. */
export function PrivacyGedrag() {
  const aan = usePrivacy();

  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyP') {
        e.preventDefault();
        wisselPrivacy();
      }
    };
    window.addEventListener('keydown', toets);
    return () => window.removeEventListener('keydown', toets);
  }, []);

  useEffect(() => {
    if (!aan) return;
    const wortel = document.querySelector<HTMLElement>('.sl-main');
    if (!wortel) return;
    markeer(wortel);
    let frame = 0;
    const waarnemer = new MutationObserver((lijst) => {
      // Onze eigen attributen veroorzaken geen mutaties in deze waarnemer (geen attributes: true).
      if (frame || !lijst.length) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        markeer(wortel);
      });
    });
    waarnemer.observe(wortel, { childList: true, subtree: true, characterData: true });
    return () => {
      waarnemer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [aan]);

  return null;
}

function OogIcoon({ dicht }: { dicht: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dicht ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1" />
          <path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/** De oog-knop in de rail (desktop) of de regel in het accountmenu (`menu`). */
export function PrivacyKnop({ menu = false }: { menu?: boolean }) {
  const aan = usePrivacy();
  const label = aan ? 'Cijfers tonen' : 'Cijfers verbergen';
  if (menu) {
    return (
      <button type="button" className="sl-account-link sl-privacy-regel" aria-pressed={aan} onClick={wisselPrivacy}>
        <OogIcoon dicht={aan} />
        <span>{label}</span>
        <kbd>⌥⇧P</kbd>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="sl-privacy-knop"
      aria-pressed={aan}
      aria-label={label}
      title={`${label} (⌥⇧P)`}
      onClick={wisselPrivacy}
    >
      <OogIcoon dicht={aan} />
    </button>
  );
}
