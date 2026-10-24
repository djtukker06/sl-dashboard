'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import { Persoon } from '@/components/team/Persoon';
import { useTeam } from '@/components/team/TeamProvider';
import { korteDatum } from '@/lib/dashboard/tijd';
import { formatEuro } from '@/lib/format';
import type { KlantNotitie } from '@/lib/crm/types';
import { crmApi } from './CrmDialoog';

export interface TijdlijnFactuur {
  id: string;
  nummer: string;
  datum: string;
  totaal: number;
  open: boolean;
}

type Item =
  | { soort: 'notitie' | 'status'; op: string; notitie: KlantNotitie }
  | { soort: 'factuur'; op: string; factuur: TijdlijnFactuur }
  | { soort: 'start'; op: string };

const EERST_TONEN = 12;

/**
 * Tijdlijn van een klant: zelf geschreven notities, statuswijzigingen (0025), facturen en
 * wanneer de klant is aangemaakt, nieuwste eerst. Bovenaan een notitieveld: Enter slaat op,
 * Shift+Enter is een nieuwe regel. Alleen je eigen notitie kun je verwijderen.
 */
export function KlantTijdlijn({
  klantId,
  notities,
  facturen,
  aangemaakt
}: {
  klantId: string;
  notities: KlantNotitie[];
  facturen: TijdlijnFactuur[];
  aangemaakt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { mijnId } = useTeam();
  const [tekst, setTekst] = useState('');
  const [bezig, setBezig] = useState(false);
  const [weg, setWeg] = useState<Set<string>>(new Set());
  const [alles, setAlles] = useState(false);

  async function voegToe(e?: React.FormEvent) {
    e?.preventDefault();
    if (!tekst.trim() || bezig) return;
    setBezig(true);
    try {
      await crmApi(`/api/klanten/${klantId}/notities`, 'POST', { tekst });
      setTekst('');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Niet gelukt.', { fout: true });
    } finally {
      setBezig(false);
    }
  }

  async function verwijder(n: KlantNotitie) {
    setWeg((s) => new Set(s).add(n.id));
    try {
      await crmApi(`/api/klanten/${klantId}/notities/${n.id}`, 'DELETE');
      router.refresh();
    } catch (err) {
      setWeg((s) => {
        const x = new Set(s);
        x.delete(n.id);
        return x;
      });
      toast(err instanceof Error ? err.message : 'Niet gelukt.', { fout: true });
    }
  }

  const items: Item[] = [
    ...notities.filter((n) => !weg.has(n.id)).map((n): Item => ({ soort: n.soort, op: n.op, notitie: n })),
    ...facturen.filter((f) => f.datum).map((f): Item => ({ soort: 'factuur', op: `${f.datum}T12:00:00`, factuur: f })),
    ...(aangemaakt ? [{ soort: 'start', op: aangemaakt } as Item] : [])
  ].sort((a, b) => (a.op < b.op ? 1 : a.op > b.op ? -1 : 0));
  const zichtbaar = alles ? items : items.slice(0, EERST_TONEN);

  return (
    <div className="kp-notities">
      <form className="kp-notitie-nieuw" onSubmit={voegToe}>
        <textarea
          className="ag-veld"
          rows={2}
          maxLength={2000}
          placeholder="Notitie, bv. Gebeld over de offerte, belt volgende week terug"
          aria-label="Nieuwe notitie"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void voegToe();
            }
          }}
        />
        <div className="kp-notitie-voet">
          <span className="kp-hint">Enter = opslaan · Shift+Enter = nieuwe regel</span>
          <button type="submit" className="db-knop db-knop-klein" disabled={bezig || !tekst.trim()}>
            {bezig ? 'Bezig…' : 'Notitie toevoegen'}
          </button>
        </div>
      </form>
      {items.length === 0 ? (
        <p className="kp-leeg">Nog niets gebeurd. Schrijf hierboven wat je met de klant besprak.</p>
      ) : (
        <ol className="kp-tijdlijn">
          {zichtbaar.map((it) => {
            if (it.soort === 'factuur') {
              const f = it.factuur;
              return (
                <li key={`f-${f.id}`} className="kp-tl kp-tl-factuur">
                  <p className="kp-tl-regel">
                    <Link href={`/facturen/${f.id}/bewerken`}>Factuur {f.nummer}</Link>
                    <span className="kp-tl-bedrag">€ {formatEuro(f.totaal)}</span>
                    {f.open && <span className="kp-badge is-binnenkort">aanbetaling open</span>}
                  </p>
                  <p className="kp-tijdlijn-meta">
                    <span>{korteDatum(it.op)}</span>
                  </p>
                </li>
              );
            }
            if (it.soort === 'start') {
              return (
                <li key="start" className="kp-tl kp-tl-status">
                  <p className="kp-tl-regel kp-zacht">Klant aangemaakt</p>
                  <p className="kp-tijdlijn-meta">
                    <span>{korteDatum(it.op)}</span>
                  </p>
                </li>
              );
            }
            const n = it.notitie;
            return (
              <li key={n.id} className={`kp-tl kp-tl-${it.soort}`}>
                {it.soort === 'status' ? <p className="kp-tl-regel">Status: {n.tekst}</p> : <p className="kp-tijdlijn-tekst">{n.tekst}</p>}
                <p className="kp-tijdlijn-meta">
                  <Persoon id={n.door} />
                  <span>{korteDatum(n.op)}</span>
                  {n.door === mijnId && it.soort === 'notitie' && (
                    <button type="button" className="kp-linkknop" onClick={() => void verwijder(n)}>
                      Verwijderen
                    </button>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > EERST_TONEN && (
        <button type="button" className="kp-linkknop" onClick={() => setAlles(!alles)}>
          {alles ? 'Minder tonen' : `Toon alle ${items.length}`}
        </button>
      )}
    </div>
  );
}
