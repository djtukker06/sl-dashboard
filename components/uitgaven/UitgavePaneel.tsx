'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { bestandUrl, euro, uitgavenApi, UitgavenApiFout, uploadBonnetje } from '@/lib/uitgaven/client';
import {
  BETAALWIJZEN,
  BTW_TARIEVEN,
  CATEGORIEEN,
  bedragNL,
  btwUitTotaal,
  categorieLabel,
  isBtwTarief,
  korteDatumNL,
  leesBedrag,
  opCenten,
  type AiVeld,
  type Leverancier,
  type Uitgave,
  type UitgaveBestand,
  type UitgaveInvoer
} from '@/lib/uitgaven/model';
import { LeverancierVeld } from './LeverancierVeld';
import { UgIcoon } from './Iconen';

type Form = {
  datum: string;
  leverancier: string;
  omschrijving: string;
  categorie: string;
  totaal: string;
  btwBedrag: string;
  btwTarief: string;
  valuta: string;
  factuurnummer: string;
  betaaldVia: string;
  projectNotitie: string;
  notitie: string;
};

function naarForm(u: Uitgave): Form {
  return {
    datum: u.datum ?? '',
    leverancier: u.leverancier,
    omschrijving: u.omschrijving,
    categorie: u.categorie ?? '',
    totaal: u.totaal === null ? '' : bedragNL(u.totaal),
    btwBedrag: u.btwBedrag === null ? '' : bedragNL(u.btwBedrag),
    btwTarief: u.btwTarief ?? '',
    valuta: u.valuta,
    factuurnummer: u.factuurnummer,
    betaaldVia: u.betaaldVia ?? '',
    projectNotitie: u.projectNotitie,
    notitie: u.notitie
  };
}

/** Form-veld ↔ AI-veld (zelfde naam, behalve betaaldVia). */
const AI_VAN: Partial<Record<keyof Form, AiVeld>> = {
  datum: 'datum',
  leverancier: 'leverancier',
  omschrijving: 'omschrijving',
  categorie: 'categorie',
  totaal: 'totaal',
  btwBedrag: 'btwBedrag',
  btwTarief: 'btwTarief',
  valuta: 'valuta',
  factuurnummer: 'factuurnummer',
  betaaldVia: 'betaaldVia'
};

/** Paneel rechts om een uitgave te controleren en te bewerken (zelfde vorm als het agenda-paneel). */
export function UitgavePaneel({
  uitgave,
  leveranciers,
  aantalTeControleren,
  onSluit,
  onOpgeslagen,
  onBijgewerkt,
  onVerwijderd
}: {
  uitgave: Uitgave;
  leveranciers: Leverancier[];
  /** Andere concepten na deze (voor "Opslaan en volgende"). */
  aantalTeControleren: number;
  onSluit: () => void;
  onOpgeslagen: (u: Uitgave, volgende: boolean) => void;
  /** Bestanden of uitlezen veranderd, zonder dat het formulier is opgeslagen. */
  onBijgewerkt: (u: Uitgave) => void;
  onVerwijderd: (id: string) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => naarForm(uitgave));
  const [ai, setAi] = useState<Set<AiVeld>>(() => new Set(uitgave.aiVelden));
  const [klant, setKlant] = useState(uitgave.klantId ? { id: uitgave.klantId, naam: uitgave.klantNaam ?? 'Klant' } : null);
  const [bestanden, setBestanden] = useState<UitgaveBestand[]>(uitgave.bestanden);
  const [actiefBestand, setActiefBestand] = useState(0);
  const [aiMelding, setAiMelding] = useState(uitgave.aiStatus === 'mislukt' ? uitgave.aiMelding : '');
  const [bezig, setBezig] = useState<'' | 'opslaan' | 'uitlezen' | 'bestand' | 'verwijderen'>('');
  const [fout, setFout] = useState('');
  const [zeker, setZeker] = useState(false);
  const [weg, setWeg] = useState<string | null>(null);
  const btwAuto = useRef(false);
  const bestandKiezer = useRef<HTMLInputElement>(null);
  const isConcept = uitgave.status === 'concept';

  // Esc sluit; focus terug naar waar je was.
  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onSluit();
      }
    }
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('keydown', toets);
      if (vorige && document.contains(vorige)) vorige.focus({ preventScroll: true });
    };
  }, [onSluit]);

  function zet<K extends keyof Form>(veld: K, waarde: Form[K]) {
    setF((x) => ({ ...x, [veld]: waarde }));
    const a = AI_VAN[veld];
    if (a && ai.has(a)) {
      setAi((s) => {
        const n = new Set(s);
        n.delete(a);
        return n;
      });
    }
  }

  /** Btw uit totaal en tarief, als het btw-veld leeg is of eerder automatisch berekend. */
  function berekenBtw(totaal = f.totaal, tarief = f.btwTarief, forceer = false) {
    if (!forceer && f.btwBedrag && !btwAuto.current) return;
    const t = leesBedrag(totaal);
    if (t === null || !isBtwTarief(tarief)) return;
    const b = btwUitTotaal(t, tarief);
    if (b === null) return;
    btwAuto.current = true;
    zet('btwBedrag', bedragNL(b));
  }

  function kiesLeverancier(l: Leverancier) {
    // Laatst gebruikte categorie en betaalwijze van deze leverancier voorstellen.
    setF((x) => ({
      ...x,
      categorie: x.categorie || l.categorie || '',
      betaaldVia: x.betaaldVia || l.betaaldVia || ''
    }));
  }

  const bekende = leveranciers.find((l) => l.naam.toLowerCase() === f.leverancier.trim().toLowerCase());
  const anderVoorstel = bekende?.categorie && f.categorie && bekende.categorie !== f.categorie ? bekende.categorie : null;

  function invoer(status?: 'concept' | 'verwerkt'): UitgaveInvoer | null {
    const totaal = f.totaal.trim() ? leesBedrag(f.totaal) : null;
    const btw = f.btwBedrag.trim() ? leesBedrag(f.btwBedrag) : null;
    if (f.totaal.trim() && totaal === null) {
      setFout('Het bedrag is ongeldig. Gebruik bijv. 12,50.');
      return null;
    }
    if (f.btwBedrag.trim() && btw === null) {
      setFout('Het btw-bedrag is ongeldig. Gebruik bijv. 2,17.');
      return null;
    }
    if (status === 'verwerkt' && (!f.datum || totaal === null)) {
      setFout('Vul eerst een datum en een bedrag in.');
      return null;
    }
    return {
      datum: f.datum || null,
      leverancier: f.leverancier,
      omschrijving: f.omschrijving,
      categorie: f.categorie || null,
      totaal,
      btwBedrag: btw,
      btwTarief: f.btwTarief || null,
      valuta: f.valuta || 'EUR',
      factuurnummer: f.factuurnummer,
      betaaldVia: f.betaaldVia || null,
      klantId: klant?.id ?? null,
      projectNotitie: f.projectNotitie,
      notitie: f.notitie,
      aiVelden: [...ai],
      ...(status ? { status } : {})
    };
  }

  async function opslaan(status?: 'concept' | 'verwerkt', volgende = false) {
    setFout('');
    const b = invoer(status);
    if (!b) return;
    setBezig('opslaan');
    try {
      const { uitgave: u } = await uitgavenApi.wijzig(uitgave.id, b);
      toast(status === 'verwerkt' && isConcept ? 'Uitgave gecontroleerd en verwerkt' : 'Uitgave opgeslagen');
      onOpgeslagen(u, volgende);
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
      toast('Uitgave verwijderd');
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
      let aantal = 0;
      for (const veld of Object.keys(AI_VAN) as (keyof Form)[]) {
        const a = AI_VAN[veld]!;
        if (!f[veld] && n[veld] && u.aiVelden.includes(a)) {
          y[veld] = n[veld];
          nieuw.add(a);
          aantal++;
        }
      }
      setF(y);
      setAi(nieuw);
      setAiMelding(u.aiStatus === 'mislukt' ? u.aiMelding : '');
      onBijgewerkt(u);
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
        onBijgewerkt(laatste);
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
      onBijgewerkt(u);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Verwijderen mislukt.');
    } finally {
      setBezig('');
    }
  }

  const totaalGetal = leesBedrag(f.totaal);
  const btwGetal = leesBedrag(f.btwBedrag) ?? 0;
  const excl = totaalGetal === null ? null : opCenten(totaalGetal - btwGetal);
  const huidig = bestanden[Math.min(actiefBestand, bestanden.length - 1)];
  const isAi = (v: AiVeld) => (ai.has(v) ? ' is-ai' : '');
  const aiTitel = 'Automatisch ingevuld — controleer even';

  return (
    <>
      <div className="ag-paneel-achter" onClick={onSluit} aria-hidden="true" />
      <aside className="ag-paneel ug-paneel" role="dialog" aria-label="Uitgave bewerken">
        <form
          className="ag-paneel-form"
          onSubmit={(e) => {
            e.preventDefault();
            void opslaan(isConcept ? 'verwerkt' : undefined, isConcept && aantalTeControleren > 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void opslaan(isConcept ? 'verwerkt' : undefined, isConcept && aantalTeControleren > 0);
            }
          }}
        >
          <header className="ag-paneel-kop">
            <p className="db-label">
              {isConcept ? 'Uitgave · te controleren' : 'Uitgave · verwerkt'}
              {uitgave.bronInfo && <span className="ug-bron"> · {uitgave.bronInfo}</span>}
            </p>
            <button type="button" className="ag-icoonknop" aria-label="Sluiten (Esc)" title="Sluiten (Esc)" onClick={onSluit}>
              <UgIcoon naam="kruis" />
            </button>
          </header>

          <div className="ag-paneel-inhoud">
            {/* ---------- bestanden ---------- */}
            <div className="ug-bestanden">
              {huidig ? (
                <div className="ug-voorbeeld">
                  {huidig.type === 'application/pdf' ? (
                    <iframe key={huidig.id} src={`${bestandUrl(uitgave.id, huidig.id)}#view=FitH&toolbar=0`} title={huidig.naam} />
                  ) : huidig.type === 'image/heic' || huidig.type === 'image/heif' ? (
                    <div className="ug-voorbeeld-leeg">
                      <UgIcoon naam="beeld" grootte={26} />
                      <span>HEIC-foto: open of download om te bekijken</span>
                    </div>
                  ) : (
                    <a href={bestandUrl(uitgave.id, huidig.id)} target="_blank" rel="noopener noreferrer" title="Groot openen">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img key={huidig.id} src={bestandUrl(uitgave.id, huidig.id)} alt={`Bonnetje ${huidig.naam}`} />
                    </a>
                  )}
                </div>
              ) : (
                <div className="ug-voorbeeld ug-voorbeeld-leeg">
                  <UgIcoon naam="bon" grootte={26} />
                  <span>Nog geen bonnetje of factuur</span>
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
                        <button type="button" className="ug-mini-knop" title="Bestand verwijderen" aria-label={`${b.naam} verwijderen`} onClick={() => setWeg(b.id)}>
                          <UgIcoon naam="kruis" grootte={14} />
                        </button>
                      </>
                    )}
                  </span>
                ))}
                <button type="button" className="ag-link-knop" disabled={!!bezig} onClick={() => bestandKiezer.current?.click()}>
                  {bezig === 'bestand' ? 'Bezig…' : '+ Bestand'}
                </button>
                {bestanden.length > 0 && (
                  <button type="button" className="ag-link-knop ug-uitlees-knop" disabled={!!bezig} onClick={opnieuwUitlezen} title="Vult alleen lege velden">
                    <UgIcoon naam="vonk" grootte={14} /> {bezig === 'uitlezen' ? 'Uitlezen…' : 'Opnieuw uitlezen'}
                  </button>
                )}
                <input ref={bestandKiezer} type="file" accept="image/*,application/pdf,.heic,.heif" multiple hidden onChange={bestandToevoegen} />
              </div>
            </div>

            {aiMelding ? (
              <p className="ug-melding">{aiMelding}</p>
            ) : ai.size > 0 ? (
              <p className="ug-ai-uitleg">
                <span className="ug-ai-stip" aria-hidden="true" /> Velden met een stip zijn automatisch ingevuld. Controleer ze even.
              </p>
            ) : null}

            {/* ---------- velden ---------- */}
            <label className={`ag-label${isAi('leverancier')}`} title={ai.has('leverancier') ? aiTitel : undefined}>
              Leverancier
              <LeverancierVeld
                waarde={f.leverancier}
                leveranciers={leveranciers}
                onChange={(v) => zet('leverancier', v)}
                onKies={kiesLeverancier}
                className="ag-veld ug-veld-groot"
              />
            </label>

            <label className={`ag-label${isAi('omschrijving')}`} title={ai.has('omschrijving') ? aiTitel : undefined}>
              Waarvoor
              <input
                className="ag-veld"
                value={f.omschrijving}
                maxLength={500}
                placeholder="Bijv. Adobe Creative Cloud, treinkaartje Utrecht"
                onChange={(e) => zet('omschrijving', e.target.value)}
              />
            </label>

            <div className="ag-velden-2">
              <label className={`ag-label${isAi('datum')}`} title={ai.has('datum') ? aiTitel : undefined}>
                Datum
                <input className="ag-veld" type="date" value={f.datum} onChange={(e) => zet('datum', e.target.value)} />
              </label>
              <label className={`ag-label${isAi('categorie')}`} title={ai.has('categorie') ? aiTitel : undefined}>
                Categorie
                <select className="ag-veld" value={f.categorie} onChange={(e) => zet('categorie', e.target.value)}>
                  <option value="">Kies…</option>
                  {CATEGORIEEN.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {anderVoorstel && (
              <p className="ag-uitleg">
                Bij {bekende!.naam} gebruikte je eerder ‘{categorieLabel(anderVoorstel)}’.{' '}
                <button type="button" className="ag-link-knop" onClick={() => zet('categorie', anderVoorstel)}>
                  Overnemen
                </button>
              </p>
            )}

            <div className="ag-velden-2">
              <label className={`ag-label${isAi('totaal')}`} title={ai.has('totaal') ? aiTitel : undefined}>
                Bedrag incl. btw
                <span className="ug-bedrag">
                  <span className="ug-bedrag-valuta">{f.valuta === 'EUR' ? '€' : f.valuta}</span>
                  <input
                    className="ag-veld"
                    inputMode="decimal"
                    value={f.totaal}
                    placeholder="0,00"
                    onChange={(e) => zet('totaal', e.target.value)}
                    onBlur={() => {
                      const n = leesBedrag(f.totaal);
                      if (n !== null) zet('totaal', bedragNL(n));
                      berekenBtw();
                    }}
                  />
                </span>
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
                  <option value="">Kies…</option>
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
                  <span className="ug-bedrag-valuta">{f.valuta === 'EUR' ? '€' : f.valuta}</span>
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
                  <span>{excl === null ? '—' : euro(excl, f.valuta)}</span>
                  {isBtwTarief(f.btwTarief) && totaalGetal !== null && (
                    <button type="button" className="ag-link-knop" onClick={() => berekenBtw(f.totaal, f.btwTarief, true)}>
                      Btw berekenen
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="ag-label" role="group" aria-label="Betaald via">
              <span className={`ug-label-tekst${isAi('betaaldVia')}`} title={ai.has('betaaldVia') ? aiTitel : undefined}>
                Betaald via
              </span>
              <div className="ag-segment ug-segment-wrap">
                {BETAALWIJZEN.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={f.betaaldVia === b.id}
                    className={f.betaaldVia === b.id ? 'is-aan' : ''}
                    onClick={() => zet('betaaldVia', f.betaaldVia === b.id ? '' : b.id)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ag-velden-2">
              <label className={`ag-label${isAi('factuurnummer')}`} title={ai.has('factuurnummer') ? aiTitel : undefined}>
                Factuurnummer
                <input className="ag-veld" value={f.factuurnummer} maxLength={100} onChange={(e) => zet('factuurnummer', e.target.value)} />
              </label>
              <label className={`ag-label${isAi('valuta')}`} title={ai.has('valuta') ? aiTitel : undefined}>
                Valuta
                <input
                  className="ag-veld"
                  value={f.valuta}
                  maxLength={3}
                  autoCapitalize="characters"
                  onChange={(e) => zet('valuta', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                />
              </label>
            </div>
            {f.valuta && f.valuta !== 'EUR' && (
              <p className="ag-uitleg">Andere valuta telt niet mee in de totalen en de btw. Vul liever het bedrag in euro’s in dat van je rekening ging.</p>
            )}

            <div className="ag-label">
              Klant (optioneel)
              <KlantKiezer waarde={klant} onChange={setKlant} />
            </div>
            <label className="ag-label">
              Project (optioneel)
              <input
                className="ag-veld"
                value={f.projectNotitie}
                maxLength={300}
                placeholder="Bijv. huisstijl Jansen"
                onChange={(e) => zet('projectNotitie', e.target.value)}
              />
            </label>
            <label className="ag-label">
              Notitie
              <textarea className="ag-veld" rows={3} value={f.notitie} maxLength={10000} onChange={(e) => zet('notitie', e.target.value)} />
            </label>

            {!isConcept && (
              <p className="ag-uitleg">
                Verwerkt{uitgave.gewijzigd ? ` · laatst gewijzigd ${korteDatumNL(uitgave.gewijzigd.slice(0, 10))}` : ''}.{' '}
                <button type="button" className="ag-link-knop" disabled={!!bezig} onClick={() => opslaan('concept')}>
                  Terug naar concept
                </button>
              </p>
            )}

            {fout && (
              <p className="ag-fout" role="alert">
                {fout}
              </p>
            )}
          </div>

          <footer className="ag-paneel-voet">
            {zeker ? (
              <span className="ag-zeker">
                <span>Uitgave en bestanden verwijderen?</span>
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
                  {isConcept && (
                    <button type="button" className="db-knop" disabled={!!bezig} onClick={() => opslaan('concept')} title="Opslaan, nog niet verwerkt">
                      Bewaar concept
                    </button>
                  )}
                  <button type="submit" className="db-knop db-knop-primair" disabled={!!bezig} title="⌘ Enter">
                    {bezig === 'opslaan'
                      ? 'Bezig…'
                      : isConcept
                        ? aantalTeControleren > 0
                          ? 'Klopt, volgende'
                          : 'Klopt, verwerken'
                        : 'Opslaan'}
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
