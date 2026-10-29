'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Persoon } from '@/components/team/Persoon';
import { typtIn } from '@/lib/agenda/client';
import { relatief } from '@/lib/dashboard/tijd';
import {
  FILTER_LABEL,
  NOTITIE_FILTERS,
  pastBijFilter,
  pastBijZoek,
  sorteerNotities,
  weergaveTitel,
  type Notitie,
  type NotitieFilter,
  type NotitieSamenvatting
} from '@/lib/notities/kern';
import { notitieApi, NotitieApiFout } from '@/lib/notities/client';
import { DocIcoon } from './DocIcoon';
import { NotitieScherm, wachtOpOpslaan } from './NotitieScherm';

// De Scratchpad: links de lijst (zoeken in titel en tekst, filter, vastgepind bovenaan,
// laatst bewerkt daarna), rechts de geopende notitie. Op een smal scherm één van de twee.
//   ⌥N / Alt+N  nieuwe notitie      /  zoeken      Esc (in zoeken)  zoekveld leeg
// De URL houdt de open notitie bij (?n=<id>), zodat een link ernaartoe werkt.

const NIET_GEVONDEN = 'Deze notitie bestaat niet meer, of is privé van iemand anders.';

export interface ScratchpadStart {
  lijst: NotitieSamenvatting[];
  notitie: Notitie | null;
  /** ?n= wees naar een notitie die er niet (meer) is of die je niet mag zien. */
  nietGevonden: boolean;
  /** ?nieuw=1: direct een nieuwe notitie maken. */
  nieuw: boolean;
  /** ?klant= of ?project=: alleen de notities daarvan (nieuwe notities worden eraan gekoppeld). */
  context: { klant: { id: string; naam: string } | null; project: { id: string; naam: string; klantId: string | null } | null };
}

export function ScratchpadApp(props: { start: ScratchpadStart; mijnId: string }) {
  return (
    <ToastProvider>
      <Scratchpad {...props} />
    </ToastProvider>
  );
}

function Scratchpad({ start, mijnId }: { start: ScratchpadStart; mijnId: string }) {
  const toast = useToast();
  const [lijst, setLijst] = useState<NotitieSamenvatting[]>(start.lijst);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<NotitieFilter>('alles');
  const [zoekUitkomst, setZoekUitkomst] = useState<{ q: string; filter: NotitieFilter; ids: Set<string> } | null>(null);
  const [openId, setOpenId] = useState<string | null>(start.notitie?.id ?? null);
  const [open, setOpen] = useState<Notitie | null>(start.notitie);
  const [laden, setLaden] = useState(false);
  const [laadFout, setLaadFout] = useState(start.nietGevonden ? NIET_GEVONDEN : '');
  const [nieuwId, setNieuwId] = useState<string | null>(null);
  const [maken, setMaken] = useState(false);
  const [paneel, setPaneel] = useState<'lijst' | 'notitie'>(start.notitie ? 'notitie' : 'lijst');
  const zoekRef = useRef<HTMLInputElement>(null);
  const laadVolgnr = useRef(0);
  const { klant: ctxKlant, project: ctxProject } = start.context;

  // ---------- URL bijhouden ----------
  const zetUrl = useCallback(
    (id: string | null) => {
      const p = new URLSearchParams();
      if (ctxKlant) p.set('klant', ctxKlant.id);
      if (ctxProject) p.set('project', ctxProject.id);
      if (id) p.set('n', id);
      const qs = p.toString();
      window.history.replaceState(null, '', `/scratchpad${qs ? `?${qs}` : ''}`);
    },
    [ctxKlant, ctxProject]
  );

  // ---------- openen ----------
  const openNotitie = useCallback(
    async (id: string, opties: { volledig?: Notitie; nieuw?: boolean } = {}) => {
      const volgnr = ++laadVolgnr.current;
      setOpenId(id);
      setPaneel('notitie');
      setLaadFout('');
      setNieuwId(opties.nieuw ? id : null);
      zetUrl(id);
      if (opties.volledig) {
        setOpen(opties.volledig);
        setLaden(false);
        return;
      }
      setLaden(true);
      try {
        // Eerst een lopend opslaanverzoek van deze notitie afwachten (anders laad je de oude versie).
        await wachtOpOpslaan(id);
        const { notitie } = await notitieApi.ophalen(id);
        if (volgnr !== laadVolgnr.current) return;
        setOpen(notitie);
        setLijst((l) => l.map((n) => (n.id === id ? { ...n, ...samenvattingVan(notitie) } : n)));
      } catch (e) {
        if (volgnr !== laadVolgnr.current) return;
        setOpen(null);
        if (e instanceof NotitieApiFout && e.status === 404) {
          setLijst((l) => l.filter((n) => n.id !== id));
          setLaadFout(NIET_GEVONDEN);
        } else {
          setLaadFout(e instanceof Error ? e.message : 'Notitie niet geladen.');
        }
      } finally {
        if (volgnr === laadVolgnr.current) setLaden(false);
      }
    },
    [zetUrl]
  );

  const nieuweNotitie = useCallback(async () => {
    if (maken) return;
    setMaken(true);
    try {
      const { notitie } = await notitieApi.maak({
        klantId: ctxProject?.klantId ?? ctxKlant?.id ?? null,
        projectId: ctxProject?.id ?? null
      });
      setLijst((l) => [samenvattingVan(notitie), ...l]);
      setQ('');
      setFilter('alles');
      void openNotitie(notitie.id, { volledig: notitie, nieuw: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Nieuwe notitie maken mislukt.', { fout: true });
    } finally {
      setMaken(false);
    }
  }, [maken, ctxKlant, ctxProject, openNotitie, toast]);

  // ?nieuw=1 (vanaf het dashboard): één keer een nieuwe notitie.
  const nieuwGedaan = useRef(false);
  useEffect(() => {
    if (!start.nieuw || nieuwGedaan.current) return;
    nieuwGedaan.current = true;
    void nieuweNotitie();
  }, [start.nieuw, nieuweNotitie]);

  // Breed scherm zonder ?n=: de bovenste notitie openen (zoals Notion).
  useEffect(() => {
    if (start.nieuw || start.notitie || !start.lijst.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- eenmalig na het laden (schermbreedte is pas in de browser bekend)
    if (window.matchMedia('(min-width: 861px)').matches) void openNotitie(sorteerNotities(start.lijst)[0].id);
    // Alleen bij het laden van de pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- sneltoetsen ----------
  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyN') {
        e.preventDefault();
        void nieuweNotitie();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typtIn(e.target)) {
        e.preventDefault();
        setPaneel('lijst');
        zoekRef.current?.focus();
      }
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [nieuweNotitie]);

  // ---------- zoeken (titel direct in de browser, de volledige tekst via de server) ----------
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    let weg = false;
    const t = setTimeout(async () => {
      try {
        const { notities } = await notitieApi.lijst({ q: term, filter, klant: ctxKlant?.id, project: ctxProject?.id, limiet: 200 });
        if (weg) return;
        setZoekUitkomst({ q: term, filter, ids: new Set(notities.map((n) => n.id)) });
        // Notities die nog niet in de lijst stonden (ouder dan de eerste 300) erbij.
        setLijst((l) => {
          const bekend = new Set(l.map((n) => n.id));
          const erbij = notities.filter((n) => !bekend.has(n.id));
          return erbij.length ? [...l, ...erbij] : l;
        });
      } catch {
        /* zoeken op de server mislukt: de lokale treffers blijven staan */
      }
    }, 220);
    return () => {
      weg = true;
      clearTimeout(t);
    };
  }, [q, filter, ctxKlant, ctxProject]);

  const zichtbaar = useMemo(() => {
    const term = q.trim();
    const metFilter = lijst.filter((n) => pastBijFilter(n, filter, mijnId));
    if (!term) return sorteerNotities(metFilter);
    const server = zoekUitkomst && zoekUitkomst.q === term && zoekUitkomst.filter === filter ? zoekUitkomst.ids : null;
    return sorteerNotities(metFilter.filter((n) => pastBijZoek(n, term) || (server?.has(n.id) ?? false)));
  }, [lijst, q, filter, mijnId, zoekUitkomst]);

  // ---------- wijzigingen vanuit de editor ----------
  const bijgewerkt = useCallback((n: Partial<NotitieSamenvatting> & { id: string }) => {
    setLijst((l) => l.map((x) => (x.id === n.id ? { ...x, ...n } : x)));
  }, []);

  const verwijder = useCallback(
    async (n: NotitieSamenvatting) => {
      try {
        await notitieApi.verwijder(n.id);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Verwijderen mislukt.', { fout: true });
        return;
      }
      const rest = sorteerNotities(lijst.filter((x) => x.id !== n.id));
      setLijst((l) => l.filter((x) => x.id !== n.id));
      setOpen(null);
      setOpenId(null);
      zetUrl(null);
      if (rest.length && window.matchMedia('(min-width: 861px)').matches) void openNotitie(rest[0].id);
      else setPaneel('lijst');
      toast(`“${weergaveTitel(n)}” verwijderd.`, {
        duur: 8000,
        actie: {
          label: 'Ongedaan maken',
          onClick: async () => {
            try {
              const { notitie } = await notitieApi.herstel(n.id);
              setLijst((l) => [notitie, ...l.filter((x) => x.id !== n.id)]);
              void openNotitie(n.id);
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Terugzetten mislukt.', { fout: true });
            }
          }
        }
      });
    },
    [lijst, openNotitie, toast, zetUrl]
  );

  const terug = useCallback(() => setPaneel('lijst'), []);
  const leeg = lijst.length === 0;

  return (
    <>
    <ModuleKop label="Brainstormen · ideeën · losse gedachten" titel="Scratchpad">
      <button type="button" className="db-knop db-knop-primair" onClick={() => void nieuweNotitie()} disabled={maken} title="Nieuwe notitie (⌥N / Alt+N)">
        + Nieuwe notitie
      </button>
    </ModuleKop>
    <div className="sp" data-paneel={paneel}>
      <aside className="sp-zij" aria-label="Notities">
        <div className="sp-zij-kop">
          {(ctxKlant || ctxProject) && (
            <p className="sp-context">
              <span>
                Notities van <strong>{ctxProject?.naam ?? ctxKlant?.naam}</strong>
              </span>
              <Link className="ag-link-knop" href="/scratchpad">
                Alle notities
              </Link>
            </p>
          )}
          <div className="sp-zoek">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <input
              ref={zoekRef}
              type="search"
              className="sp-zoek-veld"
              placeholder="Zoeken in titels en tekst…"
              aria-label="Zoeken in notities"
              value={q}
              maxLength={200}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  e.currentTarget.blur();
                } else if (e.key === 'Enter' && zichtbaar[0]) {
                  void openNotitie(zichtbaar[0].id);
                }
              }}
            />
            <kbd className="sp-kbd" aria-hidden="true">
              /
            </kbd>
          </div>
          <div className="sp-filters" role="group" aria-label="Filter">
            {NOTITIE_FILTERS.map((f) => (
              <button key={f} type="button" className={`sp-filter${filter === f ? ' is-aan' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        {leeg ? (
          <div className="sp-leeg">
            <p className="sp-leeg-titel">Nog geen notities</p>
            <p className="sp-leeg-tekst">Schrijf hier ideeën, brainstorms en losse gedachten uit. Koppel ze aan een klant of project als ze ergens bij horen.</p>
            <button type="button" className="db-knop db-knop-primair" onClick={() => void nieuweNotitie()} disabled={maken}>
              + Eerste notitie
            </button>
          </div>
        ) : zichtbaar.length === 0 ? (
          <p className="sp-geen">
            Niets gevonden{q.trim() ? ` voor “${q.trim()}”` : ''}.{' '}
            <button type="button" className="ag-link-knop" onClick={() => { setQ(''); setFilter('alles'); }}>
              Alles tonen
            </button>
          </p>
        ) : (
          <ul className="sp-lijst">
            {zichtbaar.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`sp-item${n.id === openId ? ' is-open' : ''}`}
                  aria-current={n.id === openId ? 'true' : undefined}
                  onClick={() => void openNotitie(n.id)}
                >
                  <span className="sp-item-icoon" aria-hidden="true">
                    {n.emoji ?? <DocIcoon />}
                  </span>
                  <span className="sp-item-hoofd">
                    <span className={`sp-item-titel${n.titel.trim() ? '' : ' is-leeg'}`}>{weergaveTitel(n)}</span>
                    {n.fragment && <span className="sp-item-fragment">{n.fragment}</span>}
                    <span className="sp-item-meta">
                      {n.vastgepind && <span className="sp-item-pin" title="Vastgepind">📌</span>}
                      {n.prive && (
                        <span className="sp-item-prive" title="Privé">
                          Privé
                        </span>
                      )}
                      {(n.project || n.klant) && <span className="sp-item-koppel">{n.project?.naam ?? n.klant?.naam}</span>}
                      <span className="sp-item-tijd" suppressHydrationWarning>{relatief(n.bewerktOp)}</span>
                      <Persoon id={n.bewerktDoor ?? n.gemaaktDoor} compact voorvoegsel="bewerkt door" />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="sp-tip">
          <kbd className="sp-kbd">⌥N</kbd> nieuwe notitie · <kbd className="sp-kbd">/</kbd> in de tekst voor blokken
        </p>
      </aside>

      <section className="sp-hoofd">
        {laden ? (
          <div className="sp-laden" aria-busy="true">
            <div className="db-skelet db-skelet-groot" />
            <div className="db-skelet" style={{ width: '80%' }} />
            <div className="db-skelet" style={{ width: '64%' }} />
          </div>
        ) : open && open.id === openId ? (
          <NotitieScherm key={open.id} notitie={open} mijnId={mijnId} nieuw={nieuwId === open.id} onBijgewerkt={bijgewerkt} onVerwijder={verwijder} onTerug={terug} />
        ) : (
          <div className="sp-niets">
            {laadFout ? (
              <p className="sp-fout" role="alert">
                {laadFout}
              </p>
            ) : (
              <p className="sp-niets-tekst">{leeg ? 'Je eerste idee begint hier.' : 'Kies links een notitie, of begin een nieuwe.'}</p>
            )}
            <button type="button" className="db-knop" onClick={() => void nieuweNotitie()} disabled={maken}>
              + Nieuwe notitie <kbd className="sp-kbd">⌥N</kbd>
            </button>
          </div>
        )}
      </section>
    </div>
    </>
  );
}

function samenvattingVan(n: Notitie): NotitieSamenvatting {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { inhoud, ...rest } = n;
  return rest;
}
