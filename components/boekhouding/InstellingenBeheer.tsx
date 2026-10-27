'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bkApi, type BkApiFout } from '@/lib/boekhouding/client';
import { centenNaarInvoer, formatCenten, naarCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import { BTW_LABELS, type BtwCode } from '@/lib/boekhouding/kern/btw';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import type { Grootboekrekening, Instellingen, Vennoot } from '@/lib/boekhouding/model';

// Instellingen (stap 4): bedrijfsgegevens, winstverdeling, eigen categorieën en het memoriaal
// (beginbalans en correcties). Elk blok slaat los op via /api/boekhouding/instellingen/**.

function useOpslaan() {
  const router = useRouter();
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  async function doe(fn: () => Promise<unknown>, ok: string) {
    setBezig(true);
    setMelding(null);
    try {
      await fn();
      setMelding({ soort: 'ok', tekst: ok });
      router.refresh();
      return true;
    } catch (e) {
      setMelding({ soort: 'fout', tekst: (e as BkApiFout).message });
      return false;
    } finally {
      setBezig(false);
    }
  }
  const meldingEl = melding ? <p className={`bh-melding is-${melding.soort}`} role={melding.soort === 'fout' ? 'alert' : 'status'}>{melding.tekst}</p> : null;
  return { bezig, doe, meldingEl };
}

// ------------------------------------------------------------------ bedrijfsgegevens
export function BedrijfsgegevensForm({ inst }: { inst: Instellingen }) {
  const { bezig, doe, meldingEl } = useOpslaan();
  const [w, setW] = useState({ bedrijfsnaam: inst.bedrijfsnaam, kvk: inst.kvk ?? '', btwNummer: inst.btwNummer ?? '', startdatum: inst.startdatum ?? '' });
  return (
    <form
      className="bh-kaart bh-form"
      onSubmit={(e) => {
        e.preventDefault();
        doe(() => bkApi('/api/boekhouding/instellingen', { method: 'PATCH', body: w }), 'Bedrijfsgegevens opgeslagen.');
      }}
    >
      <div className="bh-rek-velden">
        <label className="bh-veld">
          <span className="bh-label">Bedrijfsnaam</span>
          <input className="ag-veld" value={w.bedrijfsnaam} onChange={(e) => setW({ ...w, bedrijfsnaam: e.target.value })} maxLength={200} required />
        </label>
        <label className="bh-veld">
          <span className="bh-label">KvK-nummer</span>
          <input className="ag-veld" value={w.kvk} onChange={(e) => setW({ ...w, kvk: e.target.value })} inputMode="numeric" placeholder="12345678" />
        </label>
        <label className="bh-veld">
          <span className="bh-label">Btw-identificatienummer</span>
          <input className="ag-veld" value={w.btwNummer} onChange={(e) => setW({ ...w, btwNummer: e.target.value })} placeholder="NL123456789B01" />
        </label>
        <label className="bh-veld">
          <span className="bh-label">Start administratie</span>
          <input className="ag-veld" type="date" value={w.startdatum} onChange={(e) => setW({ ...w, startdatum: e.target.value })} />
        </label>
      </div>
      <p className="bh-kaart-sub">KvK- en btw-nummer komen op het jaarrapport en in de auditfile (XAF). Vanaf de startdatum verwacht de btw-aangifte kwartalen.</p>
      {meldingEl}
      <div className="bh-rek-form-voet">
        <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
          {bezig ? 'Bezig…' : 'Opslaan'}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ vennoten
export function VennotenForm({ vennoten, eigenaar }: { vennoten: Vennoot[]; eigenaar: boolean }) {
  const { bezig, doe, meldingEl } = useOpslaan();
  const [aandelen, setAandelen] = useState<Record<string, string>>(() => Object.fromEntries(vennoten.map((v) => [v.id, String(v.aandeel).replace('.', ',')])));
  const somAandelen = vennoten.filter((v) => v.actief).reduce((t, v) => t + (Number((aandelen[v.id] ?? '0').replace(',', '.')) || 0), 0);
  const klopt = Math.round(somAandelen * 100) === 10000;
  return (
    <form
      className="bh-vennoten-form"
      onSubmit={(e) => {
        e.preventDefault();
        doe(
          () => bkApi('/api/boekhouding/instellingen/vennoten', { method: 'PATCH', body: { aandelen: vennoten.map((v) => ({ id: v.id, aandeel: aandelen[v.id] })) } }),
          'Winstverdeling opgeslagen.'
        );
      }}
    >
      <ul className="bh-vennoten">
        {vennoten.map((v) => (
          <li key={v.id} className="bh-vennoot">
            <span className="bh-vennoot-naam">{v.naam}</span>
            <label className="bh-vennoot-aandeel">
              <span className="bh-sr">Winstaandeel {v.naam}</span>
              <input
                className="ag-veld bh-aandeel-veld"
                inputMode="decimal"
                value={aandelen[v.id] ?? ''}
                onChange={(e) => setAandelen({ ...aandelen, [v.id]: e.target.value })}
                disabled={!eigenaar}
              />
              <span>% winstaandeel</span>
            </label>
            <span className="bh-rek-meta">
              kapitaal {v.grootboekKapitaal} · privé {v.grootboekPrive}
            </span>
          </li>
        ))}
      </ul>
      {meldingEl}
      <div className="bh-rek-form-voet bh-vennoten-voet">
        <span className={`bh-kaart-sub${klopt ? '' : ' bh-demo-fout'}`}>Samen {String(Math.round(somAandelen * 100) / 100).replace('.', ',')}%{klopt ? '' : ' (moet 100% zijn)'}</span>
        {eigenaar ? (
          <button type="submit" className="db-knop" disabled={bezig || !klopt}>
            {bezig ? 'Bezig…' : 'Winstverdeling opslaan'}
          </button>
        ) : (
          <span className="bh-kaart-sub">Alleen de eigenaar wijzigt de winstverdeling.</span>
        )}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ categorieën
const btwKort = (b: BtwCode | null) => (b ? (b === 'geen' ? 'geen btw' : b === 'eu_dienst' ? 'EU' : b === 'buiten_eu' ? 'buiten EU' : b === 'verlegd_nl' ? 'verlegd' : `${b}%`) : '—');

export function GrootboekBeheer({ grootboek }: { grootboek: Grootboekrekening[] }) {
  const { bezig, doe, meldingEl } = useOpslaan();
  const [nieuw, setNieuw] = useState<{ naam: string; soort: 'kosten' | 'opbrengst'; btw: BtwCode | '' } | null>(null);
  const kiesbaar = grootboek.filter((g) => g.soort === 'kosten' || g.soort === 'opbrengst');
  return (
    <>
      <div className="bh-gb">
        {kiesbaar.map((g) => (
          <div key={g.code} className={`bh-gb-rij${g.actief ? '' : ' is-uit'}`}>
            <span className="bh-gb-code">{g.code}</span>
            <span className="bh-gb-naam">
              {g.naam}
              {g.hint && <span className="bh-rek-meta"> · {g.hint}</span>}
              {!g.systeem && (
                <button
                  type="button"
                  className="ag-link-knop bh-gb-actie"
                  disabled={bezig}
                  onClick={() => doe(() => bkApi('/api/boekhouding/instellingen/grootboek', { method: 'PATCH', body: { code: g.code, actief: !g.actief } }), g.actief ? `${g.naam} staat uit.` : `${g.naam} staat weer aan.`)}
                >
                  {g.actief ? 'uitzetten' : 'aanzetten'}
                </button>
              )}
            </span>
            <span className="bh-gb-soort">{g.soort === 'kosten' ? 'kosten' : 'opbrengst'}</span>
            <span className="bh-gb-btw">{btwKort(g.btw)}</span>
          </div>
        ))}
      </div>
      {meldingEl}
      {nieuw ? (
        <form
          className="bh-kaart bh-rek-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await doe(() => bkApi('/api/boekhouding/instellingen/grootboek', { method: 'POST', body: { ...nieuw, btw: nieuw.btw || null } }), `Categorie ${nieuw.naam} toegevoegd.`)) setNieuw(null);
          }}
        >
          <h3 className="bh-kaart-titel">Categorie toevoegen</h3>
          <div className="bh-rek-velden">
            <label className="bh-veld">
              <span className="bh-label">Naam</span>
              <input className="ag-veld" value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} maxLength={120} placeholder="bv. Vakliteratuur" required />
            </label>
            <label className="bh-veld">
              <span className="bh-label">Soort</span>
              <select className="ag-veld" value={nieuw.soort} onChange={(e) => setNieuw({ ...nieuw, soort: e.target.value as 'kosten' | 'opbrengst' })}>
                <option value="kosten">Kosten</option>
                <option value="opbrengst">Opbrengst</option>
              </select>
            </label>
            <label className="bh-veld">
              <span className="bh-label">Standaard btw</span>
              <select className="ag-veld" value={nieuw.btw} onChange={(e) => setNieuw({ ...nieuw, btw: e.target.value as BtwCode | '' })}>
                {(['21', '9', '0', 'geen', 'eu_dienst', 'buiten_eu', 'verlegd_nl'] as BtwCode[]).map((c) => (
                  <option key={c} value={c}>
                    {nieuw.soort === 'kosten' ? BTW_LABELS[c].uitgave : BTW_LABELS[c].inkomst}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="bh-rek-form-voet">
            <button type="button" className="db-knop" onClick={() => setNieuw(null)}>
              Annuleren
            </button>
            <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
              {bezig ? 'Bezig…' : 'Toevoegen'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="db-knop" onClick={() => setNieuw({ naam: '', soort: 'kosten', btw: '21' })}>
          + Categorie toevoegen
        </button>
      )}
    </>
  );
}

// ------------------------------------------------------------------ memoriaal
export interface MemoriaalRij {
  id: string;
  datum: Datum;
  omschrijving: string;
  soort: 'beginbalans' | 'correctie' | 'jaarafsluiting';
  totaal: Centen;
  regels: { grootboek: string; naam: string; debet: Centen; credit: Centen }[];
  vergrendeld: boolean;
}

interface ConceptRegel {
  grootboek: string;
  debet: string;
  credit: string;
}

const SOORT_LABEL: Record<MemoriaalRij['soort'], string> = { beginbalans: 'beginbalans', correctie: 'correctie', jaarafsluiting: 'jaarafsluiting' };

export function MemoriaalBeheer({
  posten,
  rekeningen,
  vandaag,
  voorstel
}: {
  posten: MemoriaalRij[];
  rekeningen: { code: string; naam: string }[];
  vandaag: Datum;
  /** Voorstel: het beginvermogen (0900) verdelen over de vennoten. */
  voorstel: { grootboek: string; debet: Centen; credit: Centen }[];
}) {
  const { bezig, doe, meldingEl } = useOpslaan();
  const [open, setOpen] = useState<string | null>(null);
  const leegConcept = () => ({ datum: vandaag, omschrijving: '', soort: 'correctie' as 'beginbalans' | 'correctie', regels: [{ grootboek: '', debet: '', credit: '' }, { grootboek: '', debet: '', credit: '' }] as ConceptRegel[] });
  const [concept, setConcept] = useState<ReturnType<typeof leegConcept> | null>(null);

  const totalen = useMemo(() => {
    if (!concept) return { d: 0, c: 0, ok: false };
    let d = 0;
    let c = 0;
    let ok = true;
    for (const r of concept.regels) {
      const dd = r.debet.trim() ? naarCenten(r.debet) : 0;
      const cc = r.credit.trim() ? naarCenten(r.credit) : 0;
      if (dd === null || cc === null || dd < 0 || cc < 0) ok = false;
      d += dd ?? 0;
      c += cc ?? 0;
    }
    return { d, c, ok };
  }, [concept]);

  function zetRegel(i: number, w: Partial<ConceptRegel>) {
    setConcept((x) => (x ? { ...x, regels: x.regels.map((r, n) => (n === i ? { ...r, ...w } : r)) } : x));
  }

  return (
    <>
      {posten.length === 0 ? (
        <p className="bh-leeg">Nog geen memoriaalposten.</p>
      ) : (
        <ul className="bh-mem-lijst">
          {posten.map((m) => (
            <li key={m.id} className="bh-mem">
              <button type="button" className="bh-mem-kop" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                <span className="bh-rij-datum">{korteDatum(m.datum)}</span>
                <span className="bh-mem-titel">{m.omschrijving}</span>
                <span className={`bh-pil ${m.soort === 'jaarafsluiting' ? 'is-koppel' : 'is-zacht'}`}>{SOORT_LABEL[m.soort]}</span>
                <span className="bh-rij-bedrag">{formatCenten(m.totaal)}</span>
              </button>
              {open === m.id && (
                <div className="bh-mem-regels">
                  {m.regels.map((r, i) => (
                    <div key={i} className="bh-mem-regel">
                      <span className="bh-gb-code">{r.grootboek}</span>
                      <span>{r.naam}</span>
                      <span className="bh-r">{r.debet ? formatCenten(r.debet) : ''}</span>
                      <span className="bh-r">{r.credit ? formatCenten(r.credit) : ''}</span>
                    </div>
                  ))}
                  {m.soort !== 'jaarafsluiting' &&
                    (m.vergrendeld ? (
                      <p className="bh-kaart-sub">Vergrendeld (aangifte ingediend of boekjaar afgesloten).</p>
                    ) : (
                      <button
                        type="button"
                        className="ag-link-knop bh-verwijder"
                        disabled={bezig}
                        onClick={() => {
                          if (window.confirm('Deze memoriaalpost verwijderen?')) doe(() => bkApi(`/api/boekhouding/memoriaal?id=${m.id}`, { method: 'DELETE' }), 'Memoriaalpost verwijderd.');
                        }}
                      >
                        Verwijderen
                      </button>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {meldingEl}
      {concept ? (
        <form
          className="bh-kaart bh-rek-form bh-mem-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { ...concept, regels: concept.regels.filter((r) => r.grootboek || r.debet || r.credit) };
            if (await doe(() => bkApi('/api/boekhouding/memoriaal', { method: 'POST', body }), 'Memoriaalpost geboekt.')) setConcept(null);
          }}
        >
          <h3 className="bh-kaart-titel">Memoriaalpost</h3>
          <div className="bh-rek-velden">
            <label className="bh-veld">
              <span className="bh-label">Datum</span>
              <input className="ag-veld" type="date" value={concept.datum} onChange={(e) => setConcept({ ...concept, datum: e.target.value })} required />
            </label>
            <label className="bh-veld">
              <span className="bh-label">Omschrijving</span>
              <input className="ag-veld" value={concept.omschrijving} onChange={(e) => setConcept({ ...concept, omschrijving: e.target.value })} maxLength={200} required />
            </label>
            <label className="bh-veld">
              <span className="bh-label">Soort</span>
              <select className="ag-veld" value={concept.soort} onChange={(e) => setConcept({ ...concept, soort: e.target.value as 'beginbalans' | 'correctie' })}>
                <option value="correctie">Correctie</option>
                <option value="beginbalans">Beginbalans</option>
              </select>
            </label>
          </div>
          <div className="bh-mem-invoer" role="group" aria-label="Regels">
            <div className="bh-mem-invoer-rij bh-th">
              <span>Rekening</span>
              <span className="bh-r">Debet</span>
              <span className="bh-r">Credit</span>
              <span />
            </div>
            {concept.regels.map((r, i) => (
              <div key={i} className="bh-mem-invoer-rij">
                <select className="ag-veld" value={r.grootboek} onChange={(e) => zetRegel(i, { grootboek: e.target.value })} aria-label={`Rekening regel ${i + 1}`}>
                  <option value="">Kies een rekening…</option>
                  {rekeningen.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.code} · {g.naam}
                    </option>
                  ))}
                </select>
                <input className="ag-veld bh-r" inputMode="decimal" value={r.debet} onChange={(e) => zetRegel(i, { debet: e.target.value, credit: e.target.value ? '' : r.credit })} placeholder="0,00" aria-label={`Debet regel ${i + 1}`} />
                <input className="ag-veld bh-r" inputMode="decimal" value={r.credit} onChange={(e) => zetRegel(i, { credit: e.target.value, debet: e.target.value ? '' : r.debet })} placeholder="0,00" aria-label={`Credit regel ${i + 1}`} />
                <button type="button" className="ag-link-knop" onClick={() => setConcept({ ...concept, regels: concept.regels.filter((_, n) => n !== i) })} disabled={concept.regels.length <= 2} aria-label={`Regel ${i + 1} weghalen`}>
                  ×
                </button>
              </div>
            ))}
            <div className="bh-mem-invoer-rij bh-mem-totaal">
              <button type="button" className="ag-link-knop" onClick={() => setConcept({ ...concept, regels: [...concept.regels, { grootboek: '', debet: '', credit: '' }] })}>
                + Regel
              </button>
              <span className="bh-r">{formatCenten(totalen.d)}</span>
              <span className="bh-r">{formatCenten(totalen.c)}</span>
              <span />
            </div>
          </div>
          <p className={`bh-kaart-sub${totalen.d === totalen.c && totalen.ok && totalen.d > 0 ? ' is-bij' : ''}`}>
            {!totalen.ok ? 'Een bedrag is ongeldig.' : totalen.d === totalen.c ? (totalen.d ? 'De post sluit.' : 'Vul de bedragen in.') : `Verschil ${formatCenten(totalen.d - totalen.c)}: debet en credit moeten gelijk zijn.`} Bank,
            debiteuren, crediteuren en btw boek je niet in het memoriaal (die volgen de bank, facturen, bonnetjes en de aangifte).
          </p>
          <div className="bh-rek-form-voet">
            <button type="button" className="db-knop" onClick={() => setConcept(null)}>
              Annuleren
            </button>
            <button type="submit" className="db-knop db-knop-primair" disabled={bezig || !totalen.ok || totalen.d !== totalen.c || totalen.d === 0}>
              {bezig ? 'Bezig…' : 'Boeken'}
            </button>
          </div>
        </form>
      ) : (
        <div className="bh-rek-acties">
          <button type="button" className="db-knop" onClick={() => setConcept(leegConcept())}>
            + Memoriaalpost
          </button>
          {voorstel.length > 0 && (
            <button
              type="button"
              className="db-knop"
              onClick={() =>
                setConcept({
                  ...leegConcept(),
                  soort: 'beginbalans',
                  omschrijving: 'Beginvermogen verdelen over de vennoten',
                  regels: voorstel.map((r) => ({ grootboek: r.grootboek, debet: r.debet ? centenNaarInvoer(r.debet) : '', credit: r.credit ? centenNaarInvoer(r.credit) : '' }))
                })
              }
            >
              Beginvermogen verdelen
            </button>
          )}
        </div>
      )}
    </>
  );
}
