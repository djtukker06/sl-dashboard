'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { Keuzelijst, type KeuzeOptie } from '@/components/facturen/Keuzelijst';
import { PLATFORM_LABEL, amsterdamDatum } from '@/lib/social/kern';
import {
  FILTER_STATUSSEN,
  WEEKDAG_KORT,
  groepeerVoorLijst,
  maandBereik,
  maandLabel,
  maandRaster,
  postNaam,
  postsPerDag,
  tijdVan,
  verschuifMaand
} from '@/lib/social/weergave';
import type { AccountDto, PostDto, PostsAntwoord, PostStatus } from '@/lib/social/types';
import { api, foutTekst } from './api';
import { PlatformIcoon } from './Iconen';
import { PostKaart } from './PostKaart';

type Weergave = 'lijst' | 'kalender';
const OPSLAG_SLEUTEL = 'sl-social-weergave';

// Overzicht van alle posts: lijst (gegroepeerd: komt eraan, concepten zonder datum, eerder)
// of maandkalender. Filters: kanaal, status en maand. In de kalender opent een klik op een
// lege plek van een dag een nieuwe post op die dag (19:30).
type Props = { accounts: AccountDto[]; melding: string | null; startMaand: string; startStatus: PostStatus | null };

export function Overzicht(props: Props) {
  return (
    <ToastProvider>
      <OverzichtInhoud {...props} />
    </ToastProvider>
  );
}

function OverzichtInhoud({ accounts, melding, startMaand, startStatus }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [weergave, setWeergave] = useState<Weergave>('lijst');
  const [kanaal, setKanaal] = useState<string>('');
  const [status, setStatus] = useState<PostStatus | ''>(startStatus ?? '');
  // In de lijst kan de maand ook "alles" zijn; de kalender toont altijd één maand.
  const [maand, setMaand] = useState<string>('');
  const [kalenderMaand, setKalenderMaand] = useState<string>(startMaand);
  const [posts, setPosts] = useState<PostDto[] | null>(null);
  const [dbMelding, setDbMelding] = useState<string | null>(melding);
  const [fout, setFout] = useState<string | null>(null);
  const [bezigId, setBezigId] = useState<string | null>(null);
  const [nu, setNu] = useState(() => new Date());

  // Gekozen weergave onthouden (alleen in deze browser).
  useEffect(() => {
    try {
      const w = localStorage.getItem(OPSLAG_SLEUTEL);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- eenmalig de opgeslagen keuze overnemen na hydratie
      if (w === 'kalender' || w === 'lijst') setWeergave(w);
    } catch {
      /* geen opslag: standaard lijst */
    }
  }, []);
  const kiesWeergave = (w: Weergave) => {
    setWeergave(w);
    try {
      localStorage.setItem(OPSLAG_SLEUTEL, w);
    } catch {
      /* niet erg */
    }
  };

  const actieveMaand = weergave === 'kalender' ? kalenderMaand : maand;
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (kanaal) q.set('kanaal', kanaal);
    if (actieveMaand) {
      const b = maandBereik(actieveMaand);
      q.set('van', b.van);
      q.set('tot', b.tot);
    }
    return q.toString();
  }, [status, kanaal, actieveMaand]);

  const laad = useCallback(async () => {
    try {
      const r = await api<PostsAntwoord>(`/api/social/posts${query ? `?${query}` : ''}`);
      setPosts(r.posts);
      setDbMelding(r.melding ?? null);
      setFout(null);
      setNu(new Date());
    } catch (e) {
      setFout(foutTekst(e));
    }
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ophalen bij een ander filter
    void laad();
  }, [laad]);

  // Zolang er iets ingepland of bezig is: elke minuut verversen (statussen veranderen vanzelf).
  useEffect(() => {
    if (!posts?.some((p) => p.status === 'ingepland' || p.status === 'bezig')) return;
    const t = setInterval(() => void laad(), 60_000);
    return () => clearInterval(t);
  }, [posts, laad]);

  async function opnieuw(p: PostDto) {
    if (!window.confirm('Deze post nu opnieuw proberen te plaatsen?')) return;
    setBezigId(p.id);
    try {
      const r = await api<{ status: string; fouten: string[] }>(`/api/social/posts/${p.id}/nu`, { method: 'POST' });
      if (r.status === 'geplaatst') toast('Geplaatst.');
      else toast(r.fouten[0] ?? (r.status === 'deels' ? 'Deels geplaatst.' : 'Plaatsen is weer niet gelukt.'), { fout: r.status !== 'deels' });
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    } finally {
      setBezigId(null);
      void laad();
    }
  }

  const maandOpties: KeuzeOptie<string>[] = useMemo(() => {
    const basis = amsterdamDatum(new Date()).slice(0, 7);
    const lijst: KeuzeOptie<string>[] = [{ waarde: 'alles', label: 'Alle maanden' }];
    for (let i = 6; i >= -12; i--) {
      const m = verschuifMaand(basis, i);
      lijst.push({ waarde: m, label: maandLabel(m) });
    }
    return lijst;
  }, []);

  const kanaalOpties: KeuzeOptie<string>[] = [
    { waarde: 'alle', label: 'Alle kanalen' },
    ...accounts.map((a) => ({ waarde: a.id, label: a.naam || a.gebruikersnaam || PLATFORM_LABEL[a.platform], sub: PLATFORM_LABEL[a.platform] }))
  ];
  const statusOpties: KeuzeOptie<string>[] = [{ waarde: 'alle', label: 'Alle statussen' }, ...FILTER_STATUSSEN.map((s) => ({ waarde: s.waarde, label: s.label }))];

  return (
    <div className="so-inhoud">
      {dbMelding && (
        <p className="so-melding" role="status">
          <strong>Social is nog niet ingericht.</strong> {dbMelding}
        </p>
      )}
      {!dbMelding && accounts.length === 0 && (
        <p className="so-melding is-zacht" role="status">
          Nog geen kanaal gekoppeld. Je kunt al concepten maken; om te plaatsen koppel je eerst Instagram of Facebook via{' '}
          <Link href="/social/koppelingen">Koppelingen</Link>.
        </p>
      )}

      <div className="so-balk">
        <div className="ag-segment" role="group" aria-label="Weergave">
          <button type="button" className={weergave === 'lijst' ? 'is-aan' : ''} aria-pressed={weergave === 'lijst'} onClick={() => kiesWeergave('lijst')}>
            Lijst
          </button>
          <button type="button" className={weergave === 'kalender' ? 'is-aan' : ''} aria-pressed={weergave === 'kalender'} onClick={() => kiesWeergave('kalender')}>
            Kalender
          </button>
        </div>
        <div className="so-filters">
          {accounts.length > 0 && (
            <div className="so-filter">
              <Keuzelijst label="Kanaal" waarde={kanaal || 'alle'} opties={kanaalOpties} onChange={(w) => setKanaal(w === 'alle' ? '' : w)} />
            </div>
          )}
          <div className="so-filter">
            <Keuzelijst label="Status" waarde={status || 'alle'} opties={statusOpties} onChange={(w) => setStatus(w === 'alle' ? '' : (w as PostStatus))} />
          </div>
          {weergave === 'lijst' ? (
            <div className="so-filter">
              <Keuzelijst label="Maand" waarde={maand || 'alles'} opties={maandOpties} onChange={(w) => setMaand(w === 'alles' ? '' : w)} />
            </div>
          ) : (
            <div className="so-maandnav">
              <button type="button" className="ag-icoonknop" aria-label="Vorige maand" onClick={() => setKalenderMaand((m) => verschuifMaand(m, -1))}>
                ‹
              </button>
              <span className="so-maandnav-label">{maandLabel(kalenderMaand)}</span>
              <button type="button" className="ag-icoonknop" aria-label="Volgende maand" onClick={() => setKalenderMaand((m) => verschuifMaand(m, 1))}>
                ›
              </button>
              <button type="button" className="ag-link-knop" onClick={() => setKalenderMaand(amsterdamDatum(new Date()).slice(0, 7))}>
                Vandaag
              </button>
            </div>
          )}
        </div>
      </div>

      {fout && (
        <div className="so-melding" role="alert">
          {fout}{' '}
          <button type="button" className="ag-link-knop" onClick={() => void laad()}>
            Opnieuw
          </button>
        </div>
      )}

      {posts == null && !fout ? (
        <div className="so-laden" aria-busy="true">
          <div className="db-skelet db-skelet-groot" />
          <div className="db-skelet" />
          <div className="db-skelet" style={{ width: '70%' }} />
        </div>
      ) : posts && weergave === 'kalender' ? (
        <Kalender maand={kalenderMaand} posts={posts} nu={nu} onNieuw={(dag) => router.push(`/social/nieuw?datum=${dag}`)} />
      ) : posts ? (
        <Lijst posts={posts} nu={nu} gefilterd={!!(status || kanaal || maand)} onOpnieuw={opnieuw} bezigId={bezigId} />
      ) : null}
    </div>
  );
}

function Lijst({ posts, nu, gefilterd, onOpnieuw, bezigId }: { posts: PostDto[]; nu: Date; gefilterd: boolean; onOpnieuw: (p: PostDto) => void; bezigId: string | null }) {
  const groepen = groepeerVoorLijst(posts, nu);
  if (!groepen.length) {
    return (
      <div className="so-leeg">
        <p className="db-melding-titel">{gefilterd ? 'Geen posts met deze filters' : 'Nog geen posts'}</p>
        <p className="db-melding-tekst">
          {gefilterd
            ? 'Kies een andere maand, status of kanaal.'
            : 'Maak een post en plan hem in op een dag en tijd; hij wordt dan vanzelf geplaatst. Posts die je buiten het dashboard plaatst, verschijnen hier na het synchroniseren.'}
        </p>
        {!gefilterd && (
          <Link className="db-knop db-knop-primair" href="/social/nieuw">
            + Nieuwe post
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="so-groepen">
      {groepen.map((g) => (
        <section key={g.sleutel} className="so-groep" aria-label={g.titel}>
          <h2 className="db-label">
            {g.titel} <span className="so-zacht">· {g.posts.length}</span>
          </h2>
          <div className="so-kaarten">
            {g.posts.map((p) => (
              <PostKaart key={p.id} post={p} nu={nu} onOpnieuw={onOpnieuw} bezig={bezigId === p.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Kalender({ maand, posts, nu, onNieuw }: { maand: string; posts: PostDto[]; nu: Date; onNieuw: (dag: string) => void }) {
  const weken = maandRaster(maand);
  const perDag = postsPerDag(posts);
  const vandaag = amsterdamDatum(nu);
  const zonderDatum = posts.filter((p) => !p.gepland_op && !p.geplaatst_op).length;
  return (
    <div className="so-kalender-wrap">
      <div className="so-kalender" role="grid" aria-label={`Posts in ${maandLabel(maand)}`}>
        <div className="so-kal-rij so-kal-kop" role="row">
          {WEEKDAG_KORT.map((d) => (
            <span key={d} role="columnheader">
              {d}
            </span>
          ))}
        </div>
        {weken.map((week) => (
          <div key={week[0]} className="so-kal-rij" role="row">
            {week.map((dag) => {
              const items = perDag.get(dag) ?? [];
              const buiten = !dag.startsWith(maand);
              const verleden = dag < vandaag;
              const nr = Number(dag.slice(8));
              return (
                <div
                  key={dag}
                  role="gridcell"
                  className={`so-kal-dag${buiten ? ' is-buiten' : ''}${dag === vandaag ? ' is-vandaag' : ''}${verleden ? ' is-verleden' : ''}`}
                  onClick={(e) => {
                    if (verleden || (e.target as HTMLElement).closest('a')) return;
                    onNieuw(dag);
                  }}
                >
                  <span className="so-kal-nr">{nr}</span>
                  {!verleden && (
                    <button type="button" className="so-kal-nieuw" aria-label={`Nieuwe post op ${dag}`} onClick={() => onNieuw(dag)}>
                      +
                    </button>
                  )}
                  <ul className="so-kal-items">
                    {items.slice(0, 3).map((p) => {
                      const naam = postNaam(p, 60);
                      return (
                        <li key={p.id}>
                          <Link href={`/social/${p.id}`} className={`so-kal-item so-kal-${p.status}`} title={naam}>
                            <span className="so-kal-regel">
                              <span className="so-kal-tijd">{tijdVan((p.geplaatst_op ?? p.gepland_op)!)}</span>
                              <span className="so-kal-iconen">
                                {[...new Set(p.kanalen.map((k) => k.platform))].map((pl) => (
                                  <PlatformIcoon key={pl} platform={pl} grootte={11} />
                                ))}
                              </span>
                            </span>
                            <span className="so-kal-titel sl-niet-mobiel">{naam}</span>
                          </Link>
                        </li>
                      );
                    })}
                    {items.length > 3 && <li className="so-kal-meer">+{items.length - 3} meer</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {zonderDatum > 0 && (
        <p className="so-zacht so-kal-voet">
          {zonderDatum} {zonderDatum === 1 ? 'concept' : 'concepten'} zonder datum staan in de lijst.
        </p>
      )}
    </div>
  );
}
