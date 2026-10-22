'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { typtIn } from '@/lib/agenda/client';
import { csvExportUrl, downloadLink, euro, uitgavenApi, UitgavenApiFout } from '@/lib/uitgaven/client';
import {
  BETAALWIJZEN,
  CATEGORIEEN,
  STATUSSEN,
  betaalLabel,
  categorieLabel,
  filterUitgaven,
  isDatum,
  korteDatumNL,
  maandLabel,
  maandSleutel,
  periodeLabel,
  periodeRond,
  schuifPeriode,
  totalen,
  type Filters,
  type Leverancier,
  type Periode,
  type PeriodeSoort,
  type Uitgave
} from '@/lib/uitgaven/model';
import { BtwOverzicht } from './BtwOverzicht';
import { UgIcoon } from './Iconen';
import { Toevoegen } from './Toevoegen';
import { UitgavePaneel } from './UitgavePaneel';
import { useUploads } from './useUploads';

type Tab = 'overzicht' | 'btw';

export function UitgavenApp(props: { vandaag: string; openUitgave: string | null; toevoegen: boolean; startTab: Tab }) {
  return (
    <ToastProvider>
      <Uitgaven {...props} />
    </ToastProvider>
  );
}

/** Nieuwste eerst; zonder datum bovenaan (die moeten nog gecontroleerd worden). */
function sorteer(a: Uitgave, b: Uitgave) {
  if (a.datum !== b.datum) {
    if (!a.datum) return -1;
    if (!b.datum) return 1;
    return a.datum < b.datum ? 1 : -1;
  }
  return a.aangemaakt < b.aangemaakt ? 1 : -1;
}

function Uitgaven({
  vandaag,
  openUitgave,
  toevoegen,
  startTab
}: {
  vandaag: string;
  openUitgave: string | null;
  toevoegen: boolean;
  startTab: Tab;
}) {
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(startTab);
  const [periode, setPeriode] = useState<Periode>(() => periodeRond('maand', vandaag));
  const [data, setData] = useState<{ sleutel: string; uitgaven: Uitgave[] } | null>(null);
  const [laadFout, setLaadFout] = useState<{ sleutel: string; fout: Error } | null>(null);
  const [teller, setTeller] = useState(0);
  const [filters, setFilters] = useState<Filters>({});
  const [selectie, setSelectie] = useState<Uitgave | null>(null);
  const [controleren, setControleren] = useState(false);
  const [leveranciers, setLeveranciers] = useState<Leverancier[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const zoekRef = useRef<HTMLInputElement>(null);
  const sleutel = `${periode.van}|${periode.tot}`;

  // ---------- data ----------
  useEffect(() => {
    let weg = false;
    uitgavenApi
      .lijst(periode.van, periode.tot)
      .then((r) => {
        if (weg) return;
        setData({ sleutel: `${periode.van}|${periode.tot}`, uitgaven: r.uitgaven.sort(sorteer) });
        setLaadFout(null);
      })
      .catch((e) => {
        if (!weg) setLaadFout({ sleutel: `${periode.van}|${periode.tot}`, fout: e });
      });
    return () => {
      weg = true;
    };
  }, [periode.van, periode.tot, teller]);

  const laadLeveranciers = useCallback(() => {
    uitgavenApi
      .leveranciers()
      .then((r) => setLeveranciers(r.leveranciers))
      .catch(() => {});
  }, []);
  useEffect(laadLeveranciers, [laadLeveranciers]);

  // Verversen als je terugkomt naar het tabblad (bv. bonnetje toegevoegd op je telefoon).
  useEffect(() => {
    const opFocus = () => {
      if (document.visibilityState === 'visible') setTeller((t) => t + 1);
    };
    document.addEventListener('visibilitychange', opFocus);
    return () => document.removeEventListener('visibilitychange', opFocus);
  }, []);

  // ?uitgave=<id> opent direct het paneel (vanaf het dashboard of na "Opslaan als uitgave" in mail).
  useEffect(() => {
    if (!openUitgave) return;
    let weg = false;
    uitgavenApi
      .uitgave(openUitgave)
      .then((r) => !weg && setSelectie(r.uitgave))
      .catch(() => !weg && toast('Deze uitgave bestaat niet meer.', { fout: true }));
    return () => {
      weg = true;
    };
  }, [openUitgave, toast]);

  const uitgaven = useMemo(() => (data && data.sleutel === sleutel ? data.uitgaven : null), [data, sleutel]);
  const fout = laadFout && laadFout.sleutel === sleutel ? laadFout.fout : null;

  /** Een (nieuwe of gewijzigde) uitgave in de lijst zetten, of eruit als hij buiten de periode valt. */
  const verwerk = useCallback(
    (u: Uitgave) => {
      setData((d) => {
        if (!d) return d;
        const [van, tot] = d.sleutel.split('|');
        const hoortErbij = !u.datum || (u.datum >= van && u.datum <= tot);
        const rest = d.uitgaven.filter((x) => x.id !== u.id);
        return { ...d, uitgaven: (hoortErbij ? [...rest, u] : rest).sort(sorteer) };
      });
    },
    []
  );

  // ---------- uploads ----------
  const { items, voegToe, wis } = useUploads({
    onUitgave: verwerk,
    onAlles: (nieuw, fouten) => {
      laadLeveranciers();
      if (nieuw.length === 1 && !fouten) {
        setControleren(false);
        setSelectie(nieuw[0]);
        if (nieuw[0].datum && (nieuw[0].datum < periode.van || nieuw[0].datum > periode.tot)) {
          toast(`Datum ${korteDatumNL(nieuw[0].datum)} valt buiten ${periodeLabel(periode)}.`);
        }
      } else if (nieuw.length > 1) {
        toast(`${nieuw.length} bonnetjes toegevoegd${fouten ? `, ${fouten} mislukt` : ''}. Klik op ‘Controleren’.`);
      }
    }
  });
  const onBestanden = useCallback((f: File[]) => void voegToe(f), [voegToe]);

  // ---------- filteren ----------
  const zichtbaar = useMemo(() => (uitgaven ? filterUitgaven(uitgaven, filters) : []), [uitgaven, filters]);
  const t = useMemo(() => totalen(zichtbaar.filter((u) => u.datum)), [zichtbaar]);
  const concepten = useMemo(() => (uitgaven ?? []).filter((u) => u.status === 'concept'), [uitgaven]);
  const groepen = useMemo(() => {
    const m = new Map<string, Uitgave[]>();
    for (const u of zichtbaar) {
      const k = maandSleutel(u.datum);
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return [...m.entries()];
  }, [zichtbaar]);
  const leveranciersInLijst = useMemo(
    () => [...new Set((uitgaven ?? []).map((u) => u.leverancier.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl')),
    [uitgaven]
  );
  const heeftFilter = Boolean(filters.zoek || filters.categorie || filters.leverancier || filters.status || filters.betaaldVia);

  // Sneltoetsen: / zoeken, n handmatig, Esc filters wissen.
  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target) || selectie || exportOpen) return;
      if (e.key === '/') {
        e.preventDefault();
        zoekRef.current?.focus();
      }
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [selectie, exportOpen]);

  async function handmatig() {
    try {
      const { uitgave } = await uitgavenApi.maak({ datum: vandaag });
      verwerk(uitgave);
      setControleren(false);
      setSelectie(uitgave);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Aanmaken mislukt.', { fout: true });
    }
  }

  function volgendConcept(naId: string): Uitgave | null {
    return concepten.find((u) => u.id !== naId) ?? null;
  }

  const sluit = useCallback(() => {
    setSelectie(null);
    setControleren(false);
    if (openUitgave) router.replace('/uitgaven', { scroll: false });
  }, [openUitgave, router]);

  function kiesSoort(soort: PeriodeSoort) {
    if (soort === 'eigen') setPeriode((p) => ({ ...p, soort: 'eigen' }));
    else setPeriode(periodeRond(soort, periode.soort === 'eigen' ? vandaag : periode.van <= vandaag && vandaag <= periode.tot ? vandaag : periode.van));
  }

  const exportParams = {
    van: periode.van,
    tot: periode.tot,
    zoek: filters.zoek,
    categorie: filters.categorie,
    leverancier: filters.leverancier,
    status: filters.status,
    betaaldVia: filters.betaaldVia
  };

  return (
    <div className="ug">
      <ModuleKop label="Bonnetjes & betaalde facturen" titel="Uitgaven">
        <button type="button" className="db-knop" onClick={() => setExportOpen(true)}>
          <UgIcoon naam="download" grootte={15} /> Exporteren
        </button>
      </ModuleKop>

      <div className="ug-tabs" role="tablist" aria-label="Weergave">
        <button type="button" role="tab" aria-selected={tab === 'overzicht'} className={`ug-tab${tab === 'overzicht' ? ' is-aan' : ''}`} onClick={() => setTab('overzicht')}>
          Overzicht
          {concepten.length > 0 && <span className="ug-tab-teller">{concepten.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'btw'} className={`ug-tab${tab === 'btw' ? ' is-aan' : ''}`} onClick={() => setTab('btw')}>
          Btw & cijfers
        </button>
      </div>

      {tab === 'btw' ? (
        <div className="ug-inhoud">
          <BtwOverzicht vandaag={vandaag} versie={teller} />
        </div>
      ) : (
        <div className="ug-inhoud">
          <Toevoegen items={items} onBestanden={onBestanden} onWis={wis} onHandmatig={handmatig} nadruk={toevoegen} />

          {concepten.length > 0 && (
            <div className="ug-controle">
              <span>
                <span className="ug-ai-stip" aria-hidden="true" />
                <strong>{concepten.length}</strong> {concepten.length === 1 ? 'uitgave' : 'uitgaven'} te controleren
              </span>
              <button
                type="button"
                className="db-knop db-knop-primair"
                onClick={() => {
                  setControleren(true);
                  setSelectie(concepten[0]);
                }}
              >
                Controleren
              </button>
            </div>
          )}

          {/* ---------- periode & filters ---------- */}
          <div className="ug-balk">
            <div className="ug-periode">
              <div className="ag-segment" role="group" aria-label="Periode">
                {(
                  [
                    ['maand', 'Maand'],
                    ['kwartaal', 'Kwartaal'],
                    ['jaar', 'Jaar'],
                    ['eigen', 'Eigen']
                  ] as const
                ).map(([s, l]) => (
                  <button key={s} type="button" className={periode.soort === s ? 'is-aan' : ''} aria-pressed={periode.soort === s} onClick={() => kiesSoort(s)}>
                    {l}
                  </button>
                ))}
              </div>
              {periode.soort === 'eigen' ? (
                <span className="ug-eigen">
                  <input
                    className="ag-veld"
                    type="date"
                    value={periode.van}
                    aria-label="Van"
                    onChange={(e) => isDatum(e.target.value) && setPeriode((p) => ({ ...p, van: e.target.value, tot: p.tot < e.target.value ? e.target.value : p.tot }))}
                  />
                  <span>t/m</span>
                  <input
                    className="ag-veld"
                    type="date"
                    value={periode.tot}
                    min={periode.van}
                    aria-label="Tot en met"
                    onChange={(e) => isDatum(e.target.value) && e.target.value >= periode.van && setPeriode((p) => ({ ...p, tot: e.target.value }))}
                  />
                </span>
              ) : (
                <span className="ug-schuif">
                  <button type="button" className="ag-icoonknop" aria-label="Vorige periode" onClick={() => setPeriode((p) => schuifPeriode(p, -1))}>
                    <UgIcoon naam="links" />
                  </button>
                  <span className="ug-periode-label">{periodeLabel(periode)}</span>
                  <button type="button" className="ag-icoonknop" aria-label="Volgende periode" onClick={() => setPeriode((p) => schuifPeriode(p, 1))}>
                    <UgIcoon naam="rechts" />
                  </button>
                </span>
              )}
            </div>

            <div className="ug-filters">
              <label className="ug-zoek">
                <UgIcoon naam="zoek" grootte={16} />
                <span className="sr-only">Zoeken</span>
                <input
                  ref={zoekRef}
                  type="search"
                  placeholder="Zoek leverancier, omschrijving, bedrag…"
                  value={filters.zoek ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, zoek: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setFilters((f) => ({ ...f, zoek: '' }));
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </label>
              <select className="ag-veld ug-filter" aria-label="Categorie" value={filters.categorie ?? ''} onChange={(e) => setFilters((f) => ({ ...f, categorie: e.target.value }))}>
                <option value="">Alle categorieën</option>
                {CATEGORIEEN.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
                <option value="geen">Zonder categorie</option>
              </select>
              <select className="ag-veld ug-filter" aria-label="Leverancier" value={filters.leverancier ?? ''} onChange={(e) => setFilters((f) => ({ ...f, leverancier: e.target.value }))}>
                <option value="">Alle leveranciers</option>
                {leveranciersInLijst.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <select className="ag-veld ug-filter" aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Alle statussen</option>
                {STATUSSEN.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === 'concept' ? 'Concept (te controleren)' : s.label}
                  </option>
                ))}
              </select>
              <select className="ag-veld ug-filter" aria-label="Betaald via" value={filters.betaaldVia ?? ''} onChange={(e) => setFilters((f) => ({ ...f, betaaldVia: e.target.value }))}>
                <option value="">Alle betaalwijzen</option>
                {BETAALWIJZEN.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
              {heeftFilter && (
                <button type="button" className="ag-link-knop" onClick={() => setFilters({})}>
                  Wissen
                </button>
              )}
            </div>
          </div>

          {/* ---------- totalen ---------- */}
          <dl className="ug-totalen">
            <div>
              <dt>Incl. btw</dt>
              <dd>{euro(t.incl)}</dd>
            </div>
            <div>
              <dt>Btw</dt>
              <dd>{euro(t.btw)}</dd>
            </div>
            <div>
              <dt>Excl. btw</dt>
              <dd>{euro(t.excl)}</dd>
            </div>
            <div>
              <dt>Uitgaven</dt>
              <dd>{t.aantal}</dd>
            </div>
          </dl>
          {(t.andereValuta > 0 || t.zonderBedrag > 0) && (
            <p className="ag-uitleg ug-totalen-noot">
              {[
                t.andereValuta ? `${t.andereValuta} in andere valuta niet meegeteld` : '',
                t.zonderBedrag ? `${t.zonderBedrag} nog zonder bedrag` : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {/* ---------- lijst ---------- */}
          {fout ? (
            <div className="db-melding db-melding-fout" role="alert">
              <p className="db-melding-titel">{fout instanceof UitgavenApiFout && fout.nietIngericht ? 'Uitgaven nog niet ingericht' : 'Laden mislukt'}</p>
              <p className="db-melding-tekst">{fout.message}</p>
              <div className="db-melding-actie">
                <button type="button" className="db-knop" onClick={() => setTeller((x) => x + 1)}>
                  Opnieuw
                </button>
              </div>
            </div>
          ) : !uitgaven ? (
            <div className="ug-lijst" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="db-skelet" style={{ height: 44, marginBottom: 8, width: `${100 - i * 6}%` }} />
              ))}
            </div>
          ) : zichtbaar.length === 0 ? (
            <div className="db-melding ug-leeg">
              <p className="db-melding-titel">{heeftFilter ? 'Niets gevonden met deze filters' : `Nog geen uitgaven in ${periodeLabel(periode)}`}</p>
              <p className="db-melding-tekst">
                {heeftFilter ? 'Pas de filters aan of wis ze.' : 'Sleep een bonnetje hierboven, of maak met je telefoon een foto.'}
              </p>
            </div>
          ) : (
            <div className="ug-lijst">
              {groepen.map(([maand, lijst]) => {
                const mt = totalen(lijst);
                return (
                  <section key={maand} className="ug-groep" aria-label={maandLabel(maand)}>
                    <h2 className="ag-groep-kop">
                      {maandLabel(maand)}
                      <span className="ag-groep-aantal">
                        {lijst.length} · {euro(mt.incl)}
                      </span>
                    </h2>
                    <ul className="ug-rijen">
                      {lijst.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            className={`ug-rij${u.status === 'concept' ? ' is-concept' : ''}${selectie?.id === u.id ? ' is-open' : ''}`}
                            onClick={() => {
                              setControleren(false);
                              setSelectie(u);
                            }}
                          >
                            <span className="ug-rij-datum">{u.datum ? korteDatumNL(u.datum).replace(/ \d{4}$/, '') : '—'}</span>
                            <span className="ug-rij-hoofd">
                              <span className="ug-rij-titel">
                                {u.leverancier || <em className="ug-onbekend">Leverancier onbekend</em>}
                                {u.bestanden.length === 0 && <span className="ag-chip ag-chip-mini">Geen bon</span>}
                              </span>
                              <span className="ug-rij-meta">
                                {[u.omschrijving, categorieLabel(u.categorie), betaalLabel(u.betaaldVia), u.klantNaam].filter(Boolean).join(' · ') || ' '}
                              </span>
                            </span>
                            {u.status === 'concept' && (
                              <span className="ug-rij-status" title={u.aiStatus === 'mislukt' ? u.aiMelding : 'Nog controleren'}>
                                <span className="ug-ai-stip" aria-hidden="true" />
                                Controleren
                              </span>
                            )}
                            <span className="ug-rij-bedrag">
                              {euro(u.totaal, u.valuta)}
                              {u.btwBedrag ? <span className="ug-rij-btw">btw {euro(u.btwBedrag, u.valuta)}</span> : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectie && (
        <UitgavePaneel
          key={selectie.id}
          uitgave={selectie}
          leveranciers={leveranciers}
          aantalTeControleren={controleren ? concepten.filter((u) => u.id !== selectie.id).length : 0}
          onSluit={sluit}
          onBijgewerkt={verwerk}
          onOpgeslagen={(u, volgende) => {
            verwerk(u);
            laadLeveranciers();
            const n = volgende ? volgendConcept(u.id) : null;
            if (n) setSelectie(n);
            else sluit();
          }}
          onVerwijderd={(id) => {
            setData((d) => (d ? { ...d, uitgaven: d.uitgaven.filter((x) => x.id !== id) } : d));
            sluit();
          }}
        />
      )}

      {exportOpen && <ExportDialoog periode={periode} params={exportParams} aantal={zichtbaar.filter((u) => u.datum).length} heeftFilter={heeftFilter} onSluit={() => setExportOpen(false)} />}
    </div>
  );
}

function ExportDialoog({
  periode,
  params,
  aantal,
  heeftFilter,
  onSluit
}: {
  periode: Periode;
  params: Record<string, string | undefined>;
  aantal: number;
  heeftFilter: boolean;
  onSluit: () => void;
}) {
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [delen, setDelen] = useState<{ naam: string; url: string; aantal: number }[] | null>(null);

  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') onSluit();
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [onSluit]);

  async function zip() {
    setBezig(true);
    setFout('');
    try {
      const r = await uitgavenApi.zipExport(params);
      setDelen(r.delen);
      // Eén deel: meteen downloaden. Meerdere: knoppen tonen (browsers blokkeren meerdere downloads tegelijk).
      if (r.delen.length === 1) downloadLink(r.delen[0].url, r.delen[0].naam);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Exporteren mislukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <>
      <div className="ag-paneel-achter" onClick={onSluit} aria-hidden="true" />
      <div className="ug-dialoog" role="dialog" aria-modal="true" aria-label="Exporteren voor de boekhouder">
        <header className="ug-dialoog-kop">
          <p className="db-label">Export voor de boekhouder</p>
          <button type="button" className="ag-icoonknop" aria-label="Sluiten" onClick={onSluit}>
            <UgIcoon naam="kruis" />
          </button>
        </header>
        <div className="ug-dialoog-inhoud">
          <p className="ug-dialoog-titel">{periodeLabel(periode)}</p>
          <p className="ag-uitleg ug-dialoog-uitleg">
            {aantal} uitgave{aantal === 1 ? '' : 'n'}
            {heeftFilter ? ' (met de huidige filters)' : ''}. Uitgaven zonder datum gaan niet mee. De CSV opent in Excel
            (puntkomma, Nederlandse bedragen); de ZIP bevat alle bonnetjes als <code>JJJJ-MM-DD_leverancier_bedrag</code> plus
            de CSV.
          </p>
          <div className="ug-dialoog-knoppen">
            {aantal > 0 ? (
              <a className="db-knop" href={csvExportUrl(params)} download>
                <UgIcoon naam="download" grootte={15} /> CSV downloaden
              </a>
            ) : (
              <button type="button" className="db-knop" disabled>
                <UgIcoon naam="download" grootte={15} /> CSV downloaden
              </button>
            )}
            <button type="button" className="db-knop db-knop-primair" disabled={bezig || aantal === 0} onClick={zip}>
              <UgIcoon naam="download" grootte={15} /> {bezig ? 'ZIP maken…' : 'ZIP met bonnetjes'}
            </button>
          </div>
          {delen && delen.length > 1 && (
            <div className="ug-delen">
              <p className="ag-uitleg">De export is groot en in {delen.length} delen gesplitst (elk met de volledige CSV):</p>
              {delen.map((d) => (
                <a key={d.naam} className="db-knop" href={d.url} download={d.naam}>
                  {d.naam} · {d.aantal} bestanden
                </a>
              ))}
              <p className="ag-uitleg">De links werken 5 minuten.</p>
            </div>
          )}
          {delen && delen.length === 1 && <p className="ag-uitleg">De download is gestart.</p>}
          {fout && (
            <p className="ag-fout" role="alert">
              {fout}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
