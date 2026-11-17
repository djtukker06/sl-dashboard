'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import { volgendeCheck } from '@/lib/boekhouding/kern/betaalcheck';
import { BETAALD_EVENT, BetaalFormulier, type BankKeuze } from './BetaalFormulier';

// Betaalcheck (migratie 0037): een week na versturen vraagt de app op elke pagina "Is factuur
// 26-023 van SeamX LLC (€ 3.312,25) betaald?". Eén vraag tegelijk; de rest staat in de rij
// ("1 van 3"). Wat er gevraagd wordt bepaalt de server (GET /api/facturen/betaalcheck).
//   Ja    → datum (en rekening) kiezen; de betaling wordt geboekt en aan de factuur gekoppeld.
//   Nee   → over 7 dagen opnieuw vragen (invoices.betaalcheck_na). Vóór 0037 onthoudt dit
//           apparaat het (localStorage), zodat hij niet elke pagina terugkomt.
//   Later → weg tot morgen (op dit apparaat).
// Zonder vinkje Boekhouding antwoordt de server 403: dan blijft de pop-up gewoon weg.

interface Item {
  id: string;
  nummer: string;
  klant: string;
  totaal: number;
  open: number;
  deels: boolean;
  verstuurd: Datum;
}

const LATER_SLEUTEL = 'sl-betaalcheck-later';
const NEE_SLEUTEL = 'sl-betaalcheck-nee';

function lees(sleutel: string): string | null {
  try {
    return localStorage.getItem(sleutel);
  } catch {
    return null;
  }
}
function schrijf(sleutel: string, waarde: string) {
  try {
    localStorage.setItem(sleutel, waarde);
  } catch {
    /* geen opslag (privévenster): alleen voor deze pagina */
  }
}

/** Lokaal uitgestelde facturen (alleen vóór 0037): id → opnieuw vragen vanaf. */
function lokaalNee(vandaag: Datum): Record<string, Datum> {
  try {
    const m = JSON.parse(lees(NEE_SLEUTEL) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(m).filter((e): e is [string, Datum] => typeof e[1] === 'string' && e[1] > vandaag));
  } catch {
    return {};
  }
}

export function BetaalCheck() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [rekeningen, setRekeningen] = useState<BankKeuze[]>([]);
  const [vandaag, setVandaag] = useState<Datum | null>(null);
  const [stap, setStap] = useState<'vraag' | 'ja'>('vraag');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [klaar, setKlaar] = useState<string | null>(null);
  const [dicht, setDicht] = useState(false);

  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        const res = await fetch('/api/facturen/betaalcheck', { cache: 'no-store' });
        if (!res.ok) return; // geen rechten, uitgelogd of storing: stil wegblijven
        const data = (await res.json()) as { items?: Item[]; rekeningen?: BankKeuze[]; vandaag?: Datum | null };
        if (weg || !data.vandaag || !data.items?.length) return;
        if (lees(LATER_SLEUTEL) === data.vandaag) return;
        const nee = lokaalNee(data.vandaag);
        setVandaag(data.vandaag);
        setRekeningen(data.rekeningen ?? []);
        setItems(data.items.filter((i) => !nee[i.id]));
      } catch {
        /* geen verbinding: volgende keer */
      }
    })();
    return () => {
      weg = true;
    };
  }, []);

  // Op het facturenoverzicht betaald geboekt: uit de rij halen.
  useEffect(() => {
    const af = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setItems((l) => l.filter((i) => i.id !== id));
    };
    window.addEventListener(BETAALD_EVENT, af);
    return () => window.removeEventListener(BETAALD_EVENT, af);
  }, []);

  const huidig = items[0];
  if (dicht || !huidig || !vandaag) return null;

  function volgende() {
    setItems((l) => l.slice(1));
    setStap('vraag');
    setMelding(null);
    setKlaar(null);
  }

  async function nee() {
    setBezig(true);
    setMelding(null);
    try {
      const res = await fetch('/api/facturen/betaalcheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: huidig.id })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        if (data.code !== 'kolom_ontbreekt') {
          setMelding(data.error ?? 'Opslaan mislukt. Probeer het opnieuw.');
          return;
        }
        // Vóór 0037: op dit apparaat onthouden.
        const m = lokaalNee(vandaag!);
        m[huidig.id] = volgendeCheck(vandaag!);
        schrijf(NEE_SLEUTEL, JSON.stringify(m));
      }
      volgende();
    } catch {
      setMelding('Geen verbinding. Probeer het opnieuw.');
    } finally {
      setBezig(false);
    }
  }

  function later() {
    schrijf(LATER_SLEUTEL, vandaag!);
    setDicht(true);
  }

  const titelId = `betaalcheck-${huidig.id}`;
  return (
    <aside className="betaalcheck" role="dialog" aria-labelledby={titelId} aria-live="polite">
      <div className="betaalcheck-kop">
        <span className="bh-label">Betaalcheck{items.length > 1 ? ` · 1 van ${items.length}` : ''}</span>
        <button type="button" className="betaalcheck-sluit" onClick={later} aria-label="Later (tot morgen verbergen)" title="Later">
          &times;
        </button>
      </div>
      <p id={titelId} className="betaalcheck-vraag">
        {huidig.deels ? 'Is het restant van factuur ' : 'Is factuur '}
        <strong>{huidig.nummer}</strong> van {huidig.klant} (
        <span className="betaalcheck-bedrag">{huidig.deels ? `nog ${formatCenten(huidig.open)}` : formatCenten(huidig.totaal)}</span>) betaald?
      </p>
      <p className="betaalcheck-sub">Verstuurd op {korteDatum(huidig.verstuurd)}</p>
      {klaar && <p className="betaalcheck-klaar">{klaar}</p>}
      {melding && (
        <p className="betaal-fout" role="alert">
          {melding}
        </p>
      )}
      {stap === 'vraag' ? (
        <div className="betaal-form-knoppen">
          <button type="button" className="db-knop db-knop-primair" onClick={() => setStap('ja')} disabled={bezig}>
            Ja
          </button>
          <button type="button" className="db-knop" onClick={nee} disabled={bezig} title="Over 7 dagen opnieuw vragen">
            {bezig ? 'Bezig…' : 'Nee'}
          </button>
          <button type="button" className="ag-link-knop" onClick={later} disabled={bezig}>
            Later
          </button>
        </div>
      ) : (
        <BetaalFormulier
          key={huidig.id}
          factuurId={huidig.id}
          open={huidig.open}
          rekeningen={rekeningen}
          vandaag={vandaag}
          annuleerLabel="Terug"
          onAnnuleer={() => setStap('vraag')}
          onGeboekt={() => {
            // BetaalFormulier meldt de betaling (BETAALD_EVENT): daarmee gaat hij al uit de rij.
            setStap('vraag');
            setMelding(null);
            setKlaar(`Factuur ${huidig.nummer} is als betaald geboekt.`);
            router.refresh();
          }}
        />
      )}
    </aside>
  );
}
