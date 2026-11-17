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
 * Shift+Enter is een nieuwe regel. Een zelf geschreven notitie kan elk teamlid bewerken
 * (0036; potlood, Cmd/Ctrl+Enter slaat op, Escape annuleert), statusregels niet. Alleen je
 * eigen notitie kun je verwijderen.
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
  // De notitie die nu bewerkt wordt (één tegelijk) en de tekst in het tekstvak.
  const [bewerkId, setBewerkId] = useState<string | null>(null);
  const [bewerkTekst, setBewerkTekst] = useState('');
  const [bewaarBezig, setBewaarBezig] = useState(false);
  // Net opgeslagen tekst, tot router.refresh() de nieuwe notities levert.
  const [aangepast, setAangepast] = useState<Record<string, { tekst: string; bewerktOp: string | null }>>({});

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

  function begin(n: KlantNotitie) {
    setBewerkId(n.id);
    setBewerkTekst(n.tekst);
  }

  async function bewaar(n: KlantNotitie) {
    if (bewaarBezig) return;
    const t = bewerkTekst.replace(/\r\n?/g, '\n').trim();
    if (t === n.tekst) {
      setBewerkId(null);
      return;
    }
    if (!t) {
      toast('Een notitie kan niet leeg zijn. Verwijder hem als hij weg mag.', { fout: true });
      return;
    }
    setBewaarBezig(true);
    try {
      const { notitie } = await crmApi<{ notitie: KlantNotitie }>(`/api/klanten/${klantId}/notities/${n.id}`, 'PATCH', { tekst: t });
      setAangepast((a) => ({ ...a, [n.id]: { tekst: notitie.tekst, bewerktOp: notitie.bewerktOp } }));
      setBewerkId(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Niet gelukt.', { fout: true });
    } finally {
      setBewaarBezig(false);
    }
  }

  const items: Item[] = [
    ...notities
      .filter((n) => !weg.has(n.id))
      .map((n): Item => {
        const a = aangepast[n.id];
        const nieuwer = a && (a.bewerktOp ?? '') > (n.bewerktOp ?? '');
        return { soort: n.soort, op: n.op, notitie: nieuwer ? { ...n, ...a } : n };
      }),
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
            if (it.soort === 'notitie' && bewerkId === n.id) {
              return (
                <li key={n.id} className="kp-tl kp-tl-notitie">
                  <form
                    className="kp-notitie-bewerk"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void bewaar(n);
                    }}
                  >
                    <textarea
                      className="ag-veld"
                      rows={Math.min(10, Math.max(2, bewerkTekst.split('\n').length))}
                      maxLength={2000}
                      aria-label="Notitie bewerken"
                      autoFocus
                      value={bewerkTekst}
                      disabled={bewaarBezig}
                      onChange={(e) => setBewerkTekst(e.target.value)}
                      onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void bewaar(n);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setBewerkId(null);
                        }
                      }}
                    />
                    <div className="kp-notitie-voet">
                      <span className="kp-hint">Cmd/Ctrl+Enter = opslaan · Esc = annuleren</span>
                      <span className="kp-kop-acties">
                        <button type="button" className="kp-linkknop" onClick={() => setBewerkId(null)} disabled={bewaarBezig}>
                          Annuleren
                        </button>
                        <button type="submit" className="db-knop db-knop-klein" disabled={bewaarBezig || !bewerkTekst.trim()}>
                          {bewaarBezig ? 'Bezig…' : 'Opslaan'}
                        </button>
                      </span>
                    </div>
                  </form>
                </li>
              );
            }
            return (
              <li key={n.id} className={`kp-tl kp-tl-${it.soort}`}>
                {it.soort === 'status' ? <p className="kp-tl-regel">Status: {n.tekst}</p> : <p className="kp-tijdlijn-tekst">{n.tekst}</p>}
                <p className="kp-tijdlijn-meta">
                  <Persoon id={n.door} />
                  <span>
                    {korteDatum(n.op)}
                    {it.soort === 'notitie' && n.bewerktOp && <span title={`Bewerkt ${korteDatum(n.bewerktOp)}`}> · bewerkt</span>}
                  </span>
                  {it.soort === 'notitie' && (
                    <button type="button" className="kp-inline-potlood kp-tl-potlood" aria-label="Notitie bewerken" title="Notitie bewerken" onClick={() => begin(n)}>
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                        <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
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
