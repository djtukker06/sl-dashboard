'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { datumKort } from '@/lib/invoice/terugkerend-kern';

// Akkoord vooraf voor terugkerende facturen (migratie 0038): één gebundelde melding op elke
// pagina, hoeveel facturen er ook tegelijk aan de beurt zijn ("4 terugkerende facturen voor
// 1 dec wachten op akkoord"). Bekijken → het controlescherm op /facturen/terugkerend (daar
// verschijnt de melding niet). Later → weg tot morgen op dit apparaat.

interface Gevraagd {
  id: string;
  naam: string;
  datum: string;
}

const LATER_SLEUTEL = 'sl-akkoord-later';
const vandaagLokaal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());

export function AkkoordMelding() {
  const pad = usePathname() || '';
  const [gevraagd, setGevraagd] = useState<Gevraagd[]>([]);
  const [wachtend, setWachtend] = useState(0);
  const [dicht, setDicht] = useState(false);

  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        if (localStorage.getItem(LATER_SLEUTEL) === vandaagLokaal()) return;
      } catch {
        /* geen opslag: gewoon tonen */
      }
      try {
        const res = await fetch('/api/terugkerend/akkoord', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { gevraagd?: Gevraagd[]; wachtend?: unknown[] };
        if (weg) return;
        setGevraagd(data.gevraagd ?? []);
        setWachtend(data.wachtend?.length ?? 0);
      } catch {
        /* geen verbinding: stil wegblijven */
      }
    })();
    return () => {
      weg = true;
    };
  }, []);

  if (dicht || pad.startsWith('/facturen/terugkerend') || (!gevraagd.length && !wachtend)) return null;

  function later() {
    try {
      localStorage.setItem(LATER_SLEUTEL, vandaagLokaal());
    } catch {
      /* geen opslag: alleen voor deze pagina */
    }
    setDicht(true);
  }

  const data = [...new Set(gevraagd.map((g) => g.datum))];
  const wanneer = data.length === 1 ? ` voor ${datumKort(data[0])}` : '';
  const vraag =
    gevraagd.length === 1
      ? `"${gevraagd[0].naam}"${wanneer} wacht op je akkoord.`
      : gevraagd.length > 1
        ? `${gevraagd.length} terugkerende facturen${wanneer} wachten op je akkoord.`
        : '';
  const vast = wachtend === 1 ? '1 factuur is aangemaakt maar nog niet verstuurd.' : wachtend > 1 ? `${wachtend} facturen zijn aangemaakt maar nog niet verstuurd.` : '';

  return (
    <aside className="betaalcheck tk-akkoord-melding" role="status" aria-live="polite">
      <div className="betaalcheck-kop">
        <span className="bh-label">Terugkerende facturen</span>
        <button type="button" className="betaalcheck-sluit" onClick={later} aria-label="Later (tot morgen verbergen)" title="Later">
          ×
        </button>
      </div>
      {vraag && <p className="betaalcheck-vraag">{vraag}</p>}
      {vast && <p className={vraag ? 'betaalcheck-sub' : 'betaalcheck-vraag'}>{vast}</p>}
      <div className="betaal-form-knoppen">
        <Link href="/facturen/terugkerend#akkoord" className="db-knop db-knop-primair" onClick={() => setDicht(true)}>
          Bekijken
        </Link>
        <button type="button" className="ag-link-knop" onClick={later}>
          Later
        </button>
      </div>
    </aside>
  );
}
