'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { typtIn } from '@/lib/agenda/client';
import type { Taak } from '@/lib/agenda/types';
import { TaakDialoog, type TaakStandaard } from './TaakDialoog';

// De taak-popup, één keer per pagina (dashboard, agenda, projecten). Elke knop "+ Taak",
// elke taakregel en de sneltoets n openen hem via useTaakDialoog(); lijsten die moeten
// verversen na een wijziging luisteren met useTaakGebeurtenis().
// Vereist een <ToastProvider> erboven (meldingen na opslaan).

export type TaakGebeurtenis =
  | { soort: 'aangemaakt'; taak: Taak }
  | { soort: 'gewijzigd'; taak: Taak }
  | { soort: 'verwijderd'; id: string };

interface Ctx {
  /** Nieuwe taak, eventueel met voorinvulling (dag/tijd vanuit de agenda, klant, project). */
  nieuw: (standaard?: TaakStandaard) => void;
  /** Bestaande taak openen (bekijken/bewerken). */
  open: (id: string) => void;
  abonneer: (fn: (e: TaakGebeurtenis) => void) => () => void;
}

const TakenCtx = createContext<Ctx | null>(null);

type Staat = { modus: 'nieuw'; standaard?: TaakStandaard; sleutel: number } | { modus: 'bewerk'; id: string; sleutel: number };

export function TakenProvider({ children, sneltoets = true }: { children: React.ReactNode; sneltoets?: boolean }) {
  const [staat, setStaat] = useState<Staat | null>(null);
  const teller = useRef(0);
  const luisteraars = useRef(new Set<(e: TaakGebeurtenis) => void>());

  const nieuw = useCallback((standaard?: TaakStandaard) => {
    setStaat({ modus: 'nieuw', standaard, sleutel: ++teller.current });
  }, []);
  const open = useCallback((id: string) => {
    setStaat({ modus: 'bewerk', id, sleutel: ++teller.current });
  }, []);
  const abonneer = useCallback((fn: (e: TaakGebeurtenis) => void) => {
    luisteraars.current.add(fn);
    return () => {
      luisteraars.current.delete(fn);
    };
  }, []);
  const meld = useCallback((e: TaakGebeurtenis) => {
    luisteraars.current.forEach((f) => f(e));
  }, []);
  const sluit = useCallback(() => setStaat(null), []);

  // n = nieuwe taak (niet tijdens typen of als er al een venster/paneel open is).
  useEffect(() => {
    if (!sneltoets) return;
    function toets(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typtIn(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      nieuw();
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [sneltoets, nieuw]);

  const waarde = useMemo(() => ({ nieuw, open, abonneer }), [nieuw, open, abonneer]);

  return (
    <TakenCtx.Provider value={waarde}>
      {children}
      {staat && (
        <TaakDialoog
          key={staat.sleutel}
          modus={staat.modus}
          taakId={staat.modus === 'bewerk' ? staat.id : null}
          standaard={staat.modus === 'nieuw' ? staat.standaard : undefined}
          onSluit={sluit}
          onGebeurtenis={meld}
          onOpen={open}
        />
      )}
    </TakenCtx.Provider>
  );
}

export function useTaakDialoog(): Pick<Ctx, 'nieuw' | 'open'> {
  const c = useContext(TakenCtx);
  if (!c) throw new Error('useTaakDialoog vereist een <TakenProvider>.');
  return c;
}

/** Luistert naar aangemaakte, gewijzigde en verwijderde taken (om lijsten bij te werken). */
export function useTaakGebeurtenis(fn: (e: TaakGebeurtenis) => void) {
  const c = useContext(TakenCtx);
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  useEffect(() => {
    if (!c) return;
    return c.abonneer((e) => ref.current(e));
  }, [c]);
}
