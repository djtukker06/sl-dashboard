'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { DREMPEL_ACTIVEREN } from '@/lib/boekhouding/kern/constanten';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { BTW_LABELS } from '@/lib/boekhouding/kern/btw';
import { aangifteDeadline, isVergrendeld, jaarVan, korteDatum, kwartaalLabel, kwartaalVan, type Datum, type Kwartaal } from '@/lib/boekhouding/kern/periode';
import {
  SOORT_LABELS,
  berekenBoeking,
  formatIban,
  lopendSaldo,
  saldoPerRekening,
  sorteerBoekingen,
  totalen,
  type Boeking,
  type BoekingSoort,
  type Stamdata
} from '@/lib/boekhouding/model';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';
import { factuurPosten, koppelBronVoor, koppelSuggesties, koppelVergrendelFout, restVanBoeking, uitgavePosten } from '@/lib/boekhouding/kern/afletteren';
import type { FactuurBron, KoppelBron, Koppeling, UitgaveBron } from '@/lib/boekhouding/kern/bronnen';
import type { Centen } from '@/lib/boekhouding/kern/geld';
import { BoekingFormulier, Uitkomst, formulierNaarBody, leegFormulier, pasAan, rekenUit, type Formulier } from './BoekingFormulier';
import { BoekingPaneel } from './BoekingPaneel';
import type { KoppelInfo } from './KoppelSuggesties';

export interface BankFilter {
  rekening: string;
  jaar: number | 'alle';
  kw: 0 | Kwartaal;
  soort: '' | BoekingSoort;
  status: '' | 'te_verwerken';
  q: string;
}

// Bank & boekingen: alles wat er op de rekeningen gebeurt, in regels. Bovenaan de saldi en
// de snelle invoer (bank standaard RegioBank; btw en kwartaal live), daaronder de lijst met
// filters, totalen en het lopende saldo per rekening. Een regel openen = zijpaneel (met
// afletteren tegen een factuur of bonnetje).
export function BankApp({
  stam,
  boekingen: begin,
  vandaag,
  filter: beginFilter,
  koppelingen: beginKoppelingen,
  facturen,
  uitgaven,
  bronBtw,
  activa = [],
  openId: beginOpen
}: {
  stam: Stamdata;
  boekingen: Boeking[];
  vandaag: Datum;
  filter: BankFilter;
  koppelingen: Koppeling[];
  facturen: FactuurBron[];
  uitgaven: UitgaveBron[];
  /** Btw uit facturen en bonnetjes per kwartaal ("JJJJ-Q"). */
  bronBtw: Record<string, { verschuldigd: Centen; voorbelasting: Centen }>;
  /** Activa met een bankregel als bron (voor het label en de link in het paneel). */
  activa?: { id: string; boekingId: string; omschrijving: string }[];
  openId?: string | null;
}) {
  const activumVan = useMemo(() => new Map(activa.map((a) => [a.boekingId, a])), [activa]);
  const [lijst, setLijst] = useState<Boeking[]>(begin);
  const [koppel, setKoppel] = useState<Koppeling[]>(beginKoppelingen);
  const [form, setForm] = useState<Formulier>(() => leegFormulier(stam, vandaag));
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<{ tekst: string; soort: 'ok' | 'fout' } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [filter, setFilter] = useState<BankFilter>(beginFilter);
  const [openId, setOpenId] = useState<string | null>(beginOpen ?? null);
  const [aantal, setAantal] = useState(100);
  const omschrijvingRef = useRef<HTMLDivElement>(null);

  const rekeningen = stam.rekeningen.filter((r) => r.actief);
  const naamVan = useMemo(() => new Map(stam.rekeningen.map((r) => [r.id, r.naam])), [stam.rekeningen]);
  const categorieVan = useMemo(() => new Map(stam.grootboek.map((g) => [g.code, g.naam])), [stam.grootboek]);
  const vennootVan = useMemo(() => new Map(stam.vennoten.map((v) => [v.id, v.naam])), [stam.vennoten]);
  const saldi = useMemo(() => saldoPerRekening(lijst, stam.rekeningen), [lijst, stam.rekeningen]);
  const lopend = useMemo(() => lopendSaldo(lijst, stam.rekeningen), [lijst, stam.rekeningen]);
  const uitrekening = rekenUit(stam, form);

  // Afletteren: welke regels zijn betalingen van een factuur/bonnetje, wat staat er nog open.
  const perBoeking = useMemo(() => {
    const m = new Map<string, Koppeling[]>();
    for (const k of koppel) m.set(k.boekingId, [...(m.get(k.boekingId) ?? []), k]);
    return m;
  }, [koppel]);
  const gekoppeld = useMemo(() => new Set(perBoeking.keys()), [perBoeking]);
  const fPosten = useMemo(() => factuurPosten(facturen, koppel, vandaag), [facturen, koppel, vandaag]);
  const uPosten = useMemo(() => uitgavePosten(uitgaven, koppel, vandaag), [uitgaven, koppel, vandaag]);
  const factuurVan = useMemo(() => new Map(facturen.map((f) => [f.id, f])), [facturen]);
  const uitgaveVan = useMemo(() => new Map(uitgaven.map((u) => [u.id, u])), [uitgaven]);
  const koppelLabel = (k: Koppeling) => {
    if (k.bron === 'factuur') {
      const f = factuurVan.get(k.bronId);
      return f ? { titel: `Factuur ${f.nummer}`, sub: f.klant, bestaat: true } : { titel: 'Verwijderde factuur', sub: 'De factuur bestaat niet meer', bestaat: false };
    }
    const u = uitgaveVan.get(k.bronId);
    return u ? { titel: u.leverancier || 'Bonnetje', sub: u.omschrijving || 'Bonnetje', bestaat: true } : { titel: 'Verwijderd bonnetje', sub: 'Het bonnetje bestaat niet meer', bestaat: false };
  };
  // Regels die nog te verwerken zijn en een goede koppelsuggestie hebben.
  const metSuggestie = useMemo(() => {
    const s = new Set<string>();
    for (const b of lijst) {
      if (b.status !== 'te_verwerken' || gekoppeld.has(b.id)) continue;
      if (koppelSuggesties(b, fPosten, uPosten, koppel, 1).length) s.add(b.id);
    }
    return s;
  }, [lijst, gekoppeld, fPosten, uPosten, koppel]);

  // Btw-kaart: het eerstvolgende kwartaal waarvoor nog aangifte moet worden gedaan (het vorige
  // kwartaal zolang dat niet is ingediend, anders het lopende): facturen en bonnetjes plus de
  // losse bankregels (gekoppelde betalingen tellen niet dubbel).
  const nuJaar = jaarVan(vandaag);
  const huidigKw = kwartaalVan(vandaag);
  const vorig = huidigKw === 1 ? { jaar: nuJaar - 1, kw: 4 as Kwartaal } : { jaar: nuJaar, kw: (huidigKw - 1) as Kwartaal };
  const vorigOpen = !stam.vergrendeling.aangiften.some((a) => a.jaar === vorig.jaar && a.kwartaal === vorig.kw);
  const btwKw = vorigOpen ? vorig : { jaar: nuJaar, kw: huidigKw };
  const btwNu = useMemo(() => {
    const t = totalen(
      lijst.filter((b) => jaarVan(b.datum) === btwKw.jaar && kwartaalVan(b.datum) === btwKw.kw),
      gekoppeld
    );
    const bron = bronBtw[`${btwKw.jaar}-${btwKw.kw}`] ?? { verschuldigd: 0, voorbelasting: 0 };
    return t.verschuldigd + bron.verschuldigd - t.voorbelasting - bron.voorbelasting;
  }, [lijst, btwKw.jaar, btwKw.kw, gekoppeld, bronBtw]);
  const teVerwerken = lijst.filter((b) => b.status === 'te_verwerken').length;

  const jaren = useMemo(() => {
    const s = new Set<number>([nuJaar, ...lijst.map((b) => jaarVan(b.datum))]);
    return [...s].sort((a, b) => b - a);
  }, [lijst, nuJaar]);

  const gefilterd = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return sorteerBoekingen(lijst)
      .reverse()
      .filter((b) => {
        if (filter.rekening !== 'alle' && b.rekeningId !== filter.rekening) return false;
        if (filter.jaar !== 'alle' && jaarVan(b.datum) !== filter.jaar) return false;
        if (filter.kw && kwartaalVan(b.datum) !== filter.kw) return false;
        if (filter.soort && b.soort !== filter.soort) return false;
        if (filter.status && b.status !== filter.status) return false;
        if (q) {
          const tekst = `${b.omschrijving} ${b.tegenpartij ?? ''} ${b.notities ?? ''} ${categorieVan.get(b.grootboek ?? '') ?? ''}`.toLowerCase();
          const bedrag = formatCenten(berekenBoeking(b).btw.bank);
          if (!tekst.includes(q) && !bedrag.includes(q)) return false;
        }
        return true;
      });
  }, [lijst, filter, categorieVan]);
  const som = useMemo(() => totalen(gefilterd, gekoppeld), [gefilterd, gekoppeld]);

  const suggesties = useMemo(() => {
    const gezien = new Set<string>();
    const uit: string[] = [];
    for (const b of sorteerBoekingen(lijst).reverse()) {
      const k = b.omschrijving.toLowerCase();
      if (gezien.has(k)) continue;
      gezien.add(k);
      uit.push(b.omschrijving);
      if (uit.length >= 60) break;
    }
    return uit;
  }, [lijst]);

  // Filters in de URL (zonder herladen), zodat een link of verversen dezelfde lijst toont.
  useEffect(() => {
    const u = new URL(window.location.href);
    const zet = (k: string, v: string | null) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    zet('rekening', filter.rekening !== 'alle' ? filter.rekening : null);
    zet('jaar', filter.jaar !== nuJaar ? String(filter.jaar) : null);
    zet('kw', filter.kw ? String(filter.kw) : null);
    zet('soort', filter.soort || null);
    zet('status', filter.status || null);
    zet('q', filter.q.trim() || null);
    zet('open', null);
    const url = u.pathname + u.search;
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, '', url);
  }, [filter, nuJaar]);

  useEffect(() => {
    if (!melding) return;
    const t = window.setTimeout(() => setMelding(null), 5000);
    return () => window.clearTimeout(t);
  }, [melding]);

  // Eerder gebruikte omschrijving: categorie, btw, soort en bank overnemen.
  function wijzigSnel(f: Formulier) {
    if (f.omschrijving !== form.omschrijving && !form.bedrag) {
      const vorige = sorteerBoekingen(lijst)
        .reverse()
        .find((b) => b.omschrijving.toLowerCase() === f.omschrijving.trim().toLowerCase());
      if (vorige) {
        let n = pasAan(stam, f, { soort: vorige.soort });
        n = {
          ...n,
          rekeningId: vorige.rekeningId ?? n.rekeningId,
          richting: vorige.richting,
          btwCode: vorige.btwCode,
          btwGekozen: true,
          grootboek: vorige.grootboek ?? n.grootboek,
          vennootId: vorige.vennootId ?? n.vennootId,
          tegenpartij: vorige.tegenpartij ?? ''
        };
        setForm(n);
        return;
      }
    }
    setForm(f);
  }

  async function boek(e: React.FormEvent) {
    e.preventDefault();
    if (bezig) return;
    setBezig(true);
    setFouten({});
    try {
      const { boeking } = await bkApi<{ boeking: Boeking }>('/api/boekhouding/boekingen', { method: 'POST', body: formulierNaarBody(form) });
      setLijst((l) => [...l, boeking]);
      const r = berekenBoeking(boeking);
      setMelding({ tekst: `Geboekt: ${boeking.omschrijving} — ${formatCenten(r.btw.bank)} · ${kwartaalLabel(r.jaar, r.kwartaal)}`, soort: 'ok' });
      // Volgende regel: bank, datum en soort blijven staan (snel achter elkaar invoeren).
      setForm(leegFormulier(stam, vandaag, { rekeningId: form.rekeningId, datum: form.datum, soort: form.soort, richting: form.richting, grootboek: form.grootboek, btwCode: form.btwCode, vennootId: form.vennootId }));
      omschrijvingRef.current?.querySelector<HTMLInputElement>('.bh-veld-omschrijving input')?.focus();
    } catch (err) {
      const f = err as BkApiFout;
      if (f.veld) setFouten({ [f.veld]: f.message });
      setMelding({ tekst: f.message, soort: 'fout' });
    } finally {
      setBezig(false);
    }
  }

  const open = openId ? lijst.find((b) => b.id === openId) ?? null : null;
  const koppelInfo: KoppelInfo | undefined = useMemo(() => {
    if (!open) return undefined;
    const bron = koppelBronVoor(open);
    if (!bron) return undefined;
    const eigen = perBoeking.get(open.id) ?? [];
    const kandidaten =
      bron === 'factuur'
        ? fPosten.filter((p) => p.open !== 0).map((p) => ({ bron: 'factuur' as const, id: p.doc.id, titel: `Factuur ${p.doc.nummer}`, sub: p.doc.klant, datum: p.doc.datum, open: p.open }))
        : uPosten.filter((p) => p.open !== 0).map((p) => ({ bron: 'uitgave' as const, id: p.doc.id, titel: p.doc.leverancier || 'Bonnetje', sub: p.doc.omschrijving || '', datum: p.doc.datum as Datum, open: p.open }));
    return {
      bron,
      koppelingen: eigen,
      label: koppelLabel,
      suggesties: koppelSuggesties(open, fPosten, uPosten, koppel, 3),
      kandidaten: kandidaten.filter((k) => !eigen.some((e) => e.bronId === k.id)).sort((a, b) => (a.datum < b.datum ? 1 : -1)),
      rest: restVanBoeking(open, koppel),
      slot: koppelVergrendelFout(open, stam.vergrendeling)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, perBoeking, fPosten, uPosten, koppel, stam.vergrendeling]);

  async function koppelen(bron: KoppelBron, bronId: string, bedrag?: Centen) {
    if (!open) return;
    const { koppeling } = await bkApi<{ koppeling: Koppeling }>('/api/boekhouding/koppelingen', { method: 'POST', body: { boekingId: open.id, bron, bronId, bedrag } });
    setKoppel((k) => [...k, koppeling]);
    setLijst((l) => l.map((b) => (b.id === open.id && b.status === 'te_verwerken' ? { ...b, status: 'geboekt' } : b)));
    setMelding({ tekst: `Gekoppeld: ${koppelLabel(koppeling).titel} — ${formatCenten(koppeling.bedrag)}`, soort: 'ok' });
  }

  async function ontkoppelen(id: string) {
    await bkApi(`/api/boekhouding/koppelingen?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setKoppel((k) => k.filter((x) => x.id !== id));
    setMelding({ tekst: 'Koppeling verwijderd; de bankregel staat weer los.', soort: 'ok' });
  }
  const zetFilter = (w: Partial<BankFilter>) => {
    setFilter((f) => ({ ...f, ...w }));
    setAantal(100);
  };

  return (
    <div className="bh-inhoud">
      {/* ---------- saldi ---------- */}
      <section className="bh-saldi" aria-label="Saldi">
        {rekeningen.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`bh-saldo${filter.rekening === r.id ? ' is-aan' : ''}`}
            onClick={() => zetFilter({ rekening: filter.rekening === r.id ? 'alle' : r.id })}
            aria-pressed={filter.rekening === r.id}
          >
            <span className="bh-saldo-naam">
              {r.naam}
              {r.standaard && <span className="bh-pil">standaard</span>}
            </span>
            <span className="bh-saldo-bedrag">{formatCenten(saldi.get(r.id) ?? 0)}</span>
            <span className="bh-saldo-sub">{r.iban ? formatIban(r.iban) : 'Saldo volgens de boekingen'}</span>
          </button>
        ))}
        <Link className="bh-saldo is-info" href={`/boekhouding/btw/${btwKw.jaar}/${btwKw.kw}`}>
          <span className="bh-saldo-naam">
            Btw {kwartaalLabel(btwKw.jaar, btwKw.kw)}
            {vorigOpen && <span className="bh-pil is-let-op">aangifte doen</span>}
          </span>
          <span className="bh-saldo-bedrag">{formatCenten(Math.abs(btwNu))}</span>
          <span className="bh-saldo-sub">
            {btwNu >= 0 ? 'te betalen' : 'terug te vragen'} · uiterlijk {korteDatum(aangifteDeadline(btwKw.jaar, btwKw.kw))}
          </span>
        </Link>
        <button type="button" className={`bh-saldo is-info${filter.status ? ' is-aan' : ''}`} onClick={() => zetFilter({ status: filter.status ? '' : 'te_verwerken', jaar: 'alle', kw: 0 })} aria-pressed={Boolean(filter.status)}>
          <span className="bh-saldo-naam">Te verwerken</span>
          <span className={`bh-saldo-bedrag${teVerwerken ? ' is-let-op' : ''}`}>{teVerwerken}</span>
          <span className="bh-saldo-sub">{teVerwerken ? 'regels controleren' : 'alles verwerkt'}</span>
        </button>
      </section>

      {/* ---------- snelle invoer ---------- */}
      <section className="bh-kaart bh-invoer" aria-labelledby="bh-invoer-titel">
        <header className="bh-kaart-kop">
          <h2 id="bh-invoer-titel" className="bh-kaart-titel">
            Nieuwe boeking
          </h2>
          <p className="bh-kaart-sub">Btw en kwartaal worden automatisch berekend.</p>
        </header>
        <form onSubmit={boek} noValidate>
          <div ref={omschrijvingRef}>
            <BoekingFormulier stam={stam} waarde={form} onWijzig={wijzigSnel} layout="rij" suggesties={suggesties} fouten={fouten} />
          </div>
          <div className="bh-invoer-voet">
            <Uitkomst u={uitrekening} />
            <button type="submit" className="db-knop db-knop-primair bh-boek-knop" disabled={bezig || Boolean(uitrekening.slot)}>
              {bezig ? 'Bezig…' : 'Boeken'}
            </button>
          </div>
        </form>
      </section>

      {melding && (
        <p className={`bh-melding is-${melding.soort}`} role={melding.soort === 'fout' ? 'alert' : 'status'}>
          {melding.tekst}
        </p>
      )}

      {/* ---------- filters ---------- */}
      <section className="bh-lijst-blok" aria-labelledby="bh-lijst-titel">
        <header className="bh-lijst-kop">
          <h2 id="bh-lijst-titel" className="bh-kaart-titel">
            Boekingen
          </h2>
          <nav className="bh-rek-tabs" aria-label="Rekening">
            {[{ id: 'alle', naam: 'Alle' }, ...rekeningen].map((r) => (
              <button key={r.id} type="button" className={`bh-rek-tab${filter.rekening === r.id ? ' is-aan' : ''}`} onClick={() => zetFilter({ rekening: r.id })} aria-pressed={filter.rekening === r.id}>
                {r.naam}
              </button>
            ))}
          </nav>
        </header>

        <div className="bh-filters">
          <select className="ag-veld bh-filter" value={String(filter.jaar)} onChange={(e) => zetFilter({ jaar: e.target.value === 'alle' ? 'alle' : Number(e.target.value) })} aria-label="Jaar">
            <option value="alle">Alle jaren</option>
            {jaren.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
          <div className="ag-segment bh-segment bh-kw" role="radiogroup" aria-label="Kwartaal">
            {([0, 1, 2, 3, 4] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={filter.kw === k} className={filter.kw === k ? 'is-aan' : ''} onClick={() => zetFilter({ kw: k })}>
                {k ? `Q${k}` : 'Heel jaar'}
              </button>
            ))}
          </div>
          <select className="ag-veld bh-filter" value={filter.soort} onChange={(e) => zetFilter({ soort: e.target.value as BankFilter['soort'] })} aria-label="Soort">
            <option value="">Alle soorten</option>
            {(Object.keys(SOORT_LABELS) as BoekingSoort[]).map((s) => (
              <option key={s} value={s}>
                {SOORT_LABELS[s].label}
              </option>
            ))}
          </select>
          <label className="bh-zoek">
            <span className="bh-sr">Zoeken</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.4-4.4" />
            </svg>
            <input value={filter.q} onChange={(e) => zetFilter({ q: e.target.value })} placeholder="Zoek op omschrijving, categorie of bedrag" />
          </label>
          {filter.status && (
            <button type="button" className="bh-chip" onClick={() => zetFilter({ status: '' })}>
              Te verwerken <span aria-hidden="true">×</span>
            </button>
          )}
        </div>

        <dl className="bh-totalen">
          <div>
            <dt>Ontvangen</dt>
            <dd className="is-bij">{formatCenten(som.bij)}</dd>
          </div>
          <div>
            <dt>Betaald</dt>
            <dd>{formatCenten(som.af)}</dd>
          </div>
          <div>
            <dt>Af te dragen btw</dt>
            <dd>{formatCenten(som.verschuldigd)}</dd>
          </div>
          <div>
            <dt>Voorbelasting</dt>
            <dd>{formatCenten(som.voorbelasting)}</dd>
          </div>
          <div>
            <dt>Regels</dt>
            <dd>{som.aantal}</dd>
          </div>
        </dl>

        {gefilterd.length === 0 ? (
          <p className="bh-leeg bh-lijst-leeg">Geen boekingen met deze filters.</p>
        ) : (
          <div className="bh-tabel bh-boekingen" role="table" aria-label="Boekingen">
            <div className="bh-tr bh-th" role="row">
              <span role="columnheader">Datum</span>
              <span role="columnheader">Omschrijving</span>
              <span role="columnheader">Bank</span>
              <span role="columnheader">Kw.</span>
              <span role="columnheader">Btw</span>
              <span role="columnheader" className="bh-r">
                Bedrag
              </span>
              <span role="columnheader" className="bh-r">
                Saldo
              </span>
            </div>
            {gefilterd.slice(0, aantal).map((b) => {
              const r = berekenBoeking(b);
              const slot = isVergrendeld(b.datum, stam.vergrendeling);
              const ks = perBoeking.get(b.id);
              const meta = ks
                ? ks.map((k) => koppelLabel(k).titel).join(', ') + (ks[0].bron === 'factuur' ? '' : ' (bon)')
                : b.soort === 'uitgave' || b.soort === 'inkomst'
                  ? categorieVan.get(b.grootboek ?? '') ?? 'Nog in te delen'
                  : b.soort === 'prive'
                    ? `Privé ${vennootVan.get(b.vennootId ?? '') ?? ''}`.trim()
                    : SOORT_LABELS[b.soort].label;
              const btwTekst = ks
                ? ks[0].bron === 'factuur'
                  ? 'via factuur'
                  : 'via bon'
                : b.soort === 'uitgave' || b.soort === 'inkomst'
                  ? r.btw.btw
                    ? `${BTW_LABELS[b.btwCode].kort} · ${formatCenten(r.teken * r.btw.btw)}`
                    : BTW_LABELS[b.btwCode].kort
                  : '—';
              return (
                <button key={b.id} type="button" role="row" className={`bh-tr bh-rij${b.status === 'te_verwerken' ? ' is-open' : ''}`} onClick={() => setOpenId(b.id)}>
                  <span role="cell" className="bh-rij-datum">
                    {korteDatum(b.datum)}
                  </span>
                  <span role="cell" className="bh-rij-hoofd">
                    <span className="bh-rij-titel">
                      {b.omschrijving}
                      {b.status === 'te_verwerken' && <span className="bh-pil is-let-op">te verwerken</span>}
                      {metSuggestie.has(b.id) && <span className="bh-pil is-koppel">koppelen?</span>}
                      {ks && <span className="bh-pil is-zacht">gekoppeld</span>}
                      {activumVan.has(b.id) && <span className="bh-pil is-zacht">activum</span>}
                    </span>
                    <span className="bh-rij-meta">
                      {meta}
                      {b.tegenpartij && b.tegenpartij !== b.omschrijving ? ` · ${b.tegenpartij}` : ''}
                    </span>
                  </span>
                  <span role="cell" className="bh-rij-bank">
                    {naamVan.get(b.rekeningId ?? '') ?? 'Kas'}
                  </span>
                  <span role="cell" className="bh-rij-kw">
                    Q{r.kwartaal}
                    {slot && (
                      <svg className="bh-slot" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="vergrendeld">
                        <rect x="5" y="11" width="14" height="9" rx="1.5" />
                        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                      </svg>
                    )}
                  </span>
                  <span role="cell" className="bh-rij-btw">
                    {btwTekst}
                  </span>
                  <span role="cell" className={`bh-r bh-rij-bedrag${r.bankMutatie > 0 ? ' is-bij' : ''}`}>
                    {r.bankMutatie > 0 ? '+' : '−'} {formatCenten(Math.abs(r.bankMutatie))}
                  </span>
                  <span role="cell" className="bh-r bh-rij-saldo">
                    {lopend.has(b.id) ? formatCenten(lopend.get(b.id)!) : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {gefilterd.length > aantal && (
          <button type="button" className="db-knop bh-meer" onClick={() => setAantal((n) => n + 200)}>
            Toon meer ({gefilterd.length - aantal} regels)
          </button>
        )}
      </section>

      {open && (
        <BoekingPaneel
          key={open.id}
          stam={stam}
          boeking={open}
          naamBank={naamVan.get(open.rekeningId ?? '') ?? 'Kas'}
          onSluit={() => setOpenId(null)}
          koppel={koppelInfo}
          activum={activumVan.get(open.id) ?? null}
          kanActiveren={
            !activumVan.has(open.id) &&
            open.soort === 'uitgave' &&
            open.richting === 'af' &&
            !gekoppeld.has(open.id) &&
            (berekenBoeking(open).btw.excl >= DREMPEL_ACTIVEREN || open.grootboek === '0200' || open.grootboek === '0210')
          }
          onKoppel={koppelen}
          onOntkoppel={ontkoppelen}
          onOpgeslagen={(b) => {
            setLijst((l) => l.map((x) => (x.id === b.id ? b : x)));
            setMelding({ tekst: 'Wijziging opgeslagen.', soort: 'ok' });
          }}
          onVerwijderd={(id) => {
            setLijst((l) => l.filter((x) => x.id !== id));
            setOpenId(null);
            setKoppel((k) => k.filter((x) => x.boekingId !== id));
            setMelding({ tekst: 'Boeking verwijderd (bewaard als verwijderd, met reden).', soort: 'ok' });
          }}
        />
      )}
    </div>
  );
}
