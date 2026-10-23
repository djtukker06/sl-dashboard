'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoekhoudingKop } from '@/components/boekhouding/BoekhoudingKop';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { Persoon } from '@/components/team/Persoon';
import { useActieveLeden, useTeam } from '@/components/team/TeamProvider';
import { typtIn } from '@/lib/agenda/client';
import { downloadLink, euro, uitgavenApi, UitgavenApiFout, type ZoekResultaat } from '@/lib/uitgaven/client';
import {
  SOORTEN,
  VERPLICHT_LABEL,
  aandachtVoor,
  korteDatumNL,
  maandLabel,
  maandNaam,
  maandSleutel,
  ontbreektMelding,
  ontbrekendeVelden,
  periodeLabel,
  periodeRond,
  schuifPeriode,
  soortLabel,
  type Leverancier,
  type Periode,
  type Soort,
  type Uitgave
} from '@/lib/uitgaven/model';
import { BtwOverzicht } from './BtwOverzicht';
import { UgIcoon } from './Iconen';
import { uploadNaam } from './RecenteBonnetjes';
import { Toevoegen } from './Toevoegen';
import { UitgavePaneel } from './UitgavePaneel';
import { useUploads } from './useUploads';

// Bonnetjes & inkoopfacturen: uploaden en snel terugvinden. Geen boekhoudpakket: de velden
// (leverancier, datum, bedrag, …) zijn optioneel en vooral hulp bij het zoeken. Btw-overzicht
// en de export voor de boekhouder staan onder "Meer".

type Tab = 'overzicht' | 'btw';
type Weergave = 'galerij' | 'lijst';
const WEERGAVE_SLEUTEL = 'sl-bonnetjes-weergave';
const PAD = '/boekhouding/bonnetjes';

export function UitgavenApp(props: { vandaag: string; openUitgave: string | null; toevoegen: boolean; startTab: Tab }) {
  return (
    <ToastProvider>
      <Bonnetjes {...props} />
    </ToastProvider>
  );
}

/** Zonder datum (net geüpload) bovenaan, daarna nieuwste eerst; gelijk aan de server. */
function sorteer(a: Uitgave, b: Uitgave) {
  if (a.datum !== b.datum) {
    if (!a.datum) return -1;
    if (!b.datum) return 1;
    return a.datum < b.datum ? 1 : -1;
  }
  return a.aangemaakt < b.aangemaakt ? 1 : -1;
}

function Bonnetjes({
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
  const { mijnId } = useTeam();
  const leden = useActieveLeden();
  const [tab, setTab] = useState<Tab>(startTab);

  // ---------- zoeken en filters ----------
  const [zoekInvoer, setZoekInvoer] = useState('');
  const [zoek, setZoek] = useState('');
  const [jaar, setJaar] = useState<number | null>(null);
  const [maand, setMaand] = useState<number | null>(null);
  const [soort, setSoort] = useState<Soort | ''>('');
  const [door, setDoor] = useState('');
  const [weergave, setWeergave] = useState<Weergave>('galerij');

  useEffect(() => {
    const t = window.setTimeout(() => setZoek(zoekInvoer.trim()), 250);
    return () => window.clearTimeout(t);
  }, [zoekInvoer]);

  useEffect(() => {
    try {
      const w = localStorage.getItem(WEERGAVE_SLEUTEL);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (w === 'lijst' || w === 'galerij') setWeergave(w);
    } catch {
      /* geen opslag: standaard galerij */
    }
  }, []);
  function kiesWeergave(w: Weergave) {
    setWeergave(w);
    try {
      localStorage.setItem(WEERGAVE_SLEUTEL, w);
    } catch {
      /* niet bewaren */
    }
  }

  const params = useMemo(
    () => ({
      q: zoek || undefined,
      jaar: jaar ? String(jaar) : undefined,
      maand: jaar && maand ? String(maand) : undefined,
      soort: soort || undefined,
      door: door || undefined
    }),
    [zoek, jaar, maand, soort, door]
  );
  const sleutel = JSON.stringify(params);
  const heeftFilter = Boolean(zoek || jaar || soort || door);

  // ---------- data ----------
  const [data, setData] = useState<{ sleutel: string; res: ZoekResultaat } | null>(null);
  const [laadFout, setLaadFout] = useState<{ sleutel: string; fout: Error } | null>(null);
  const [teller, setTeller] = useState(0);
  const [selectie, setSelectie] = useState<Uitgave | null>(null);
  const [leveranciers, setLeveranciers] = useState<Leverancier[]>([]);
  const [meerOpen, setMeerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const zoekRef = useRef<HTMLInputElement>(null);
  const kiezerRef = useRef<HTMLInputElement>(null);
  const meerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    const p = JSON.parse(sleutel) as Record<string, string | undefined>;
    uitgavenApi
      .zoek(p, ac.signal)
      .then((res) => {
        setData({ sleutel, res: { ...res, uitgaven: res.uitgaven.sort(sorteer) } });
        setLaadFout(null);
      })
      .catch((e) => {
        if ((e as Error)?.name === 'AbortError') return;
        setLaadFout({ sleutel, fout: e instanceof Error ? e : new Error('Laden mislukt.') });
      });
    return () => ac.abort();
  }, [sleutel, teller]);

  const laadLeveranciers = useCallback(() => {
    uitgavenApi
      .leveranciers()
      .then((r) => setLeveranciers(r.leveranciers))
      .catch(() => {});
  }, []);
  useEffect(laadLeveranciers, [laadLeveranciers]);

  // Verversen als je terugkomt (bv. bonnetje geüpload op je telefoon of door je compagnon);
  // dan zijn ook de thumbnails (signed URL's van 10 min) weer vers.
  useEffect(() => {
    const opFocus = () => {
      if (document.visibilityState === 'visible') setTeller((t) => t + 1);
    };
    document.addEventListener('visibilitychange', opFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTeller((t) => t + 1);
    }, 8 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', opFocus);
      window.clearInterval(interval);
    };
  }, []);

  // ?uitgave=<id> opent direct het paneel (vanaf het dashboard of na "Opslaan als uitgave" in mail).
  useEffect(() => {
    if (!openUitgave) return;
    let weg = false;
    uitgavenApi
      .uitgave(openUitgave)
      .then((r) => !weg && setSelectie(r.uitgave))
      .catch(() => !weg && toast('Dit bonnetje bestaat niet meer.', { fout: true }));
    return () => {
      weg = true;
    };
  }, [openUitgave, toast]);

  const resultaat = data && data.sleutel === sleutel ? data.res : null;
  const fout = laadFout && laadFout.sleutel === sleutel ? laadFout.fout : null;
  const uitgaven = resultaat?.uitgaven ?? null;

  /** Een nieuwe of gewijzigde upload in de lijst zetten (en in het open paneel). */
  const verwerk = useCallback((u: Uitgave) => {
    setData((d) => {
      if (!d) return d;
      const bestond = d.res.uitgaven.some((x) => x.id === u.id);
      const lijst = [...d.res.uitgaven.filter((x) => x.id !== u.id), u].sort(sorteer);
      return { ...d, res: { ...d.res, uitgaven: lijst, totaal: d.res.totaal + (bestond ? 0 : 1) } };
    });
    setSelectie((s) => (s && s.id === u.id ? u : s));
  }, []);

  // ---------- uploads ----------
  const { items, voegToe, wis } = useUploads({
    onUitgave: verwerk,
    onAlles: (nieuw, fouten) => {
      laadLeveranciers();
      setTeller((t) => t + 1); // thumbnails ophalen
      if (nieuw.length === 1 && !fouten) {
        const u = nieuw[0];
        const ontbreekt = ontbrekendeVelden(u);
        toast(`Geüpload: ${uploadNaam(u)}${ontbreekt.length ? ` — ${ontbreektMelding(ontbreekt)}` : ''}`, {
          actie: { label: ontbreekt.length ? 'Aanvullen' : 'Openen', onClick: () => setSelectie(u) }
        });
      } else if (nieuw.length > 1) {
        toast(`${nieuw.length} bestanden geüpload${fouten ? `, ${fouten} mislukt` : ''}.`);
      }
    }
  });
  const onBestanden = useCallback((f: File[]) => void voegToe(f), [voegToe]);
  const bezigMetUitlezen = useMemo(
    () => new Set(items.filter((i) => i.fase === 'uitlezen' && i.uitgaveId).map((i) => i.uitgaveId as string)),
    [items]
  );

  // ---------- groepen per maand ----------
  const groepen = useMemo(() => {
    const m = new Map<string, Uitgave[]>();
    for (const u of uitgaven ?? []) {
      const k = maandSleutel(u.datum);
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return [...m.entries()];
  }, [uitgaven]);

  // ---------- sneltoetsen: / zoeken, n uploaden, Esc menu dicht ----------
  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape' && meerOpen) {
        setMeerOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target) || selectie || exportOpen || tab !== 'overzicht') return;
      if (e.key === '/') {
        e.preventDefault();
        zoekRef.current?.focus();
      } else if (e.key === 'n') {
        e.preventDefault();
        kiezerRef.current?.click();
      }
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [selectie, exportOpen, meerOpen, tab]);

  useEffect(() => {
    if (!meerOpen) return;
    function buiten(e: MouseEvent) {
      if (meerRef.current && !meerRef.current.contains(e.target as Node)) setMeerOpen(false);
    }
    document.addEventListener('mousedown', buiten);
    return () => document.removeEventListener('mousedown', buiten);
  }, [meerOpen]);

  const sluit = useCallback(() => {
    setSelectie(null);
    if (openUitgave) router.replace(PAD, { scroll: false });
  }, [openUitgave, router]);

  function wisFilters() {
    setZoekInvoer('');
    setZoek('');
    setJaar(null);
    setMaand(null);
    setSoort('');
    setDoor('');
  }

  const huidigJaar = Number(vandaag.slice(0, 4));
  const jaren = Array.from({ length: 6 }, (_, i) => huidigJaar - i);
  const anderen = leden.filter((l) => l.id !== mijnId);

  return (
    <div className="ug">
      <BoekhoudingKop titel="Bonnetjes & inkoopfacturen">
        <div className="ug-meer" ref={meerRef}>
          <button
            type="button"
            className="db-knop"
            aria-haspopup="menu"
            aria-expanded={meerOpen}
            onClick={() => setMeerOpen((o) => !o)}
          >
            Meer <span aria-hidden="true">▾</span>
          </button>
          {meerOpen && (
            <div className="ug-meer-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="ug-meer-item"
                onClick={() => {
                  setMeerOpen(false);
                  setTab('btw');
                }}
              >
                Btw-overzicht per kwartaal
              </button>
              <button
                type="button"
                role="menuitem"
                className="ug-meer-item"
                onClick={() => {
                  setMeerOpen(false);
                  setExportOpen(true);
                }}
              >
                Exporteren voor de boekhouder
              </button>
            </div>
          )}
        </div>
      </BoekhoudingKop>

      {tab === 'btw' ? (
        <div className="ug-inhoud">
          <div>
            <button type="button" className="ag-link-knop" onClick={() => setTab('overzicht')}>
              <span aria-hidden="true">←</span> Terug naar bonnetjes
            </button>
          </div>
          <BtwOverzicht vandaag={vandaag} versie={teller} />
        </div>
      ) : (
        <div className="ug-inhoud">
          <Toevoegen items={items} onBestanden={onBestanden} onWis={wis} nadruk={toevoegen} kiezer={kiezerRef} />

          {/* ---------- zoeken ---------- */}
          <div className="ug-zoekblok">
            <label className="ug-zoek ug-zoek-groot">
              <UgIcoon naam="zoek" grootte={18} />
              <span className="sr-only">Zoeken</span>
              <input
                ref={zoekRef}
                type="search"
                enterKeyHint="search"
                placeholder="Zoek op leverancier, omschrijving, bedrag of bestandsnaam…"
                value={zoekInvoer}
                onChange={(e) => setZoekInvoer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setZoekInvoer('');
                    setZoek('');
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <kbd className="ug-zoek-toets" aria-hidden="true">
                /
              </kbd>
            </label>

            <div className="ug-filterrij">
              <div className="ug-chips" role="group" aria-label="Periode">
                <button type="button" className={`ug-chip${!jaar ? ' is-aan' : ''}`} aria-pressed={!jaar} onClick={() => {
                    setJaar(null);
                    setMaand(null);
                  }}>
                  Alles
                </button>
                {jaren.map((j) => (
                  <button
                    key={j}
                    type="button"
                    className={`ug-chip${jaar === j ? ' is-aan' : ''}`}
                    aria-pressed={jaar === j}
                    onClick={() => {
                      setJaar(jaar === j ? null : j);
                      setMaand(null);
                    }}
                  >
                    {j}
                  </button>
                ))}
              </div>
              <div className="ug-chips" role="group" aria-label="Soort">
                {[{ id: '' as const, meervoud: 'Alle soorten' }, ...SOORTEN.filter((s) => s.id !== 'overig')].map((s) => (
                  <button
                    key={s.id || 'alles'}
                    type="button"
                    className={`ug-chip${soort === s.id ? ' is-aan' : ''}`}
                    aria-pressed={soort === s.id}
                    onClick={() => setSoort(s.id)}
                  >
                    {s.meervoud}
                  </button>
                ))}
              </div>
              {anderen.length > 0 && (
                <div className="ug-chips" role="group" aria-label="Geüpload door">
                  <button type="button" className={`ug-chip${!door ? ' is-aan' : ''}`} aria-pressed={!door} onClick={() => setDoor('')}>
                    Iedereen
                  </button>
                  <button type="button" className={`ug-chip${door === mijnId ? ' is-aan' : ''}`} aria-pressed={door === mijnId} onClick={() => setDoor(mijnId)}>
                    Ik
                  </button>
                  {anderen.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={`ug-chip ug-chip-persoon${door === l.id ? ' is-aan' : ''}`}
                      aria-pressed={door === l.id}
                      onClick={() => setDoor(l.id)}
                    >
                      <Persoon id={l.id} compact />
                      {l.voornaam || l.naam}
                    </button>
                  ))}
                </div>
              )}
              <div className="ug-weergave" role="group" aria-label="Weergave">
                <button type="button" className={weergave === 'galerij' ? 'is-aan' : ''} aria-pressed={weergave === 'galerij'} title="Galerij" onClick={() => kiesWeergave('galerij')}>
                  <UgIcoon naam="raster" grootte={16} />
                  <span className="sr-only">Galerij</span>
                </button>
                <button type="button" className={weergave === 'lijst' ? 'is-aan' : ''} aria-pressed={weergave === 'lijst'} title="Lijst" onClick={() => kiesWeergave('lijst')}>
                  <UgIcoon naam="lijst" grootte={16} />
                  <span className="sr-only">Lijst</span>
                </button>
              </div>
            </div>

            {jaar && (
              <div className="ug-chips ug-maanden" role="group" aria-label={`Maand in ${jaar}`}>
                <button type="button" className={`ug-chip${!maand ? ' is-aan' : ''}`} aria-pressed={!maand} onClick={() => setMaand(null)}>
                  Heel {jaar}
                </button>
                {Array.from({ length: 12 }, (_, i) => i + 1)
                  .filter((m) => jaar < huidigJaar || m <= Number(vandaag.slice(5, 7)))
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`ug-chip${maand === m ? ' is-aan' : ''}`}
                      aria-pressed={maand === m}
                      onClick={() => setMaand(maand === m ? null : m)}
                    >
                      {maandNaam(m).slice(0, 3)}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* ---------- resultaten ---------- */}
          <p className="ug-telling" aria-live="polite">
            {fout
              ? ''
              : !resultaat
                ? 'Zoeken…'
                : `${resultaat.totaal} ${resultaat.totaal === 1 ? 'bestand' : 'bestanden'}${
                    resultaat.totaal > resultaat.uitgaven.length ? ` · de nieuwste ${resultaat.uitgaven.length} staan hieronder, verfijn je zoekopdracht` : ''
                  }`}
            {heeftFilter && (
              <button type="button" className="ag-link-knop ug-wis" onClick={wisFilters}>
                Filters wissen
              </button>
            )}
          </p>

          {fout ? (
            <div className="db-melding db-melding-fout" role="alert">
              <p className="db-melding-titel">
                {fout instanceof UitgavenApiFout && fout.nietIngericht ? 'Bonnetjes nog niet ingericht' : 'Laden mislukt'}
              </p>
              <p className="db-melding-tekst">{fout.message}</p>
              <div className="db-melding-actie">
                <button type="button" className="db-knop" onClick={() => setTeller((x) => x + 1)}>
                  Opnieuw
                </button>
              </div>
            </div>
          ) : !uitgaven ? (
            weergave === 'galerij' ? (
              <div className="ug-galerij" aria-busy="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="db-skelet ug-kaart-skelet" />
                ))}
              </div>
            ) : (
              <div aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="db-skelet" style={{ height: 44, marginBottom: 8, width: `${100 - i * 6}%` }} />
                ))}
              </div>
            )
          ) : uitgaven.length === 0 ? (
            <div className="db-melding ug-leeg">
              <p className="db-melding-titel">{heeftFilter ? 'Niets gevonden' : 'Nog niets geüpload'}</p>
              <p className="db-melding-tekst">
                {heeftFilter
                  ? 'Probeer een ander woord of bedrag, of wis de filters.'
                  : 'Sleep een bonnetje of inkoopfactuur hierboven, of maak met je telefoon een foto.'}
              </p>
              {heeftFilter && (
                <div className="db-melding-actie">
                  <button type="button" className="db-knop" onClick={wisFilters}>
                    Filters wissen
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="ug-resultaten">
              {groepen.map(([maandK, lijst]) => (
                <section key={maandK} className="ug-groep" aria-label={maandLabel(maandK)}>
                  <h2 className="ag-groep-kop">
                    {maandK === 'zonder-datum' ? 'Nog zonder datum' : maandLabel(maandK)}
                    <span className="ag-groep-aantal">{lijst.length}</span>
                  </h2>
                  {weergave === 'galerij' ? (
                    <ul className="ug-galerij">
                      {lijst.map((u) => (
                        <li key={u.id}>
                          <Kaartje
                            u={u}
                            voorbeeld={resultaat?.voorbeelden[u.id]}
                            uitlezen={bezigMetUitlezen.has(u.id)}
                            open={selectie?.id === u.id}
                            onOpen={() => setSelectie(u)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="ug-lrijen">
                      {lijst.map((u) => (
                        <li key={u.id}>
                          <Rij u={u} uitlezen={bezigMetUitlezen.has(u.id)} open={selectie?.id === u.id} onOpen={() => setSelectie(u)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
          <p className="ug-sneltoetsen" aria-hidden="true">
            <kbd>n</kbd> uploaden · <kbd>/</kbd> zoeken · <kbd>Esc</kbd> sluiten
          </p>
        </div>
      )}

      {selectie && (
        <UitgavePaneel
          // Na het uitlezen opnieuw opbouwen, zodat de ingevulde velden zichtbaar worden.
          key={`${selectie.id}:${selectie.aiStatus}`}
          uitgave={selectie}
          leveranciers={leveranciers}
          uitlezen={bezigMetUitlezen.has(selectie.id)}
          onSluit={sluit}
          onBijgewerkt={verwerk}
          onOpgeslagen={(u) => {
            verwerk(u);
            laadLeveranciers();
            sluit();
          }}
          onVerwijderd={(id) => {
            setData((d) =>
              d ? { ...d, res: { ...d.res, uitgaven: d.res.uitgaven.filter((x) => x.id !== id), totaal: Math.max(0, d.res.totaal - 1) } } : d
            );
            sluit();
          }}
        />
      )}

      {exportOpen && <ExportDialoog vandaag={vandaag} onSluit={() => setExportOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Een upload in de galerij en in de lijst
// ---------------------------------------------------------------------------------
function meta(u: Uitgave): string {
  return [u.datum ? korteDatumNL(u.datum) : `geüpload ${korteDatumNL(u.aangemaakt.slice(0, 10))}`, soortLabel(u.soort)].filter(Boolean).join(' · ');
}

function Kaartje({
  u,
  voorbeeld,
  uitlezen,
  open,
  onOpen
}: {
  u: Uitgave;
  voorbeeld?: string;
  uitlezen: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const pdf = u.bestanden[0]?.type === 'application/pdf';
  return (
    <button
      type="button"
      className={`ug-kaart${open ? ' is-open' : ''}`}
      onClick={onOpen}
      aria-label={`${uploadNaam(u)}, ${meta(u)}${!uitlezen && aandachtVoor(u) ? `, ${AANDACHT[aandachtVoor(u)!].label.toLowerCase()}` : ''}`}
    >
      <span className="ug-kaart-beeld">
        {voorbeeld ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={voorbeeld} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="ug-kaart-icoon">
            <UgIcoon naam={pdf ? 'pdf' : u.bestanden.length ? 'beeld' : 'bon'} grootte={30} />
            {pdf && <span className="ug-kaart-type">PDF</span>}
          </span>
        )}
        {uitlezen ? (
          <span className="ug-kaart-bezig">
            <span className="ug-ai-stip" aria-hidden="true" /> Wordt uitgelezen…
          </span>
        ) : (
          <AandachtBadge u={u} />
        )}
      </span>
      <span className="ug-kaart-tekst">
        <span className="ug-kaart-titel">{uploadNaam(u)}</span>
        <span className="ug-kaart-meta">{meta(u)}</span>
      </span>
      <span className="ug-kaart-voet">
        <span className="ug-kaart-bedrag">{u.totaal === null ? '' : euro(u.totaal, u.valuta)}</span>
        <Persoon id={u.aangemaaktDoor} compact voorvoegsel="geüpload door" />
      </span>
    </button>
  );
}

const AANDACHT = {
  aanvullen: { label: 'Aanvullen', klasse: 'is-aanvullen' },
  controleren: { label: 'Controleren', klasse: 'is-controleren' }
} as const;

/** "Aanvullen" (leverancier, datum of bedrag ontbreekt) of "Controleren" (onzeker uitgelezen). */
function AandachtBadge({ u }: { u: Uitgave }) {
  const a = aandachtVoor(u);
  if (!a) return null;
  const ontbreekt = ontbrekendeVelden(u);
  const titel =
    a === 'aanvullen'
      ? `Nog invullen: ${ontbreekt.map((v) => VERPLICHT_LABEL[v].naam).join(', ')}`
      : `Controleer: ${u.aiOnzeker.map((v) => VERPLICHT_LABEL[v].naam).join(', ')}`;
  return (
    <span className={`ug-badge ${AANDACHT[a].klasse}`} title={titel}>
      {AANDACHT[a].label}
    </span>
  );
}

function Rij({ u, uitlezen, open, onOpen }: { u: Uitgave; uitlezen: boolean; open: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`ug-lrij${open ? ' is-open' : ''}`} onClick={onOpen}>
      <span className="ug-lrij-datum">{u.datum ? korteDatumNL(u.datum) : '—'}</span>
      <span className="ug-lrij-hoofd">
        <span className="ug-lrij-titel">
          <UgIcoon naam={u.bestanden[0]?.type === 'application/pdf' ? 'pdf' : 'beeld'} grootte={14} />
          {uploadNaam(u)}
        </span>
        <span className="ug-lrij-omschrijving">
          {uitlezen ? 'Wordt uitgelezen…' : u.omschrijving || u.factuurnummer || ''}
          {!uitlezen && <AandachtBadge u={u} />}
        </span>
      </span>
      <span className="ug-lrij-soort">{soortLabel(u.soort)}</span>
      <span className="ug-lrij-bedrag">{u.totaal === null ? '—' : euro(u.totaal, u.valuta)}</span>
      <span className="ug-lrij-door">
        <Persoon id={u.aangemaaktDoor} compact voorvoegsel="geüpload door" />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------
// Export voor de boekhouder (onder "Meer")
// ---------------------------------------------------------------------------------
function ExportDialoog({ vandaag, onSluit }: { vandaag: string; onSluit: () => void }) {
  const [periode, setPeriode] = useState<Periode>(() => periodeRond('kwartaal', vandaag));
  const [bezig, setBezig] = useState<'' | 'csv' | 'zip'>('');
  const [fout, setFout] = useState('');
  const [delen, setDelen] = useState<{ naam: string; url: string; aantal: number }[] | null>(null);
  const dialoog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    dialoog.current?.querySelector<HTMLElement>('button')?.focus();
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') onSluit();
    }
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('keydown', toets);
      if (vorige && document.contains(vorige)) vorige.focus({ preventScroll: true });
    };
  }, [onSluit]);

  const params = { van: periode.van, tot: periode.tot };

  function kies(soort: 'maand' | 'kwartaal' | 'jaar') {
    setPeriode(periodeRond(soort, periode.van <= vandaag && vandaag <= periode.tot ? vandaag : periode.van));
    setDelen(null);
    setFout('');
  }

  async function csv() {
    setBezig('csv');
    setFout('');
    try {
      const res = await fetch(`/api/uitgaven/export?formaat=csv&van=${params.van}&tot=${params.tot}`, { cache: 'no-store' });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error((d && d.error) || 'Exporteren mislukt.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      downloadLink(url, `uitgaven_${params.van}_${params.tot}.csv`);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Exporteren mislukt.');
    } finally {
      setBezig('');
    }
  }

  async function zip() {
    setBezig('zip');
    setFout('');
    try {
      const r = await uitgavenApi.zipExport(params);
      setDelen(r.delen);
      // Eén deel: meteen downloaden. Meerdere: knoppen tonen (browsers blokkeren meerdere downloads tegelijk).
      if (r.delen.length === 1) downloadLink(r.delen[0].url, r.delen[0].naam);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Exporteren mislukt.');
    } finally {
      setBezig('');
    }
  }

  return (
    <>
      <div className="ag-paneel-achter" onClick={onSluit} aria-hidden="true" />
      <div className="ug-dialoog" role="dialog" aria-modal="true" aria-label="Exporteren voor de boekhouder" ref={dialoog}>
        <header className="ug-dialoog-kop">
          <p className="db-label">Export voor de boekhouder</p>
          <button type="button" className="ag-icoonknop" aria-label="Sluiten" onClick={onSluit}>
            <UgIcoon naam="kruis" />
          </button>
        </header>
        <div className="ug-dialoog-inhoud">
          <div className="ug-periode">
            <div className="ag-segment" role="group" aria-label="Periode">
              {(
                [
                  ['maand', 'Maand'],
                  ['kwartaal', 'Kwartaal'],
                  ['jaar', 'Jaar']
                ] as const
              ).map(([s, l]) => (
                <button key={s} type="button" className={periode.soort === s ? 'is-aan' : ''} aria-pressed={periode.soort === s} onClick={() => kies(s)}>
                  {l}
                </button>
              ))}
            </div>
            <span className="ug-schuif">
              <button type="button" className="ag-icoonknop" aria-label="Vorige periode" onClick={() => {
                  setPeriode((p) => schuifPeriode(p, -1));
                  setDelen(null);
                }}>
                <UgIcoon naam="links" />
              </button>
              <span className="ug-periode-label">{periodeLabel(periode)}</span>
              <button type="button" className="ag-icoonknop" aria-label="Volgende periode" onClick={() => {
                  setPeriode((p) => schuifPeriode(p, 1));
                  setDelen(null);
                }}>
                <UgIcoon naam="rechts" />
              </button>
            </span>
          </div>
          <p className="ag-uitleg ug-dialoog-uitleg">
            Alle uploads met een datum in deze periode. De CSV opent in Excel (puntkomma, Nederlandse bedragen); de ZIP bevat alle
            bestanden als <code>JJJJ-MM-DD_leverancier_bedrag</code> plus de CSV. Uploads zonder datum gaan niet mee.
          </p>
          <div className="ug-dialoog-knoppen">
            <button type="button" className="db-knop" disabled={!!bezig} onClick={csv}>
              <UgIcoon naam="download" grootte={15} /> {bezig === 'csv' ? 'CSV maken…' : 'CSV downloaden'}
            </button>
            <button type="button" className="db-knop db-knop-primair" disabled={!!bezig} onClick={zip}>
              <UgIcoon naam="download" grootte={15} /> {bezig === 'zip' ? 'ZIP maken…' : 'ZIP met bestanden'}
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
