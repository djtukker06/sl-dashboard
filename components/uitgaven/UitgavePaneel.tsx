'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { Persoon } from '@/components/team/Persoon';
import { bestandUrl, euro, uitgavenApi, UitgavenApiFout, uploadBonnetje } from '@/lib/uitgaven/client';
import {
  BTW_TARIEVEN,
  SOORTEN,
  bedragNL,
  btwUitTotaal,
  isBtwTarief,
  korteDatumNL,
  leesBedrag,
  opCenten,
  ontbreektMelding,
  soortLabel,
  VERPLICHT_LABEL,
  VERPLICHTE_VELDEN,
  type AiVeld,
  type VerplichtVeld,
  type Leverancier,
  type Uitgave,
  type UitgaveBestand,
  type UitgaveInvoer
} from '@/lib/uitgaven/model';
import { LeverancierVeld } from './LeverancierVeld';
import { UgIcoon } from './Iconen';
import { uploadNaam } from './RecenteBonnetjes';

// Paneel rechts bij één upload: groot voorbeeld, downloaden en verwijderen. Leverancier,
// datum en bedrag zijn verplicht: Claude leest ze uit; lukt dat niet, dan staan die velden
// gemarkeerd ("Kon de datum niet lezen — vul hem zelf in"), gaan de gegevens open en krijgt
// het eerste ontbrekende veld de focus. Twijfelde Claude ("onzeker"), dan staat er
// "Controleer dit" met een knop "Klopt". De overige gegevens zijn optioneel. Door Claude
// ingevulde velden krijgen een stip.

type Form = {
  soort: string;
  datum: string;
  leverancier: string;
  omschrijving: string;
  totaal: string;
  btwBedrag: string;
  btwTarief: string;
  factuurnummer: string;
  notitie: string;
};

function naarForm(u: Uitgave): Form {
  return {
    soort: u.soort ?? '',
    datum: u.datum ?? '',
    leverancier: u.leverancier,
    omschrijving: u.omschrijving,
    totaal: u.totaal === null ? '' : bedragNL(u.totaal),
    btwBedrag: u.btwBedrag === null ? '' : bedragNL(u.btwBedrag),
    btwTarief: u.btwTarief ?? '',
    factuurnummer: u.factuurnummer,
    notitie: u.notitie
  };
}

const AI_VAN: Partial<Record<keyof Form, AiVeld>> = {
  datum: 'datum',
  leverancier: 'leverancier',
  omschrijving: 'omschrijving',
  totaal: 'totaal',
  btwBedrag: 'btwBedrag',
  btwTarief: 'btwTarief',
  factuurnummer: 'factuurnummer'
};

const GEGEVENS_OPEN = 'sl-bonnetjes-gegevens';

export function UitgavePaneel({
  uitgave,
  leveranciers,
  uitlezen,
  onSluit,
  onOpgeslagen,
  onBijgewerkt,
  onVerwijderd
}: {
  uitgave: Uitgave;
  leveranciers: Leverancier[];
  /** Het automatisch uitlezen loopt nog (net geüpload). */
  uitlezen: boolean;
  onSluit: () => void;
  onOpgeslagen: (u: Uitgave) => void;
  /** Bestanden of uitlezen veranderd, zonder dat het formulier is opgeslagen. */
  onBijgewerkt: (u: Uitgave) => void;
  onVerwijderd: (id: string) => void;
}) {
  const toast = useToast();
  const [begin, setBegin] = useState<Form>(() => naarForm(uitgave));
  const [f, setF] = useState<Form>(begin);
  const [ai, setAi] = useState<Set<AiVeld>>(() => new Set(uitgave.aiVelden));
  const [onzeker, setOnzeker] = useState<Set<VerplichtVeld>>(() => new Set(uitgave.aiOnzeker));
  const [klant, setKlant] = useState(uitgave.klantId ? { id: uitgave.klantId, naam: uitgave.klantNaam ?? 'Klant' } : null);
  const [bestanden, setBestanden] = useState<UitgaveBestand[]>(uitgave.bestanden);
  const [actiefBestand, setActiefBestand] = useState(0);
  const [aiMelding, setAiMelding] = useState(uitgave.aiStatus === 'mislukt' ? uitgave.aiMelding : '');
  const [bezig, setBezig] = useState<'' | 'opslaan' | 'uitlezen' | 'bestand' | 'verwijderen'>('');
  const [fout, setFout] = useState('');
  const [zeker, setZeker] = useState(false);
  const [weg, setWeg] = useState<string | null>(null);
  const [gegevensOpen, setGegevensOpen] = useState(false);
  const btwAuto = useRef(false);
  const veldenRef = useRef<HTMLFieldSetElement>(null);
  const autoOpen = useRef(false);
  const aandachtGetoond = useRef(false);
  const bestandKiezer = useRef<HTMLInputElement>(null);
  const sluitKnop = useRef<HTMLButtonElement>(null);

  const onzekerGewijzigd =
    onzeker.size !== uitgave.aiOnzeker.length || uitgave.aiOnzeker.some((v) => !onzeker.has(v));
  const gewijzigd =
    (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== begin[k]) || (klant?.id ?? null) !== uitgave.klantId || onzekerGewijzigd;

  // Verplichte velden (leverancier, datum, bedrag): wat ontbreekt en wat Claude onzeker las.
  const leeg: Record<VerplichtVeld, boolean> = {
    leverancier: !f.leverancier.trim(),
    datum: !f.datum,
    totaal: leesBedrag(f.totaal) === null
  };
  const ontbrekend = VERPLICHTE_VELDEN.filter((v) => leeg[v]);
  const teControleren = VERPLICHTE_VELDEN.filter((v) => !leeg[v] && onzeker.has(v));
  const uitgelezen = uitgave.aiStatus !== 'geen';

  // De keuze "gegevens open/dicht" onthouden (per browser).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(GEGEVENS_OPEN) === '1') setGegevensOpen(true);
    } catch {
      /* geen opslag */
    }
  }, []);

  // Na het uitlezen (of bij openen): ontbreekt er iets of moet iets gecontroleerd worden,
  // dan de gegevens openklappen en het eerste ontbrekende (anders onzekere) veld focussen.
  useEffect(() => {
    if (uitlezen || aandachtGetoond.current) return;
    const eerste = ontbrekend[0] ?? teControleren[0];
    if (!eerste) return;
    let focus = 0;
    const open = window.setTimeout(() => {
      // Pas hier markeren: in StrictMode wordt de eerste timeout weer opgeruimd.
      aandachtGetoond.current = true;
      if (!veldenRef.current?.closest('details')?.open) {
        autoOpen.current = true;
        setGegevensOpen(true);
      }
      focus = window.setTimeout(() => {
        veldenRef.current?.querySelector<HTMLInputElement>(`[data-veld="${eerste}"] input`)?.focus({ preventScroll: false });
      }, 60);
    }, 0);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(focus);
    };
    // Alleen bij openen en zodra het uitlezen klaar is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uitlezen]);

  function vraagSluiten() {
    if (gewijzigd && !window.confirm('Wijzigingen weggooien?')) return;
    onSluit();
  }
  const vraagSluitenRef = useRef(vraagSluiten);
  useEffect(() => {
    vraagSluitenRef.current = vraagSluiten;
  });

  // Esc sluit; focus naar het paneel en daarna terug naar waar je was.
  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    sluitKnop.current?.focus({ preventScroll: true });
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        vraagSluitenRef.current();
      }
    }
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('keydown', toets);
      if (vorige && document.contains(vorige)) vorige.focus({ preventScroll: true });
    };
  }, []);

  function zet<K extends keyof Form>(veld: K, waarde: Form[K]) {
    setF((x) => ({ ...x, [veld]: waarde }));
    if ((VERPLICHTE_VELDEN as readonly string[]).includes(veld) && onzeker.has(veld as VerplichtVeld)) {
      klopt(veld as VerplichtVeld);
    }
    const a = AI_VAN[veld];
    if (a && ai.has(a)) {
      setAi((s) => {
        const n = new Set(s);
        n.delete(a);
        return n;
      });
    }
  }

  /** "Klopt": de gebruiker heeft een onzeker uitgelezen veld gecontroleerd. */
  function klopt(veld: VerplichtVeld) {
    setOnzeker((s) => {
      const n = new Set(s);
      n.delete(veld);
      return n;
    });
  }

  /** Btw uit totaal en tarief, als het btw-veld leeg is of eerder automatisch berekend. */
  function berekenBtw(totaal = f.totaal, tarief = f.btwTarief) {
    if (f.btwBedrag && !btwAuto.current) return;
    const t = leesBedrag(totaal);
    if (t === null || !isBtwTarief(tarief)) return;
    const b = btwUitTotaal(t, tarief);
    if (b === null) return;
    btwAuto.current = true;
    zet('btwBedrag', bedragNL(b));
  }

  function invoer(): UitgaveInvoer | null {
    const totaal = f.totaal.trim() ? leesBedrag(f.totaal) : null;
    const btw = f.btwBedrag.trim() ? leesBedrag(f.btwBedrag) : null;
    if (f.totaal.trim() && totaal === null) {
      setGegevensOpen(true);
      setFout('Het bedrag is ongeldig. Gebruik bijv. 12,50.');
      return null;
    }
    if (f.btwBedrag.trim() && btw === null) {
      setGegevensOpen(true);
      setFout('Het btw-bedrag is ongeldig. Gebruik bijv. 2,17.');
      return null;
    }
    return {
      soort: f.soort || null,
      datum: f.datum || null,
      leverancier: f.leverancier,
      omschrijving: f.omschrijving,
      totaal,
      btwBedrag: btw,
      btwTarief: f.btwTarief || null,
      factuurnummer: f.factuurnummer,
      klantId: klant?.id ?? null,
      notitie: f.notitie,
      aiVelden: [...ai],
      aiOnzeker: [...onzeker].filter((v) => ai.has(v))
    };
  }

  async function opslaan() {
    setFout('');
    const b = invoer();
    if (!b) return;
    setBezig('opslaan');
    try {
      const { uitgave: u } = await uitgavenApi.wijzig(uitgave.id, b);
      toast('Opgeslagen');
      onOpgeslagen(u);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Opslaan mislukt.');
    } finally {
      setBezig('');
    }
  }

  async function verwijder() {
    setBezig('verwijderen');
    try {
      await uitgavenApi.verwijder(uitgave.id);
      toast('Verwijderd');
      onVerwijderd(uitgave.id);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Verwijderen mislukt.');
      setBezig('');
    }
  }

  async function opnieuwUitlezen() {
    setBezig('uitlezen');
    setFout('');
    try {
      const { uitgave: u } = await uitgavenApi.uitlezen(uitgave.id);
      const n = naarForm(u);
      const nieuw = new Set(ai);
      const y = { ...f };
      const b = { ...begin };
      let aantal = 0;
      for (const veld of Object.keys(AI_VAN) as (keyof Form)[]) {
        const a = AI_VAN[veld]!;
        if (!f[veld] && n[veld] && u.aiVelden.includes(a)) {
          y[veld] = n[veld];
          // Al opgeslagen door het uitlezen: telt niet als wijziging.
          b[veld] = n[veld];
          nieuw.add(a);
          aantal++;
        }
      }
      setF(y);
      setBegin(b);
      onBijgewerkt({ ...u, aiStatus: uitgave.aiStatus });
      setAi(nieuw);
      setOnzeker(new Set([...onzeker, ...u.aiOnzeker.filter((v) => nieuw.has(v))]));
      setAiMelding(u.aiStatus === 'mislukt' ? u.aiMelding : '');
      if (aantal) setGegevensOpen(true);
      if (u.aiStatus === 'klaar') toast(aantal ? `${aantal} veld${aantal === 1 ? '' : 'en'} ingevuld` : 'Niets nieuws gevonden');
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Uitlezen mislukt.');
    } finally {
      setBezig('');
    }
  }

  async function bestandToevoegen(e: React.ChangeEvent<HTMLInputElement>) {
    const lijst = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!lijst.length) return;
    setBezig('bestand');
    setFout('');
    try {
      let laatste: Uitgave | null = null;
      for (const file of lijst) laatste = await uploadBonnetje(file, { uitgaveId: uitgave.id });
      if (laatste) {
        setBestanden(laatste.bestanden);
        setActiefBestand(laatste.bestanden.length - 1);
        onBijgewerkt({ ...laatste, aiStatus: uitgave.aiStatus });
      }
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Toevoegen mislukt.');
    } finally {
      setBezig('');
    }
  }

  async function bestandWeg(id: string) {
    setBezig('bestand');
    try {
      const { uitgave: u } = await uitgavenApi.verwijderBestand(uitgave.id, id);
      setBestanden(u.bestanden);
      setActiefBestand(0);
      setWeg(null);
      onBijgewerkt({ ...u, aiStatus: uitgave.aiStatus });
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Verwijderen mislukt.');
    } finally {
      setBezig('');
    }
  }

  function wisselGegevens(open: boolean) {
    setGegevensOpen(open);
    // Automatisch opengeklapt (er ontbreekt iets): niet als voorkeur onthouden.
    if (autoOpen.current) {
      autoOpen.current = false;
      return;
    }
    try {
      localStorage.setItem(GEGEVENS_OPEN, open ? '1' : '0');
    } catch {
      /* niet bewaren */
    }
  }

  const totaalGetal = leesBedrag(f.totaal);
  const btwGetal = leesBedrag(f.btwBedrag) ?? 0;
  const excl = totaalGetal === null ? null : opCenten(totaalGetal - btwGetal);
  const huidig = bestanden[Math.min(actiefBestand, bestanden.length - 1)];
  const isAi = (v: AiVeld) =>
    (ai.has(v) ? ' is-ai' : '') +
    (!uitlezen && (ontbrekend as string[]).includes(v) ? ' is-ontbreekt' : '') +
    (!uitlezen && (teControleren as string[]).includes(v) ? ' is-onzeker' : '');
  /** Uitleg onder een verplicht veld: ontbreekt (rood) of controleren (zand) met "Klopt". */
  function hint(v: VerplichtVeld) {
    if (uitlezen) return null;
    if (leeg[v]) {
      const { naam, lidwoord } = VERPLICHT_LABEL[v];
      return (
        <span className="ug-veld-hint is-ontbreekt" id={`ug-hint-${v}`}>
          {uitgelezen ? ontbreektMelding([v]) : `Vul ${lidwoord} ${naam} in (verplicht).`}
        </span>
      );
    }
    if (onzeker.has(v)) {
      return (
        <span className="ug-veld-hint is-onzeker" id={`ug-hint-${v}`}>
          Controleer dit: niet zeker uitgelezen.{' '}
          <button type="button" className="ag-link-knop" onClick={() => klopt(v)}>
            Klopt
          </button>
        </span>
      );
    }
    return null;
  }
  const hintId = (v: VerplichtVeld) => (!uitlezen && (leeg[v] || onzeker.has(v)) ? `ug-hint-${v}` : undefined);
  const aiTitel = 'Automatisch ingevuld';
  const samenvatting = [f.leverancier.trim(), f.datum ? korteDatumNL(f.datum) : '', totaalGetal !== null ? euro(totaalGetal) : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="ag-paneel-achter" onClick={vraagSluiten} aria-hidden="true" />
      <aside className="ag-paneel ug-paneel" role="dialog" aria-modal="true" aria-labelledby="ug-paneel-titel">
        <form
          className="ag-paneel-form"
          onSubmit={(e) => {
            e.preventDefault();
            void opslaan();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void opslaan();
            }
          }}
        >
          <header className="ag-paneel-kop">
            <div className="ug-paneel-kop">
              <p className="db-label">{soortLabel(f.soort || uitgave.soort) || 'Upload'}</p>
              <h2 id="ug-paneel-titel" className="ug-paneel-titel">
                {uploadNaam({ leverancier: f.leverancier.trim(), bestanden })}
              </h2>
            </div>
            <button ref={sluitKnop} type="button" className="ag-icoonknop" aria-label="Sluiten (Esc)" title="Sluiten (Esc)" onClick={vraagSluiten}>
              <UgIcoon naam="kruis" />
            </button>
          </header>

          <div className="ag-paneel-inhoud">
            {/* ---------- voorbeeld en bestanden ---------- */}
            <div className="ug-bestanden">
              {huidig ? (
                <div className="ug-voorbeeld">
                  {huidig.type === 'application/pdf' ? (
                    <iframe key={huidig.id} src={`${bestandUrl(uitgave.id, huidig.id)}#view=FitH&toolbar=0`} title={huidig.naam} />
                  ) : huidig.type === 'image/heic' || huidig.type === 'image/heif' ? (
                    <div className="ug-voorbeeld-leeg">
                      <UgIcoon naam="beeld" grootte={26} />
                      <span>HEIC-foto: download om te bekijken</span>
                    </div>
                  ) : (
                    <a href={bestandUrl(uitgave.id, huidig.id)} target="_blank" rel="noopener noreferrer" title="Groot openen">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img key={huidig.id} src={bestandUrl(uitgave.id, huidig.id)} alt={`Voorbeeld van ${huidig.naam}`} />
                    </a>
                  )}
                </div>
              ) : (
                <div className="ug-voorbeeld ug-voorbeeld-leeg">
                  <UgIcoon naam="bon" grootte={26} />
                  <span>Geen bestand</span>
                </div>
              )}
              <div className="ug-bestand-balk">
                {bestanden.map((b, i) => (
                  <span key={b.id} className={`ug-bestand${b === huidig ? ' is-aan' : ''}`}>
                    <button type="button" className="ug-bestand-naam" onClick={() => setActiefBestand(i)} title={b.naam}>
                      <UgIcoon naam={b.type === 'application/pdf' ? 'pdf' : 'beeld'} grootte={14} />
                      <span>{b.naam}</span>
                    </button>
                    {weg === b.id ? (
                      <>
                        <button type="button" className="ag-link-knop ag-link-gevaar" disabled={!!bezig} onClick={() => bestandWeg(b.id)}>
                          Weg
                        </button>
                        <button type="button" className="ag-link-knop" onClick={() => setWeg(null)}>
                          Nee
                        </button>
                      </>
                    ) : (
                      <>
                        <a className="ug-mini-knop" href={bestandUrl(uitgave.id, b.id, true)} title="Downloaden" aria-label={`${b.naam} downloaden`}>
                          <UgIcoon naam="download" grootte={14} />
                        </a>
                        {bestanden.length > 1 && (
                          <button type="button" className="ug-mini-knop" title="Bestand verwijderen" aria-label={`${b.naam} verwijderen`} onClick={() => setWeg(b.id)}>
                            <UgIcoon naam="kruis" grootte={14} />
                          </button>
                        )}
                      </>
                    )}
                  </span>
                ))}
                <button type="button" className="ag-link-knop" disabled={!!bezig} onClick={() => bestandKiezer.current?.click()} title="Bv. een tweede pagina">
                  {bezig === 'bestand' ? 'Bezig…' : '+ Pagina'}
                </button>
                <input ref={bestandKiezer} type="file" accept="image/*,application/pdf,.heic,.heif" multiple hidden onChange={bestandToevoegen} />
              </div>
            </div>

            <div className="ug-paneel-info">
              <p className="ug-door">
                Geüpload {uitgave.aangemaaktDoor ? 'door ' : ''}
                <Persoon id={uitgave.aangemaaktDoor} />
                {` · ${korteDatumNL(uitgave.aangemaakt.slice(0, 10))}`}
                {uitgave.bronInfo && <span className="ug-bron"> · {uitgave.bronInfo}</span>}
              </p>
              {huidig && (
                <a className="db-knop" href={bestandUrl(uitgave.id, huidig.id, true)}>
                  <UgIcoon naam="download" grootte={15} /> Downloaden
                </a>
              )}
            </div>

            {uitlezen ? (
              <p className="ug-ai-uitleg" role="status">
                <span className="ug-ai-stip" aria-hidden="true" /> Wordt automatisch uitgelezen…
              </p>
            ) : (
              <>
                {aiMelding && <p className="ug-melding">{aiMelding}</p>}
                {ontbrekend.length > 0 ? (
                  <p className="ug-aanvullen" role="status">
                    <strong>Aanvullen:</strong>{' '}
                    {uitgelezen && uitgave.aiStatus === 'klaar' ? ontbreektMelding(ontbrekend) : ontbreektMelding(ontbrekend, false)}
                  </p>
                ) : teControleren.length > 0 ? (
                  <p className="ug-controleren" role="status">
                    <strong>Controleer:</strong> {teControleren.map((v) => VERPLICHT_LABEL[v].naam).join(', ')} — niet zeker uitgelezen.
                  </p>
                ) : null}
              </>
            )}

            {/* ---------- gegevens (optioneel) ---------- */}
            <details className="ug-gegevens" open={gegevensOpen} onToggle={(e) => wisselGegevens((e.target as HTMLDetailsElement).open)}>
              <summary>
                <span className="ug-gegevens-titel">Gegevens</span>
                {!gegevensOpen && !uitlezen && ontbrekend.length > 0 && <span className="ug-badge is-aanvullen">Aanvullen</span>}
                {!gegevensOpen && samenvatting && <span className="ug-gegevens-kort">{samenvatting}</span>}
              </summary>
              <fieldset ref={veldenRef} className="ug-gegevens-velden" disabled={uitlezen}>
                {ai.size > 0 && (
                  <p className="ug-ai-uitleg">
                    <span className="ug-ai-stip" aria-hidden="true" /> Velden met een stip zijn automatisch ingevuld.
                  </p>
                )}
                <div className="ag-label" role="group" aria-label="Soort">
                  <span className="ug-label-tekst">Soort</span>
                  <div className="ag-segment ug-segment-wrap">
                    {SOORTEN.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={f.soort === s.id}
                        className={f.soort === s.id ? 'is-aan' : ''}
                        onClick={() => zet('soort', f.soort === s.id ? '' : s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label data-veld="leverancier" className={`ag-label${isAi('leverancier')}`} title={ai.has('leverancier') ? aiTitel : undefined}>
                  <span>
                    Leverancier <span className="ug-verplicht" aria-hidden="true">*</span>
                  </span>
                  <LeverancierVeld
                    waarde={f.leverancier}
                    leveranciers={leveranciers}
                    onChange={(v) => zet('leverancier', v)}
                    onKies={() => {}}
                    className="ag-veld"
                    beschrijving={hintId('leverancier')}
                    verplicht
                  />
                  {hint('leverancier')}
                </label>

                <label className={`ag-label${isAi('omschrijving')}`} title={ai.has('omschrijving') ? aiTitel : undefined}>
                  Omschrijving
                  <input
                    className="ag-veld"
                    value={f.omschrijving}
                    maxLength={500}
                    placeholder="Bijv. Adobe Creative Cloud, treinkaartje Utrecht"
                    onChange={(e) => zet('omschrijving', e.target.value)}
                  />
                </label>

                <div className="ag-velden-2">
                  <label data-veld="datum" className={`ag-label${isAi('datum')}`} title={ai.has('datum') ? aiTitel : undefined}>
                    <span>
                      Datum <span className="ug-verplicht" aria-hidden="true">*</span>
                    </span>
                    <input
                      className="ag-veld"
                      type="date"
                      value={f.datum}
                      aria-required="true"
                      aria-invalid={!uitlezen && leeg.datum ? true : undefined}
                      aria-describedby={hintId('datum')}
                      onChange={(e) => zet('datum', e.target.value)}
                    />
                    {hint('datum')}
                  </label>
                  <label className={`ag-label${isAi('factuurnummer')}`} title={ai.has('factuurnummer') ? aiTitel : undefined}>
                    Factuurnummer
                    <input className="ag-veld" value={f.factuurnummer} maxLength={100} onChange={(e) => zet('factuurnummer', e.target.value)} />
                  </label>
                </div>

                <div className="ag-velden-2">
                  <label data-veld="totaal" className={`ag-label${isAi('totaal')}`} title={ai.has('totaal') ? aiTitel : undefined}>
                    <span>
                      Bedrag incl. btw <span className="ug-verplicht" aria-hidden="true">*</span>
                    </span>
                    <span className="ug-bedrag">
                      <span className="ug-bedrag-valuta">{uitgave.valuta === 'EUR' ? '€' : uitgave.valuta}</span>
                      <input
                        className="ag-veld"
                        inputMode="decimal"
                        value={f.totaal}
                        placeholder="0,00"
                        aria-required="true"
                        aria-invalid={!uitlezen && leeg.totaal ? true : undefined}
                        aria-describedby={hintId('totaal')}
                        onChange={(e) => zet('totaal', e.target.value)}
                        onBlur={() => {
                          const n = leesBedrag(f.totaal);
                          if (n !== null) zet('totaal', bedragNL(n));
                          berekenBtw();
                        }}
                      />
                    </span>
                    {hint('totaal')}
                  </label>
                  <label className={`ag-label${isAi('btwTarief')}`} title={ai.has('btwTarief') ? aiTitel : undefined}>
                    Btw-tarief
                    <select
                      className="ag-veld"
                      value={f.btwTarief}
                      onChange={(e) => {
                        zet('btwTarief', e.target.value);
                        berekenBtw(f.totaal, e.target.value);
                      }}
                    >
                      <option value="">—</option>
                      {BTW_TARIEVEN.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="ag-velden-2">
                  <label className={`ag-label${isAi('btwBedrag')}`} title={ai.has('btwBedrag') ? aiTitel : undefined}>
                    Btw-bedrag
                    <span className="ug-bedrag">
                      <span className="ug-bedrag-valuta">{uitgave.valuta === 'EUR' ? '€' : uitgave.valuta}</span>
                      <input
                        className="ag-veld"
                        inputMode="decimal"
                        value={f.btwBedrag}
                        placeholder="0,00"
                        onChange={(e) => {
                          btwAuto.current = false;
                          zet('btwBedrag', e.target.value);
                        }}
                        onBlur={() => {
                          const n = leesBedrag(f.btwBedrag);
                          if (n !== null) zet('btwBedrag', bedragNL(n));
                        }}
                      />
                    </span>
                  </label>
                  <div className="ag-label">
                    Excl. btw
                    <div className="ug-excl">
                      <span>{excl === null ? '—' : euro(excl, uitgave.valuta)}</span>
                    </div>
                  </div>
                </div>

                <div className="ag-label">
                  Klant (optioneel)
                  <KlantKiezer waarde={klant} onChange={setKlant} />
                </div>
                <label className="ag-label">
                  Notitie
                  <textarea className="ag-veld" rows={3} value={f.notitie} maxLength={10000} onChange={(e) => zet('notitie', e.target.value)} />
                </label>

                {bestanden.length > 0 && (
                  <button type="button" className="ag-link-knop ug-uitlees-knop" disabled={!!bezig} onClick={opnieuwUitlezen} title="Vult alleen lege velden">
                    <UgIcoon naam="vonk" grootte={14} /> {bezig === 'uitlezen' ? 'Uitlezen…' : 'Opnieuw automatisch uitlezen'}
                  </button>
                )}
              </fieldset>
            </details>

            {fout && (
              <p className="ag-fout" role="alert">
                {fout}
              </p>
            )}
          </div>

          <footer className="ag-paneel-voet">
            {zeker ? (
              <span className="ag-zeker">
                <span>Bestand(en) definitief verwijderen?</span>
                <button type="button" className="db-knop ag-knop-gevaar" disabled={!!bezig} onClick={verwijder}>
                  Ja, verwijderen
                </button>
                <button type="button" className="db-knop" onClick={() => setZeker(false)}>
                  Nee
                </button>
              </span>
            ) : (
              <>
                <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setZeker(true)}>
                  Verwijderen
                </button>
                <span className="ag-paneel-acties">
                  <button type="button" className="db-knop" onClick={vraagSluiten}>
                    Sluiten
                  </button>
                  <button type="submit" className="db-knop db-knop-primair" disabled={!!bezig || uitlezen || !gewijzigd} title="⌘ Enter">
                    {bezig === 'opslaan' ? 'Bezig…' : 'Opslaan'}
                  </button>
                </span>
              </>
            )}
          </footer>
        </form>
      </aside>
    </>
  );
}

export function isNietIngericht(e: unknown) {
  return e instanceof UitgavenApiFout && e.nietIngericht;
}
