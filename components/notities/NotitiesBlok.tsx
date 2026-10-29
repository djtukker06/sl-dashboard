'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { relatief } from '@/lib/dashboard/tijd';
import { weergaveTitel, type NotitieSamenvatting } from '@/lib/notities/kern';
import { notitieApi, NotitieApiFout } from '@/lib/notities/client';
import { DocIcoon } from './DocIcoon';

const AANTAL = 6;

/**
 * Blok "Scratchpad" op de klant- en projectpagina: de gekoppelde notities (gedeeld + je eigen
 * privé) en "+ Notitie", die direct een gekoppelde notitie maakt en opent. Bij een project
 * hangt de notitie ook aan de klant van het project (dat doet de API).
 */
export function NotitiesBlok({ koppeling }: { koppeling: { klant: string } | { project: string } }) {
  const router = useRouter();
  const [lijst, setLijst] = useState<NotitieSamenvatting[] | null>(null);
  const [meer, setMeer] = useState(false);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);
  /** Nieuwe notitie maken mislukt: apart van het laden, zodat de lijst blijft staan. */
  const [maakFout, setMaakFout] = useState('');
  const klant = 'klant' in koppeling ? koppeling.klant : undefined;
  const project = 'project' in koppeling ? koppeling.project : undefined;
  const alles = `/scratchpad?${klant ? `klant=${klant}` : `project=${project}`}`;

  useEffect(() => {
    let weg = false;
    notitieApi
      .lijst({ klant, project, limiet: AANTAL + 1 })
      .then((r) => {
        if (weg) return;
        setLijst(r.notities.slice(0, AANTAL));
        setMeer(r.notities.length > AANTAL);
      })
      .catch((e) => {
        if (weg) return;
        setLijst([]);
        setFout(e instanceof NotitieApiFout && e.nietIngericht ? 'De Scratchpad werkt zodra migratie 0031 is uitgevoerd.' : 'Notities nu niet geladen.');
      });
    return () => {
      weg = true;
    };
  }, [klant, project]);

  async function nieuw() {
    if (bezig) return;
    setBezig(true);
    setMaakFout('');
    try {
      const { notitie } = await notitieApi.maak({ klantId: klant ?? null, projectId: project ?? null });
      router.push(`/scratchpad?n=${notitie.id}`);
    } catch (e) {
      setMaakFout(e instanceof Error ? e.message : 'Nieuwe notitie maken mislukt.');
      setBezig(false);
    }
  }

  return (
    <section className="db-kaart" aria-labelledby="kp-scratchpad">
      <header className="db-kaart-kop">
        <h2 id="kp-scratchpad" className="db-label">
          Scratchpad
        </h2>
        <button type="button" className="db-knop db-knop-klein" onClick={() => void nieuw()} disabled={bezig || !!fout}>
          {bezig ? 'Bezig…' : '+ Notitie'}
        </button>
      </header>
      <div className="db-kaart-inhoud">
        {maakFout && (
          <p className="kp-leeg" role="alert">
            {maakFout}
          </p>
        )}
        {lijst === null ? (
          <div className="db-skelet" style={{ width: '70%' }} />
        ) : fout ? (
          <p className="kp-leeg">{fout}</p>
        ) : lijst.length === 0 ? (
          <p className="kp-leeg">Nog geen notities. Leg ideeën, afspraken of een brainstorm vast met “+ Notitie”.</p>
        ) : (
          <>
            <ul className="sp-kort-lijst">
              {lijst.map((n) => (
                <li key={n.id}>
                  <Link className="sp-kort" href={`/scratchpad?n=${n.id}`}>
                    <span className="sp-item-icoon" aria-hidden="true">
                      {n.emoji ?? <DocIcoon />}
                    </span>
                    <span className="sp-kort-hoofd">
                      <span className="sp-kort-titel">{weergaveTitel(n)}</span>
                      {n.fragment && <span className="sp-kort-fragment">{n.fragment}</span>}
                    </span>
                    <span className="sp-kort-meta">
                      {n.prive ? 'privé · ' : ''}
                      {relatief(n.bewerktOp)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link className="db-kaart-link kp-meer" href={alles}>
              {meer ? 'Alle notities →' : 'In de Scratchpad →'}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
