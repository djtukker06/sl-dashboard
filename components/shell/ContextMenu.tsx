'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// Rechtsklikmenu voor het hele dashboard (mail, agenda, …). Eén menu tegelijk, in de shell
// (app/(app)/layout.tsx); een scherm vraagt het met useContextMenu():
//
//   const menu = useContextMenu();
//   <li onContextMenu={(e) => menu(e, [{ label: 'Openen', onKies: … }, 'lijn', …])}>
//
// Gedrag zoals je het van Mail, Agenda en Finder kent:
//   - opent bij de muis en klapt om aan de rand van het scherm; submenu's rechts ernaast;
//   - het aangeklikte item blijft gemarkeerd (data-menu-open) zolang het menu open staat;
//   - toetsen: ↑ ↓ Home End, Enter/spatie, → opent een submenu, ← of Esc sluit; een letter
//     springt naar het item dat ermee begint. Shift+F10 / de menutoets opent het ook;
//   - een klik, rechtsklik of scroll ernaast sluit het menu en gaat gewoon door: rechtsklik op iets
//     anders opent meteen dat menu;
//   - het gewone browsermenu blijft waar je het nodig hebt: in tekstvelden, op geselecteerde
//     tekst, op links, en altijd met Shift+rechtsklik.

export interface MenuItem {
  label: string;
  icoon?: React.ReactNode;
  /** Sneltoets als geheugensteun rechts (bv. "r"); het menu voert hem niet zelf uit. */
  toets?: string;
  /** Verwijderen e.d.: rood. */
  gevaar?: boolean;
  uit?: boolean;
  /** Aan/uit-keuze: toont een vinkje (true) of een lege plek (false). */
  vink?: boolean;
  onKies?: () => void;
  sub?: MenuRegel[];
}
/** Een item, een scheidingslijn, een kopje, of niets (handig voor `voorwaarde && item`). */
export type MenuRegel = MenuItem | 'lijn' | { kop: string } | false | null | undefined;
type Regel = MenuItem | 'lijn' | { kop: string };

export type OpenMenu = (e: React.MouseEvent<HTMLElement>, regels: MenuRegel[]) => void;

const Ctx = createContext<OpenMenu>(() => {});

export function useContextMenu(): OpenMenu {
  return useContext(Ctx);
}

const isItem = (r: Regel): r is MenuItem => r !== 'lijn' && !('kop' in r);

/** Lege regels eruit, en geen lijn aan het begin, aan het eind of twee achter elkaar. */
function opschonen(regels: MenuRegel[]): Regel[] {
  const uit: Regel[] = [];
  for (const r of regels) {
    if (!r) continue;
    if (r === 'lijn' && (!uit.length || uit[uit.length - 1] === 'lijn')) continue;
    uit.push(r);
  }
  while (uit[uit.length - 1] === 'lijn') uit.pop();
  return uit;
}

/** Hier hoort het menu van de browser te blijven (plakken, link openen in nieuw tabblad, kopiëren). */
function wilBrowserMenu(e: React.MouseEvent<HTMLElement>): boolean {
  // Shift+rechtsklik; niet Shift+F10, dat is juist de toets voor dit menu.
  if (e.shiftKey && e.button === 2) return true;
  const doel = e.target as HTMLElement;
  if (doel.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href]')) return true;
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim() && sel.anchorNode && e.currentTarget.contains(sel.anchorNode));
}

type Staat = { regels: Regel[]; x: number; y: number; pad: string; nr: number };

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const pad = usePathname();
  const [staat, setStaat] = useState<Staat | null>(null);
  const bron = useRef<HTMLElement | null>(null);
  const focusVoor = useRef<HTMLElement | null>(null);
  const nr = useRef(0);

  const sluit = useCallback((focusTerug = false) => {
    bron.current?.removeAttribute('data-menu-open');
    bron.current = null;
    const f = focusVoor.current;
    focusVoor.current = null;
    setStaat(null);
    if (focusTerug && f && document.contains(f)) f.focus({ preventScroll: true });
  }, []);

  const open = useCallback<OpenMenu>(
    (e, invoer) => {
      if (wilBrowserMenu(e)) return;
      const regels = opschonen(invoer);
      if (!regels.some(isItem)) return;
      e.preventDefault();
      // Het binnenste element wint (een afspraak in een dagkolom: het menu van de afspraak).
      e.stopPropagation();
      let { clientX: x, clientY: y } = e;
      if (!x && !y) {
        // Met het toetsenbord geopend: bij het element zelf.
        const r = e.currentTarget.getBoundingClientRect();
        x = r.left + Math.min(24, r.width / 2);
        y = r.top + Math.min(r.height, 28);
      }
      bron.current?.removeAttribute('data-menu-open');
      bron.current = e.currentTarget;
      bron.current.setAttribute('data-menu-open', '');
      const actief = document.activeElement;
      if (!focusVoor.current) focusVoor.current = actief instanceof HTMLElement && actief !== document.body ? actief : null;
      setStaat({ regels, x, y, pad, nr: ++nr.current });
    },
    [pad]
  );

  // Sluiten: een klik, rechtsklik of scroll buiten het menu (waar dan ook op de pagina), of
  // het venster kwijt of van formaat veranderd. De klik zelf gaat gewoon door: klik je op een
  // ander bericht, dan opent dat; rechtsklik je ergens anders, dan opent daar het nieuwe menu.
  // Op document in de capture-fase, zodat niets op de pagina het kan tegenhouden.
  const openNu = staat !== null;
  useEffect(() => {
    if (!openNu) return;
    const weg = () => sluit();
    const buiten = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest('.sl-menu')) sluit();
    };
    document.addEventListener('pointerdown', buiten, true);
    document.addEventListener('contextmenu', buiten, true);
    document.addEventListener('wheel', buiten, { capture: true, passive: true });
    window.addEventListener('blur', weg);
    window.addEventListener('resize', weg);
    return () => {
      document.removeEventListener('pointerdown', buiten, true);
      document.removeEventListener('contextmenu', buiten, true);
      document.removeEventListener('wheel', buiten, true);
      window.removeEventListener('blur', weg);
      window.removeEventListener('resize', weg);
    };
  }, [openNu, sluit]);

  // Naar een andere pagina: het menu vervalt (zonder effect: de staat onthoudt zijn pagina).
  const tonen = staat && staat.pad === pad ? staat : null;

  return (
    <Ctx.Provider value={open}>
      {children}
      {tonen && <Menu key={tonen.nr} regels={tonen.regels} punt={tonen} focus onKlaar={sluit} />}
    </Ctx.Provider>
  );
}

const RAND = 8;

function Menu({
  regels,
  punt,
  naast,
  focus,
  onKlaar,
  onTerug,
  onBinnen
}: {
  regels: Regel[];
  /** Hoofdmenu: de plek van de muis. */
  punt?: { x: number; y: number };
  /** Submenu: het item waar het naast hoort. */
  naast?: DOMRect;
  /** Meteen de focus pakken (hoofdmenu, of een submenu dat met het toetsenbord openging). */
  focus?: boolean;
  /** Alles sluiten; true = de focus terug naar waar hij was. */
  onKlaar: (focusTerug?: boolean) => void;
  /** Alleen dit submenu sluiten. */
  onTerug?: () => void;
  /** De muis is in dit submenu: het hoofdmenu houdt het open. */
  onBinnen?: () => void;
}) {
  const id = useId();
  const doos = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actief, setActief] = useState(focus && naast ? regels.findIndex((r) => isItem(r) && !r.uit) : -1);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; focus: boolean } | null>(null);
  const metIcoon = regels.some((r) => isItem(r) && (r.icoon || r.vink !== undefined));

  // Plaatsen binnen het scherm. Rechtstreeks op het element (geen extra render, geen flits).
  useLayoutEffect(() => {
    const el = doos.current;
    if (!el) return;
    const { width: b, height: h } = el.getBoundingClientRect();
    const vb = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let links: number;
    let boven: number;
    let vanRechts = false;
    let vanOnder = false;
    if (naast) {
      links = naast.right - 3;
      if (links + b > vb - RAND) {
        links = naast.left - b + 3;
        vanRechts = true;
      }
      boven = naast.top - 5;
    } else {
      links = punt!.x + 1;
      boven = punt!.y + 1;
      if (links + b > vb - RAND) {
        links = punt!.x - b;
        vanRechts = true;
      }
      if (boven + h > vh - RAND && punt!.y - h >= RAND) {
        boven = punt!.y - h;
        vanOnder = true;
      }
    }
    el.style.left = `${Math.max(RAND, Math.min(links, vb - b - RAND))}px`;
    el.style.top = `${Math.max(RAND, Math.min(boven, vh - h - RAND))}px`;
    el.style.transformOrigin = `${vanRechts ? 'right' : 'left'} ${vanOnder ? 'bottom' : 'top'}`;
    if (focus) el.focus({ preventScroll: true });
  }, [naast, punt, focus]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const straks = (f: (() => void) | null, ms = 0) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = f ? setTimeout(f, ms) : null;
  };

  const openSub = (i: number, metFocus: boolean) => {
    const el = doos.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (el) setSub({ index: i, rect: el.getBoundingClientRect(), focus: metFocus });
  };
  const sluitSub = (focusHier: boolean) => {
    setSub(null);
    if (focusHier) doos.current?.focus({ preventScroll: true });
  };

  const kies = (i: number, viaToets: boolean) => {
    const r = regels[i];
    if (!r || !isItem(r) || r.uit) return;
    if (r.sub) {
      straks(null);
      if (sub?.index === i && !viaToets) sluitSub(true);
      else openSub(i, viaToets);
      return;
    }
    // Eerst sluiten (focus terug), dan de actie: die opent vaak zelf een venster met focus.
    onKlaar(true);
    r.onKies?.();
  };

  const stap = (richting: 1 | -1, vanaf = actief) => {
    const n = regels.length;
    for (let k = 1; k <= n; k++) {
      const i = (((vanaf + richting * k) % n) + n) % n;
      const r = regels[i];
      if (isItem(r) && !r.uit) {
        setActief(i);
        doos.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  };

  function toetsen(e: React.KeyboardEvent) {
    // Niets lekt naar de sneltoetsen van de pagina (j/k, r, e, …) zolang het menu open is.
    e.stopPropagation();
    if (e.target !== e.currentTarget) return;
    const huidig = regels[actief];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        stap(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        stap(-1, actief < 0 ? 0 : actief);
        break;
      case 'Home':
        e.preventDefault();
        stap(1, -1);
        break;
      case 'End':
        e.preventDefault();
        stap(-1, 0);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (actief >= 0) kies(actief, true);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (huidig && isItem(huidig) && huidig.sub && !huidig.uit) kies(actief, true);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onTerug?.();
        break;
      case 'Escape':
        e.preventDefault();
        if (onTerug) onTerug();
        else onKlaar(true);
        break;
      case 'Tab':
        e.preventDefault();
        onKlaar(true);
        break;
      default:
        // Een letter: naar het volgende item dat ermee begint.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          const letter = e.key.toLowerCase();
          const n = regels.length;
          for (let k = 1; k <= n; k++) {
            const i = (Math.max(actief, -1) + k) % n;
            const r = regels[i];
            if (isItem(r) && !r.uit && r.label.toLowerCase().startsWith(letter)) {
              setActief(i);
              break;
            }
          }
        }
    }
  }

  const subRegel = sub ? regels[sub.index] : null;

  return (
    <>
      <div
        ref={doos}
        className={`sl-menu${metIcoon ? ' sl-menu-iconen' : ''}`}
        role="menu"
        tabIndex={-1}
        aria-activedescendant={actief >= 0 ? `${id}-${actief}` : undefined}
        onKeyDown={toetsen}
        onContextMenu={(e) => e.preventDefault()}
        onPointerEnter={onBinnen}
        onPointerLeave={() => {
          if (!sub) setActief(-1);
        }}
      >
        {regels.map((r, i) => {
          if (r === 'lijn') return <div key={i} className="sl-menu-lijn" role="separator" />;
          if (!isItem(r)) {
            return (
              <div key={i} className="sl-menu-kop" role="presentation">
                {r.kop}
              </div>
            );
          }
          const open = sub?.index === i;
          return (
            <div
              key={i}
              id={`${id}-${i}`}
              data-i={i}
              role={r.vink !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={r.vink}
              aria-disabled={r.uit || undefined}
              aria-haspopup={r.sub ? 'menu' : undefined}
              aria-expanded={r.sub ? open : undefined}
              className={`sl-menu-item${i === actief || open ? ' is-actief' : ''}${r.gevaar ? ' is-gevaar' : ''}`}
              onPointerMove={(e) => {
                if (e.pointerType === 'touch') return;
                if (actief !== i) setActief(i);
                if (r.sub && !r.uit) {
                  if (!open) straks(() => openSub(i, false), 110);
                  else straks(null);
                } else if (sub) straks(() => sluitSub(false), 220);
              }}
              onClick={() => kies(i, false)}
            >
              {metIcoon && (
                <span className="sl-menu-icoon" aria-hidden="true">
                  {r.vink ? <Vink /> : r.icoon}
                </span>
              )}
              <span className="sl-menu-label">{r.label}</span>
              {r.toets && <kbd className="sl-menu-toets">{r.toets}</kbd>}
              {r.sub && (
                <svg className="sl-menu-pijl" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      {sub && subRegel && isItem(subRegel) && subRegel.sub && (
        <Menu
          key={sub.index}
          regels={opschonen(subRegel.sub)}
          naast={sub.rect}
          focus={sub.focus}
          onKlaar={onKlaar}
          onTerug={() => sluitSub(true)}
          onBinnen={() => {
            straks(null);
            setActief(sub.index);
          }}
        />
      )}
    </>
  );
}

function Vink() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15">
      <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Lijn-iconen voor menu's buiten Mail (dat heeft zijn eigen set), zelfde stijl als de rail.
const PADEN = {
  open: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  video: '<rect x="3" y="6.5" width="12" height="11" rx="2"/><path d="m15 10.5 5-3v9l-5-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  kopie: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  bel: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  prullenbak: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  taak: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
  kalender: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
  pijl: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  herstel: '<path d="M4 8v-4"/><path d="M4 8h4"/><path d="M4.5 8A8 8 0 1 1 4 12"/>',
  dag: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'
} as const;

export function MenuIcoon({ naam }: { naam: keyof typeof PADEN }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: PADEN[naam] }}
    />
  );
}
