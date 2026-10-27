'use client';

import { useId, useMemo } from 'react';
import { centenNaarInvoer, formatCenten, naarCenten } from '@/lib/boekhouding/kern/geld';
import { isVerlegd, type BtwCode } from '@/lib/boekhouding/kern/btw';
import { DREMPEL_ACTIVEREN, ACTIVA_KIESBAAR } from '@/lib/boekhouding/kern/constanten';
import { isDatum, kwartaalLabel, vergrendeldReden, type Datum } from '@/lib/boekhouding/kern/periode';
import {
  RICHTING_LABELS,
  SOORT_LABELS,
  SOORTEN,
  berekenBoeking,
  btwLabel,
  kiesbareCategorieen,
  standaardCategorie,
  standaardRichting,
  zonderBtw,
  type Boeking,
  type BoekingSoort,
  type Richting,
  type Stamdata
} from '@/lib/boekhouding/model';

// Het formulier van één boekingsregel: als snelle invoer bovenaan Bank & boekingen
// (layout "rij") en om een regel te bekijken/wijzigen in het zijpaneel (layout "paneel").
// De btw, het bedrag excl. btw en het kwartaal worden live uitgerekend met dezelfde kern
// als de server (lib/boekhouding/model.ts); de server rekent bij het opslaan opnieuw.

export interface Formulier {
  rekeningId: string;
  datum: string;
  omschrijving: string;
  tegenpartij: string;
  soort: BoekingSoort;
  richting: Richting;
  bedrag: string;
  isExcl: boolean;
  btwCode: BtwCode;
  /** Gebruiker heeft het tarief zelf gekozen (dan niet meer automatisch per categorie). */
  btwGekozen: boolean;
  btwHandmatig: string;
  grootboek: string;
  vennootId: string;
  notities: string;
}

const BTW_KEUZES: Record<'uitgave' | 'inkomst', BtwCode[]> = {
  uitgave: ['21', '9', '0', 'geen', 'eu_dienst', 'buiten_eu', 'verlegd_nl'],
  inkomst: ['21', '9', '0', 'eu_dienst', 'buiten_eu', 'verlegd_nl', 'geen']
};

export function leegFormulier(stam: Stamdata, vandaag: Datum, basis?: Partial<Formulier>): Formulier {
  const standaard = stam.rekeningen.find((r) => r.standaard && r.actief) ?? stam.rekeningen.find((r) => r.actief);
  return {
    rekeningId: standaard?.id ?? '',
    datum: vandaag,
    omschrijving: '',
    tegenpartij: '',
    soort: 'uitgave',
    richting: 'af',
    bedrag: '',
    isExcl: false,
    btwCode: '21',
    btwGekozen: false,
    btwHandmatig: '',
    grootboek: standaardCategorie('uitgave') ?? '',
    vennootId: '',
    notities: '',
    ...basis
  };
}

export function formulierUit(b: Boeking): Formulier {
  return {
    rekeningId: b.rekeningId ?? '',
    datum: b.datum,
    omschrijving: b.omschrijving,
    tegenpartij: b.tegenpartij ?? '',
    soort: b.soort,
    richting: b.richting,
    bedrag: centenNaarInvoer(b.bedrag),
    isExcl: b.isExcl,
    btwCode: b.btwCode,
    btwGekozen: true,
    btwHandmatig: b.btwHandmatig ? centenNaarInvoer(b.btw) : '',
    grootboek: b.grootboek ?? '',
    vennootId: b.vennootId ?? '',
    notities: b.notities ?? ''
  };
}

export function formulierNaarBody(f: Formulier) {
  return {
    rekeningId: f.rekeningId || null,
    datum: f.datum,
    omschrijving: f.omschrijving,
    tegenpartij: f.tegenpartij || null,
    soort: f.soort,
    richting: f.richting,
    bedrag: f.bedrag,
    isExcl: f.isExcl,
    btwCode: zonderBtw(f.soort) ? 'geen' : f.btwCode,
    btwHandmatig: f.btwHandmatig.trim() ? f.btwHandmatig : null,
    grootboek: f.grootboek || null,
    vennootId: f.vennootId || null,
    notities: f.notities || null,
    status: 'geboekt'
  };
}

/** Een wijziging van het formulier, met de automatische vervolgstappen (richting, btw, categorie). */
export function pasAan(stam: Stamdata, f: Formulier, w: Partial<Formulier>): Formulier {
  const n = { ...f, ...w };
  if (w.soort && w.soort !== f.soort) {
    n.richting = standaardRichting(w.soort);
    n.grootboek = standaardCategorie(w.soort) ?? '';
    n.btwHandmatig = '';
    if (!zonderBtw(w.soort) && !BTW_KEUZES[w.soort === 'inkomst' ? 'inkomst' : 'uitgave'].includes(n.btwCode)) n.btwCode = '21';
    if (zonderBtw(f.soort) && !zonderBtw(w.soort)) n.btwCode = '21';
    if (w.soort === 'prive' && !n.vennootId) n.vennootId = stam.vennoten.find((v) => v.actief)?.id ?? '';
  }
  if (w.grootboek !== undefined && !f.btwGekozen) {
    const g = stam.grootboek.find((x) => x.code === w.grootboek);
    if (g?.btw && BTW_KEUZES[n.soort === 'inkomst' ? 'inkomst' : 'uitgave'].includes(g.btw)) n.btwCode = g.btw;
  }
  if (w.btwCode !== undefined) {
    n.btwGekozen = true;
    n.btwHandmatig = '';
    if (w.btwCode !== '21' && w.btwCode !== '9') n.isExcl = false;
  }
  return n;
}

export interface Uitrekening {
  geldig: boolean;
  regels: { label: string; waarde: string; nadruk?: boolean }[];
  kwartaal: string | null;
  slot: string | null;
  hint: string | null;
  waarschuwing: string | null;
}

/** De live uitkomst onder het formulier. */
export function rekenUit(stam: Stamdata, f: Formulier): Uitrekening {
  const bedrag = naarCenten(f.bedrag);
  const datumOk = isDatum(f.datum);
  const kwartaal = datumOk ? kwartaalLabel(Number(f.datum.slice(0, 4)), (Math.floor((Number(f.datum.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4) : null;
  const slot = datumOk ? vergrendeldReden(f.datum, stam.vergrendeling) : null;
  if (bedrag === null || bedrag <= 0 || !datumOk) return { geldig: false, regels: [], kwartaal, slot, hint: null, waarschuwing: null };
  const handmatig = f.btwHandmatig.trim() ? naarCenten(f.btwHandmatig) : null;
  let r;
  try {
    r = berekenBoeking({
      soort: f.soort,
      richting: f.richting,
      bedrag,
      isExcl: f.isExcl,
      btwCode: zonderBtw(f.soort) ? 'geen' : f.btwCode,
      datum: f.datum,
      btw: handmatig ?? 0,
      btwHandmatig: handmatig !== null && handmatig >= 0
    });
  } catch {
    return { geldig: false, regels: [], kwartaal, slot, hint: null, waarschuwing: 'De btw kan niet hoger zijn dan het bedrag.' };
  }
  const x = r.btw;
  const regels: Uitrekening['regels'] = [];
  let hint: string | null = null;
  if (f.soort === 'uitgave' || f.soort === 'inkomst') {
    regels.push({ label: 'Excl. btw', waarde: formatCenten(x.excl) });
    if (isVerlegd(x.code) && f.soort === 'uitgave') {
      regels.push({ label: 'Verlegde btw', waarde: formatCenten(x.btw), nadruk: true });
      hint = `Btw verlegd: ${formatCenten(x.btw)} verschuldigd én aftrekbaar (per saldo € 0,00), rubriek ${x.rubriek} + 5b.`;
    } else if (f.soort === 'uitgave') {
      regels.push({ label: 'Voorbelasting', waarde: formatCenten(x.voorbelasting), nadruk: x.voorbelasting > 0 });
    } else {
      regels.push({ label: 'Af te dragen btw', waarde: formatCenten(x.verschuldigd), nadruk: x.verschuldigd > 0 });
    }
    if (f.isExcl && (x.code === '21' || x.code === '9')) regels.push({ label: 'Op de bank', waarde: formatCenten(x.bank) });
    if (x.rubriek && !hint) hint = `Rubriek ${x.rubriek} van de btw-aangifte.`;
    if (!x.rubriek && f.soort === 'inkomst') hint = 'Vrijgestelde omzet telt niet mee in de btw-aangifte.';
    if (f.soort === 'uitgave' && f.grootboek === '4010' && x.excl > DREMPEL_ACTIVEREN) {
      hint = 'Boven € 450 excl. btw: dit is een investering. Kies de categorie Computers & apparatuur of Inventaris (activeren en afschrijven).';
    }
    if (f.soort === 'uitgave' && ACTIVA_KIESBAAR.has(f.grootboek)) {
      hint = x.excl < DREMPEL_ACTIVEREN ? 'Onder € 450 excl. btw mag je dit ook direct als kosten boeken.' : 'Investering: wordt geactiveerd en over de looptijd afgeschreven (Activa).';
    }
  } else {
    regels.push({ label: 'Btw', waarde: 'geen' });
    hint = SOORT_LABELS[f.soort].uitleg + '.';
  }
  return {
    geldig: true,
    regels,
    kwartaal,
    slot,
    hint,
    waarschuwing: x.afwijking ? `Let op: de btw wijkt ${formatCenten(Math.abs((handmatig ?? 0) - x.berekend))} af van de berekende ${formatCenten(x.berekend)}.` : null
  };
}

export function BoekingFormulier({
  stam,
  waarde,
  onWijzig,
  layout,
  suggesties,
  fouten,
  alleenLezen
}: {
  stam: Stamdata;
  waarde: Formulier;
  onWijzig: (f: Formulier) => void;
  layout: 'rij' | 'paneel';
  suggesties?: string[];
  fouten?: Record<string, string>;
  alleenLezen?: boolean;
}) {
  const id = useId();
  const f = waarde;
  const zet = (w: Partial<Formulier>) => onWijzig(pasAan(stam, f, w));
  const rekeningen = stam.rekeningen.filter((r) => r.actief || r.id === f.rekeningId);
  const categorieen = useMemo(() => kiesbareCategorieen(stam.grootboek, f.soort), [stam.grootboek, f.soort]);
  const kosten = categorieen.filter((g) => g.soort !== 'activa');
  const activa = categorieen.filter((g) => g.soort === 'activa');
  const kant = f.soort === 'inkomst' ? 'inkomst' : 'uitgave';
  const metBtw = !zonderBtw(f.soort);
  const fout = (veld: string) => fouten?.[veld];

  return (
    <fieldset className={`bh-form bh-form-${layout}`} disabled={alleenLezen}>
      <legend className="bh-sr">Boekingsregel</legend>

      <div className="bh-veld bh-veld-bank">
        <span className="bh-label" id={`${id}-bank`}>Bank</span>
        <div className="ag-segment bh-segment" role="radiogroup" aria-labelledby={`${id}-bank`}>
          {rekeningen.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={f.rekeningId === r.id} className={f.rekeningId === r.id ? 'is-aan' : ''} onClick={() => zet({ rekeningId: r.id })}>
              {r.naam}
            </button>
          ))}
        </div>
      </div>

      <label className="bh-veld bh-veld-datum">
        <span className="bh-label">Datum</span>
        <input className="ag-veld" type="date" value={f.datum} onChange={(e) => zet({ datum: e.target.value })} aria-invalid={Boolean(fout('datum'))} required />
      </label>

      <label className="bh-veld bh-veld-omschrijving">
        <span className="bh-label">Omschrijving</span>
        <input
          className="ag-veld"
          value={f.omschrijving}
          onChange={(e) => zet({ omschrijving: e.target.value })}
          placeholder={f.soort === 'inkomst' ? 'bv. Betaling factuur 2026-014' : 'bv. Adobe Creative Cloud'}
          maxLength={200}
          list={suggesties?.length ? `${id}-sug` : undefined}
          aria-invalid={Boolean(fout('omschrijving'))}
          required
        />
        {suggesties?.length ? (
          <datalist id={`${id}-sug`}>
            {suggesties.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        ) : null}
      </label>

      <label className="bh-veld bh-veld-bedrag">
        <span className="bh-label">
          Bedrag {metBtw && (f.btwCode === '21' || f.btwCode === '9') ? (f.isExcl ? 'excl. btw' : 'incl. btw') : ''}
        </span>
        <span className="bh-bedrag-invoer">
          <span aria-hidden="true">€</span>
          <input
            className="ag-veld"
            inputMode="decimal"
            value={f.bedrag}
            onChange={(e) => zet({ bedrag: e.target.value })}
            placeholder="0,00"
            aria-invalid={Boolean(fout('bedrag'))}
            required
          />
        </span>
      </label>

      <div className="bh-veld bh-veld-soort">
        <span className="bh-label" id={`${id}-soort`}>Soort</span>
        <div className="ag-segment bh-segment" role="radiogroup" aria-labelledby={`${id}-soort`}>
          {SOORTEN.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={f.soort === s} className={f.soort === s ? 'is-aan' : ''} onClick={() => zet({ soort: s })} title={SOORT_LABELS[s].uitleg}>
              {SOORT_LABELS[s].kort}
            </button>
          ))}
        </div>
      </div>

      {metBtw ? (
        <>
          <label className="bh-veld bh-veld-btw">
            <span className="bh-label">Btw</span>
            <select className="ag-veld" value={f.btwCode} onChange={(e) => zet({ btwCode: e.target.value as BtwCode })}>
              {BTW_KEUZES[kant].map((c) => (
                <option key={c} value={c}>
                  {btwLabel(c, f.soort)}
                </option>
              ))}
            </select>
          </label>
          <label className="bh-veld bh-veld-categorie">
            <span className="bh-label">Categorie</span>
            <select className="ag-veld" value={f.grootboek} onChange={(e) => zet({ grootboek: e.target.value })} aria-invalid={Boolean(fout('grootboek'))}>
              {f.soort === 'uitgave' ? (
                <>
                  <optgroup label="Kosten">
                    {kosten.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.naam}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Investering (activeren)">
                    {activa.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.naam}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                categorieen.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.naam}
                  </option>
                ))
              )}
            </select>
          </label>
        </>
      ) : f.soort === 'prive' ? (
        <>
          <div className="bh-veld bh-veld-btw">
            <span className="bh-label" id={`${id}-richting`}>Richting</span>
            <RichtingKeuze f={f} zet={zet} labelId={`${id}-richting`} />
          </div>
          <label className="bh-veld bh-veld-categorie">
            <span className="bh-label">Vennoot</span>
            <select className="ag-veld" value={f.vennootId} onChange={(e) => zet({ vennootId: e.target.value })} aria-invalid={Boolean(fout('vennootId'))}>
              <option value="">Kies…</option>
              {stam.vennoten
                .filter((v) => v.actief || v.id === f.vennootId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.naam}
                  </option>
                ))}
            </select>
          </label>
        </>
      ) : (
        <div className="bh-veld bh-veld-btw bh-veld-breed">
          <span className="bh-label" id={`${id}-richting`}>Richting</span>
          <RichtingKeuze f={f} zet={zet} labelId={`${id}-richting`} />
        </div>
      )}

      {metBtw && (f.btwCode === '21' || f.btwCode === '9') && (
        <label className="ag-schakel bh-veld-schakel">
          <input type="checkbox" checked={f.isExcl} onChange={(e) => zet({ isExcl: e.target.checked })} />
          Bedrag is excl. btw
        </label>
      )}

      {layout === 'paneel' && (
        <>
          {metBtw && f.btwCode !== '0' && f.btwCode !== 'geen' && !(f.soort === 'inkomst' && isVerlegd(f.btwCode)) && (
            <label className="bh-veld">
              <span className="bh-label">Btw handmatig (optioneel)</span>
              <span className="bh-bedrag-invoer">
                <span aria-hidden="true">€</span>
                <input className="ag-veld" inputMode="decimal" value={f.btwHandmatig} onChange={(e) => onWijzig({ ...f, btwHandmatig: e.target.value })} placeholder="automatisch" aria-invalid={Boolean(fout('btwHandmatig'))} />
              </span>
            </label>
          )}
          <label className="bh-veld">
            <span className="bh-label">Tegenpartij (optioneel)</span>
            <input className="ag-veld" value={f.tegenpartij} onChange={(e) => zet({ tegenpartij: e.target.value })} maxLength={200} />
          </label>
          <label className="bh-veld">
            <span className="bh-label">Notities (optioneel)</span>
            <textarea className="ag-veld" rows={3} value={f.notities} onChange={(e) => zet({ notities: e.target.value })} maxLength={2000} />
          </label>
        </>
      )}
    </fieldset>
  );
}

function RichtingKeuze({ f, zet, labelId }: { f: Formulier; zet: (w: Partial<Formulier>) => void; labelId: string }) {
  return (
    <div className="ag-segment bh-segment" role="radiogroup" aria-labelledby={labelId}>
      {(['af', 'bij'] as const).map((r) => (
        <button key={r} type="button" role="radio" aria-checked={f.richting === r} className={f.richting === r ? 'is-aan' : ''} onClick={() => zet({ richting: r })}>
          {RICHTING_LABELS[f.soort][r]}
        </button>
      ))}
    </div>
  );
}

/** De live uitkomst (excl., btw, kwartaal) als strook. */
export function Uitkomst({ u }: { u: Uitrekening }) {
  return (
    <div className="bh-uitkomst" aria-live="polite">
      <dl className="bh-uitkomst-cijfers">
        {u.geldig ? (
          u.regels.map((r) => (
            <div key={r.label} className={r.nadruk ? 'is-nadruk' : ''}>
              <dt>{r.label}</dt>
              <dd>{r.waarde}</dd>
            </div>
          ))
        ) : (
          <div>
            <dt>Btw</dt>
            <dd className="bh-zacht">vul een bedrag in</dd>
          </div>
        )}
        <div>
          <dt>Kwartaal</dt>
          <dd>{u.kwartaal ?? '—'}</dd>
        </div>
      </dl>
      {u.slot ? (
        <p className="bh-uitkomst-noot is-slot" role="alert">
          {u.slot}
        </p>
      ) : u.waarschuwing ? (
        <p className="bh-uitkomst-noot is-let-op">{u.waarschuwing}</p>
      ) : u.hint ? (
        <p className="bh-uitkomst-noot">{u.hint}</p>
      ) : null}
    </div>
  );
}
