'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { bkApi } from '@/lib/boekhouding/client';
import { centenNaarInvoer, formatCenten, naarCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import type { AfsluitControle } from '@/lib/boekhouding/kern/rapporten';

export interface AfsluitView {
  jaar: number;
  afgesloten: boolean;
  afgeslotenOp: string | null;
  eigenaar: boolean;
  demo: boolean;
  /** Controles behalve de banksaldi (die rekent de browser live). */
  controles: AfsluitControle[];
  banksaldi: { rekeningId: string; naam: string; berekend: Centen; opgegeven: Centen | null }[];
  resultaat: Centen | null;
  resultaatEerder: Centen;
  verdeling: { vennootId: string; naam: string; aandeel: number; bedrag: Centen; prive: Centen }[];
  regels: { grootboek: string; naam: string; debet: Centen; credit: Centen; omschrijving: string | null }[];
  fout: string | null;
}

// De jaarafsluiting: checklist (met de banksaldi volgens het afschrift per 31-12), het voorstel
// voor de afsluitpost (resultaat en privé naar de kapitaalrekeningen) en de knop om af te
// sluiten (alleen de eigenaar). Na afsluiten: de samenvatting en heropenen.
export function JaarafsluitingApp({ v }: { v: AfsluitView }) {
  const router = useRouter();
  const [saldi, setSaldi] = useState<Record<string, string>>(() =>
    Object.fromEntries(v.banksaldi.map((s) => [s.rekeningId, s.opgegeven === null ? '' : centenNaarInvoer(s.opgegeven)]))
  );
  const [bevestig, setBevestig] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const [toonPost, setToonPost] = useState(false);

  const bank = useMemo(
    () =>
      v.banksaldi.map((s) => {
        const c = saldi[s.rekeningId]?.trim() ? naarCenten(saldi[s.rekeningId]) : null;
        return { ...s, opgegeven: c, ok: c !== null && c === s.berekend };
      }),
    [saldi, v.banksaldi]
  );
  const bankOk = bank.every((s) => s.ok);
  const blokkades = v.controles.filter((c) => c.blokkeert && !c.ok);
  const mag = !v.afgesloten && !v.fout && blokkades.length === 0 && bankOk;

  async function afsluiten() {
    setBezig(true);
    setMelding(null);
    try {
      await bkApi(`/api/boekhouding/jaarafsluiting/${v.jaar}`, {
        method: 'POST',
        body: { banksaldi: Object.fromEntries(bank.map((s) => [s.rekeningId, s.opgegeven])), verwacht: v.resultaat }
      });
      setBevestig(false);
      setMelding({ soort: 'ok', tekst: `Boekjaar ${v.jaar} is afgesloten en vergrendeld.` });
      router.refresh();
    } catch (e) {
      setMelding({ soort: 'fout', tekst: (e as Error).message });
    } finally {
      setBezig(false);
    }
  }

  async function heropenen() {
    if (!window.confirm(`Boekjaar ${v.jaar} heropenen? De afsluitpost verdwijnt en het jaar is weer te wijzigen.`)) return;
    setBezig(true);
    setMelding(null);
    try {
      await bkApi(`/api/boekhouding/jaarafsluiting/${v.jaar}`, { method: 'DELETE' });
      setMelding({ soort: 'ok', tekst: `Boekjaar ${v.jaar} is weer open.` });
      router.refresh();
    } catch (e) {
      setMelding({ soort: 'fout', tekst: (e as Error).message });
    } finally {
      setBezig(false);
    }
  }

  const controleRij = (c: { id: string; titel: string; ok: boolean; blokkeert: boolean; uitleg: string; href?: string }) => (
    <li key={c.id} className={`bh-afs-rij ${c.ok ? 'is-ok' : c.blokkeert ? 'is-open' : 'is-let-op'}`}>
      <span className="bh-afs-icoon" aria-hidden="true">
        {c.ok ? '✓' : c.blokkeert ? '•' : '!'}
      </span>
      <span className="bh-afs-tekst">
        <span className="bh-afs-titel">
          {c.titel}
          {!c.ok && !c.blokkeert && <span className="bh-zacht"> · waarschuwing</span>}
        </span>
        <span className="bh-afs-uitleg">
          {c.uitleg}
          {c.href && !c.ok ? (
            <>
              {' '}
              <Link href={c.href}>Bekijken →</Link>
            </>
          ) : null}
        </span>
      </span>
    </li>
  );

  return (
    <div className="bh-inhoud bh-afs">
      <Link className="bh-terug" href={`/boekhouding/rapporten?jaar=${v.jaar}`}>
        ‹ Rapporten {v.jaar}
      </Link>
      {melding && <p className={`bh-melding is-${melding.soort}`} role={melding.soort === 'fout' ? 'alert' : 'status'}>{melding.tekst}</p>}

      {v.afgesloten ? (
        <section className="bh-kaart bh-afs-klaar" aria-labelledby="bh-afs-klaar">
          <p className="bh-label">Afgesloten{v.afgeslotenOp ? ` op ${v.afgeslotenOp}` : ''}</p>
          <h2 id="bh-afs-klaar" className="bh-afs-groot">
            Boekjaar {v.jaar} is afgesloten
          </h2>
          <p className="bh-kaart-sub">
            Het resultaat en de privé-opnamen staan op de kapitaalrekeningen van de vennoten. Boekingen, memoriaal, activa en btw in {v.jaar} zijn vergrendeld; een correctie boek je in het volgende
            jaar. Heropenen kan alleen de eigenaar.
          </p>
          {v.eigenaar ? (
            <div>
              <button type="button" className="db-knop" onClick={heropenen} disabled={bezig}>
                {bezig ? 'Bezig…' : `Boekjaar ${v.jaar} heropenen`}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="bh-afs-grid">
        {!v.afgesloten && (
          <section className="bh-kaart" aria-labelledby="bh-afs-check">
            <header className="bh-kaart-kop">
              <h2 id="bh-afs-check" className="bh-kaart-titel">
                Checklist
              </h2>
              <p className="bh-kaart-sub">Wat met een stip staat, moet in orde zijn voordat je afsluit.</p>
            </header>
            <ul className="bh-afs-lijst">
              {v.controles.filter((c) => c.blokkeert).map(controleRij)}
              {controleRij({
                id: 'bank',
                titel: 'Banksaldi aangesloten op 31-12',
                ok: bankOk,
                blokkeert: true,
                uitleg: bankOk ? 'Het berekende saldo is gelijk aan het bankafschrift.' : 'Vul hieronder het saldo volgens het bankafschrift per 31 december in.'
              })}
            </ul>
            <div className="bh-afs-bank">
              {bank.map((s) => (
                <label key={s.rekeningId} className="bh-afs-saldo">
                  <span className="bh-afs-saldo-naam">{s.naam}</span>
                  <span className="bh-afs-saldo-invoer">
                    <span aria-hidden="true">€</span>
                    <input
                      className="ag-veld"
                      inputMode="decimal"
                      placeholder="saldo afschrift"
                      value={saldi[s.rekeningId] ?? ''}
                      onChange={(e) => setSaldi((x) => ({ ...x, [s.rekeningId]: e.target.value }))}
                      aria-describedby={`bh-afs-ber-${s.rekeningId}`}
                    />
                  </span>
                  <span id={`bh-afs-ber-${s.rekeningId}`} className={`bh-afs-saldo-ber${s.opgegeven === null ? '' : s.ok ? ' is-bij' : ' bh-demo-fout'}`}>
                    {s.opgegeven === null
                      ? `berekend ${formatCenten(s.berekend)}`
                      : s.ok
                        ? '✓ sluit aan'
                        : `verschil ${formatCenten(s.opgegeven - s.berekend)} (berekend ${formatCenten(s.berekend)})`}
                  </span>
                </label>
              ))}
              {v.demo && (
                <button type="button" className="ag-link-knop" onClick={() => setSaldi(Object.fromEntries(v.banksaldi.map((s) => [s.rekeningId, centenNaarInvoer(s.berekend)])))}>
                  Demo: vul de berekende saldi in
                </button>
              )}
            </div>
            {v.controles.some((c) => !c.blokkeert) && (
              <>
                <p className="bh-label">Ook nakijken</p>
                <ul className="bh-afs-lijst">{v.controles.filter((c) => !c.blokkeert).map(controleRij)}</ul>
              </>
            )}
          </section>
        )}

        <section className="bh-kaart" aria-labelledby="bh-afs-post">
          <header className="bh-kaart-kop">
            <h2 id="bh-afs-post" className="bh-kaart-titel">
              {v.afgesloten ? 'Afsluitpost' : 'Wat er gebeurt'}
            </h2>
            <p className="bh-kaart-sub">Memoriaalpost op 31 december {v.jaar}: de resultaatrekeningen gaan naar 0, het resultaat en privé naar kapitaal.</p>
          </header>
          {v.fout ? (
            <p className="bh-melding is-fout">{v.fout}</p>
          ) : (
            <>
              <dl className="bh-afs-cijfers">
                <div>
                  <dt>Resultaat {v.jaar}</dt>
                  <dd>{formatCenten(v.resultaat ?? 0)}</dd>
                </div>
                {v.verdeling.map((x) => (
                  <div key={x.vennootId}>
                    <dt>
                      {x.naam} · {x.aandeel}%
                    </dt>
                    <dd>{formatCenten(x.bedrag)}</dd>
                    <dd className="bh-afs-prive">privé {formatCenten(x.prive)}</dd>
                  </div>
                ))}
              </dl>
              {v.resultaatEerder !== 0 && (
                <p className="bh-kaart-sub">Resultaat van vóór dit boekjaar ({formatCenten(v.resultaatEerder)}, bv. afschrijving van vóór de start) gaat naar 0900 Beginbalans.</p>
              )}
              <button type="button" className="ag-link-knop bh-afs-toon" onClick={() => setToonPost((x) => !x)} aria-expanded={toonPost}>
                {toonPost ? 'Verberg de journaalregels' : `Toon de ${v.regels.length} journaalregels`}
              </button>
              {toonPost && (
                <table className="bh-rt bh-afs-regels">
                  <thead>
                    <tr>
                      <th>Rekening</th>
                      <th className="bh-r">Debet</th>
                      <th className="bh-r">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.regels.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <span className="bh-rt-code">{r.grootboek}</span> {r.naam}
                          {r.omschrijving ? <span className="bh-afs-uitleg"> · {r.omschrijving}</span> : null}
                        </td>
                        <td className="bh-r">{r.debet ? formatCenten(r.debet) : ''}</td>
                        <td className="bh-r">{r.credit ? formatCenten(r.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {!v.afgesloten && (
            <div className="bh-afs-actie">
              {!v.eigenaar ? (
                <p className="bh-kaart-sub">Alleen de eigenaar (ingelogd met 2FA) kan een boekjaar afsluiten.</p>
              ) : bevestig ? (
                <div className="bh-bevestig" role="group" aria-label="Bevestigen">
                  <p>
                    Boekjaar <strong>{v.jaar}</strong> afsluiten? Het resultaat wordt verdeeld over de vennoten en het hele jaar wordt vergrendeld.
                  </p>
                  <div className="bh-bevestig-knoppen">
                    <button type="button" className="db-knop db-knop-primair" onClick={afsluiten} disabled={bezig}>
                      {bezig ? 'Bezig…' : 'Ja, afsluiten'}
                    </button>
                    <button type="button" className="db-knop" onClick={() => setBevestig(false)} disabled={bezig}>
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="db-knop db-knop-primair" onClick={() => setBevestig(true)} disabled={!mag}>
                  Boekjaar {v.jaar} afsluiten
                </button>
              )}
              {v.eigenaar && !mag && !bevestig && <p className="bh-kaart-sub">Eerst de punten met een stip in orde maken.</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
