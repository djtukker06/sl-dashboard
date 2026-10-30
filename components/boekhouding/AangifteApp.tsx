'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCenten, formatHeleEuro, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, kwartaalLabel, langeDatum, type Datum, type Kwartaal } from '@/lib/boekhouding/kern/periode';
import {
  MET_BTW,
  RUBRIEK_GROEPEN,
  RUBRIEK_INFO,
  teBetalenCenten,
  type Aangifte,
  type AangifteBerekening,
  type Afwijking,
  type Correctie,
  type FormulierRubriek,
  type KwartaalStatus,
  type RubriekBedragen
} from '@/lib/boekhouding/kern/aangifte';
import type { BtwControle } from '@/lib/boekhouding/kern/btw-controles';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';

export interface PostRij {
  id: string;
  datum: Datum;
  titel: string;
  bron: string;
  sub: string;
  href: string | null;
  grondslag: Centen;
  verschuldigd: Centen;
  voorbelasting: Centen;
}

export interface AangifteView {
  jaar: number;
  kwartaal: Kwartaal;
  van: Datum;
  tot: Datum;
  deadline: Datum;
  status: KwartaalStatus;
  vandaag: Datum;
  /** Het formulier zoals je het invult (eigen boekingen + correcties van eerdere kwartalen). */
  huidig: AangifteBerekening;
  /** Alleen de eigen boekingen van dit kwartaal. */
  eigen: AangifteBerekening;
  /** Correcties van eerdere kwartalen in deze aangifte (open, of meegenomen bij indienen). */
  correcties: Correctie[];
  /** Ingediend kwartaal met een later verschil: in welke aangifte dat wordt/is meegenomen. */
  correctieIn: { jaar: number; kwartaal: Kwartaal; ingediend: boolean } | null;
  aangifte: Aangifte | null;
  afwijking: Afwijking | null;
  betaald: Centen;
  posten: Record<string, PostRij>;
  controles: BtwControle[];
  betalingen: { id: string; boekingId: string; datum: Datum; omschrijving: string; bank: string; bedrag: Centen }[];
  betaalSuggesties: { boekingId: string; datum: Datum; omschrijving: string; bank: string; bedrag: Centen; exact: boolean }[];
  eigenaar: boolean;
  jaarDicht: boolean;
  kor: boolean;
  vorige: { jaar: number; kwartaal: Kwartaal } | null;
  volgende: { jaar: number; kwartaal: Kwartaal } | null;
}

const STATUS: Record<KwartaalStatus, { label: string; klasse: string }> = {
  lopend: { label: 'loopt nog', klasse: 'is-zacht' },
  te_doen: { label: 'aangifte doen', klasse: 'is-let-op' },
  te_laat: { label: 'te laat', klasse: 'is-gevaar' },
  ingediend: { label: 'ingediend', klasse: 'is-koppel' },
  betaald: { label: 'ingediend · betaald', klasse: 'is-koppel' }
};

// De btw-aangifte van één kwartaal: de rubrieken zoals op het formulier (hele euro's) met
// doorklik naar de posten, de controles, "markeer als ingediend" (vergrendelt het kwartaal),
// de afwijking na indiening en het koppelen van de betaling.
export function AangifteApp({ view: v }: { view: AangifteView }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [bevestig, setBevestig] = useState(false);
  const [intrekken, setIntrekken] = useState(false);
  const [kenmerk, setKenmerk] = useState('');
  const [opmerking, setOpmerking] = useState('');

  const ingediend = v.aangifte;
  // Wat er op het formulier staat: bij een ingediende aangifte wat is ingediend.
  const formulier = ingediend?.snapshot ?? v.huidig;
  const totaal = ingediend ? ingediend.teBetalen : teBetalenCenten(v.huidig);
  const gewijzigd = v.afwijking && v.afwijking.advies !== 'geen' ? v.afwijking : null;
  // Het verschil wordt in een (nog niet ingediende) latere aangifte meegenomen.
  const opgevangenIn = gewijzigd && gewijzigd.advies === 'volgende_aangifte' && v.correctieIn && !v.correctieIn.ingediend ? v.correctieIn : null;
  // Totaal van de correcties per rubriek (exact), voor "waarvan correctie" bij de rubrieken.
  const correctieVan = (r: FormulierRubriek | '5b', soort: 'grondslag' | 'btw'): number =>
    v.correcties.reduce((t, c) => t + (r === '5b' ? (soort === 'btw' ? c.voorbelasting : 0) : (c.rubrieken[r]?.[soort] ?? 0)), 0);
  const nuVan = (r: FormulierRubriek | '5b', soort: 'grondslag' | 'btw') => gewijzigd?.rubrieken.find((x) => x.rubriek === r && x.soort === soort)?.nu;

  async function actie(fn: () => Promise<unknown>) {
    setBezig(true);
    setFout(null);
    try {
      await fn();
      setBevestig(false);
      setIntrekken(false);
      router.refresh();
    } catch (e) {
      setFout((e as BkApiFout).message);
    } finally {
      setBezig(false);
    }
  }
  const basis = `/api/boekhouding/aangiften/${v.jaar}/${v.kwartaal}`;
  const indienen = () => actie(() => bkApi(basis, { method: 'POST', body: { kenmerk: kenmerk || null, opmerking: opmerking || null, verwacht: teBetalenCenten(v.huidig) } }));
  const trekIn = () => actie(() => bkApi(basis, { method: 'DELETE' }));
  const koppel = (boekingId: string) => actie(() => bkApi(`${basis}/betaling`, { method: 'POST', body: { boekingId } }));
  const ontkoppel = (id: string) => actie(() => bkApi(`${basis}/betaling?id=${id}`, { method: 'DELETE' }));
  const zetRubriek = (bron: 'factuur', id: string, btwCode: string) => actie(() => bkApi('/api/boekhouding/bron-extra', { method: 'POST', body: { bron, bronId: id, btwCode } }));

  const postenVan = (r: FormulierRubriek | '5b') => (v.huidig.posten[r] ?? []).map((id) => v.posten[id]).filter(Boolean);

  const rijCtx: RijContext = { v, open, setOpen, nuVan, postenVan, correctieVan, ingediend: Boolean(ingediend) };
  const letOp = v.controles.filter((c) => c.soort === 'let_op').length;
  const kanIndienen = !ingediend && v.status !== 'lopend' && !v.jaarDicht;

  return (
    <div className="bh-inhoud bh-aangifte">
      <nav className="bh-aangifte-nav" aria-label="Kwartalen">
        <Link href="/boekhouding/btw" className="bh-terug">
          ← Alle kwartalen
        </Link>
        <span className="bh-aangifte-blader">
          {v.vorige ? <Link href={`/boekhouding/btw/${v.vorige.jaar}/${v.vorige.kwartaal}`}>‹ {kwartaalLabel(v.vorige.jaar, v.vorige.kwartaal)}</Link> : <span />}
          {v.volgende ? <Link href={`/boekhouding/btw/${v.volgende.jaar}/${v.volgende.kwartaal}`}>{kwartaalLabel(v.volgende.jaar, v.volgende.kwartaal)} ›</Link> : <span />}
        </span>
      </nav>

      <section className="bh-kaart bh-aangifte-kop" aria-label="Samenvatting">
        <div>
          <p className="bh-label">
            {korteDatum(v.van)} t/m {korteDatum(v.tot)}
          </p>
          <h2 className="bh-btw-volgende-titel">
            {kwartaalLabel(v.jaar, v.kwartaal)}
            <span className={`bh-pil ${STATUS[v.status].klasse}`}>{STATUS[v.status].label}</span>
          </h2>
          <p className="bh-kaart-sub">
            {ingediend
              ? `Ingediend op ${langeDatum(ingediend.ingediendOp.slice(0, 10))}${ingediend.kenmerk ? ` · kenmerk ${ingediend.kenmerk}` : ''}`
              : `Uiterlijk ${langeDatum(v.deadline)} aangeven en betalen in Mijn Belastingdienst Zakelijk.`}
          </p>
        </div>
        <div className="bh-btw-volgende-bedrag">
          <span className={`bh-btw-groot${totaal < 0 ? ' is-bij' : ''}`}>{formatHeleEuro(Math.abs(totaal) / 100)}</span>
          <span className="bh-kaart-sub">{totaal > 0 ? 'te betalen' : totaal < 0 ? 'terug te vragen' : 'niets te betalen'}{v.status === 'lopend' ? ' (tot nu toe)' : ''}</span>
          {v.correcties.length > 0 && (
            <span className="bh-kaart-sub">
              incl. correcties eerdere kwartalen{!ingediend && ` · alleen dit kwartaal ${formatHeleEuro(teBetalenCenten(v.eigen) / 100)}`}
            </span>
          )}
        </div>
      </section>

      {opgevangenIn ? (
        <div className="bh-afwijking" role="status">
          <strong>Na indiening gewijzigd.</strong>{' '}
          {gewijzigd!.verschil !== 0
            ? `Volgens de huidige boekingen is het ${formatCenten(Math.abs(gewijzigd!.verschil))} ${gewijzigd!.verschil > 0 ? 'meer te betalen' : 'minder te betalen'} dan aangegeven.`
            : 'Er zijn rubrieken veranderd (het totaal blijft gelijk).'}{' '}
          Dit verschil zit als correctie in de aangifte van{' '}
          <Link href={`/boekhouding/btw/${opgevangenIn.jaar}/${opgevangenIn.kwartaal}`}>{kwartaalLabel(opgevangenIn.jaar, opgevangenIn.kwartaal)}</Link>; je hoeft hier niets te doen.{' '}
          <span className="bh-zacht">Bij de rubrieken staat &ldquo;nu&rdquo; met de huidige waarde.</span>
        </div>
      ) : !gewijzigd && v.correctieIn?.ingediend ? (
        <p className="bh-uitkomst-noot" role="status">
          Het latere verschil in dit kwartaal is gecorrigeerd in de aangifte van{' '}
          <Link href={`/boekhouding/btw/${v.correctieIn.jaar}/${v.correctieIn.kwartaal}`}>{kwartaalLabel(v.correctieIn.jaar, v.correctieIn.kwartaal)}</Link>.
        </p>
      ) : null}

      {gewijzigd && !opgevangenIn && (
        <div className={`bh-afwijking${gewijzigd.advies === 'suppletie' ? ' is-suppletie' : ''}`} role="status">
          <strong>Na indiening gewijzigd.</strong>{' '}
          {gewijzigd.verschil !== 0
            ? `Volgens de huidige boekingen is het ${formatCenten(Math.abs(gewijzigd.verschil))} ${gewijzigd.verschil > 0 ? 'meer te betalen' : 'minder te betalen'} dan aangegeven.`
            : 'Er zijn rubrieken veranderd (het totaal blijft gelijk).'}{' '}
          {gewijzigd.advies === 'suppletie'
            ? 'Het verschil is meer dan € 1.000: dien een suppletie (correctie) in bij de Belastingdienst.'
            : 'Neem het verschil mee in de volgende aangifte (tot € 1.000 mag dat).'}{' '}
          <span className="bh-zacht">Bij de rubrieken staat &ldquo;nu&rdquo; met de huidige waarde.</span>
        </div>
      )}

      <div className="bh-aangifte-grid">
        <section className="bh-kaart bh-formulier" aria-labelledby="bh-formulier-titel">
          <header className="bh-kaart-kop bh-formulier-kop">
            <h2 id="bh-formulier-titel" className="bh-kaart-titel">
              {ingediend ? 'Zoals ingediend' : 'Aangifte omzetbelasting'}
            </h2>
            <span className="bh-print">
              <a className="ag-link-knop" href={`/api/boekhouding/export?soort=aangifte&jaar=${v.jaar}&kw=${v.kwartaal}`} download>
                PDF
              </a>
              <button type="button" className="ag-link-knop" onClick={() => window.print()}>
                Afdrukken
              </button>
            </span>
            <p className="bh-kaart-sub">Bedragen in hele euro&apos;s, zoals je ze invult. Klik op een rubriek voor de boekingen erachter.</p>
          </header>
          <div className="bh-rubriek-kolommen" aria-hidden="true">
            <span />
            <span />
            <span>Omzet</span>
            <span>Omzetbelasting</span>
            <span />
          </div>
          {RUBRIEK_GROEPEN.map((g) => (
            <div key={g.titel} className="bh-rubriek-groep">
              <h3 className="bh-rubriek-groep-titel">{g.titel}</h3>
              <ul className="bh-rubrieken">
                {g.rubrieken.map((r) => (
                  <RubriekRij
                    key={r}
                    ctx={rijCtx}
                    code={r}
                    titel={RUBRIEK_INFO[r].titel}
                    uitleg={RUBRIEK_INFO[r].uitleg}
                    bedragen={{ grondslag: formulier.rubrieken[r].grondslag.euro, btw: MET_BTW.has(r) ? formulier.rubrieken[r].btw.euro : null }}
                  />
                ))}
              </ul>
            </div>
          ))}
          {v.correcties.length > 0 && <CorrectieBlok correcties={v.correcties} ingediend={Boolean(ingediend)} />}
          <div className="bh-rubriek-groep">
            <h3 className="bh-rubriek-groep-titel">5. Voorbelasting en eindtotaal</h3>
            <ul className="bh-rubrieken">
              <RubriekRij ctx={rijCtx} code="5a" titel={RUBRIEK_INFO['5a'].titel} uitleg={RUBRIEK_INFO['5a'].uitleg} bedragen={{ btw: formulier.verschuldigd.euro }} alleenBtw />
              <RubriekRij ctx={rijCtx} code="5b" titel={RUBRIEK_INFO['5b'].titel} uitleg={RUBRIEK_INFO['5b'].uitleg} bedragen={{ btw: formulier.voorbelasting.euro }} alleenBtw />
              <RubriekRij ctx={rijCtx} code="5c" titel={totaal >= 0 ? 'Totaal te betalen' : 'Totaal terug te vragen'} uitleg="5a min 5b" bedragen={{ btw: formulier.saldo.euro }} alleenBtw />
            </ul>
          </div>
          <p className="bh-kaart-sub bh-formulier-noot">
            {v.kor ? 'Let op: de kleineondernemersregeling (KOR) staat aan in de instellingen. ' : ''}
            Afronding in je voordeel: omzet en verschuldigde btw naar beneden, voorbelasting naar boven
            {formulier.saldo.centen !== formulier.saldo.euro * 100
              ? ` (exact ${formatCenten(formulier.saldo.centen)}; het verschil ${ingediend ? 'is' : 'wordt'} bij indienen geboekt als afrondingsverschil).`
              : '.'}
          </p>
        </section>

        <aside className="bh-aangifte-zij">
          {!ingediend ? (
            <section className="bh-kaart bh-indienen" aria-labelledby="bh-indienen-titel">
              <h2 id="bh-indienen-titel" className="bh-kaart-titel">
                Indienen
              </h2>
              {v.status === 'lopend' ? (
                <p className="bh-kaart-sub">Dit kwartaal loopt nog tot en met {langeDatum(v.tot)}. Daarna kun je de aangifte doen; uiterlijk {langeDatum(v.deadline)}.</p>
              ) : v.jaarDicht ? (
                <p className="bh-kaart-sub">Boekjaar {v.jaar} is afgesloten.</p>
              ) : !bevestig ? (
                <>
                  <ol className="bh-stappen">
                    <li>Log in op Mijn Belastingdienst Zakelijk en open de aangifte over {kwartaalLabel(v.jaar, v.kwartaal)}.</li>
                    <li>Neem de bedragen van het formulier hiernaast over.</li>
                    <li>Markeer de aangifte hier als ingediend: het kwartaal wordt dan vergrendeld.</li>
                  </ol>
                  {letOp > 0 && <p className="bh-uitkomst-noot is-let-op">Er {letOp === 1 ? 'staat 1 controlepunt' : `staan ${letOp} controlepunten`} open. Bekijk die eerst.</p>}
                  <button type="button" className="db-knop db-knop-primair" onClick={() => setBevestig(true)} disabled={!kanIndienen}>
                    Markeer als ingediend
                  </button>
                </>
              ) : (
                <div className="bh-bevestig">
                  <p className="bh-kaart-sub">
                    Ingediend met {totaal >= 0 ? 'te betalen' : 'terug te vragen'} <strong>{formatHeleEuro(Math.abs(totaal) / 100)}</strong>? Daarna kun je boekingen in{' '}
                    {kwartaalLabel(v.jaar, v.kwartaal)} niet meer wijzigen; een correctie boek je in een open kwartaal.
                  </p>
                  <label className="bh-veld">
                    <span className="bh-label">Betalingskenmerk (optioneel)</span>
                    <input className="ag-veld" value={kenmerk} onChange={(e) => setKenmerk(e.target.value)} maxLength={120} placeholder="bv. 1234 5678 9012 3456" />
                  </label>
                  <label className="bh-veld">
                    <span className="bh-label">Opmerking (optioneel)</span>
                    <textarea className="ag-veld" rows={2} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} maxLength={2000} />
                  </label>
                  <div className="bh-bevestig-knoppen">
                    <button type="button" className="db-knop" onClick={() => setBevestig(false)} disabled={bezig}>
                      Annuleren
                    </button>
                    <button type="button" className="db-knop db-knop-primair" onClick={indienen} disabled={bezig}>
                      {bezig ? 'Bezig…' : 'Ja, ik heb ingediend'}
                    </button>
                  </div>
                </div>
              )}
              {fout && <p className="ag-fout">{fout}</p>}
            </section>
          ) : (
            <section className="bh-kaart bh-indienen" aria-labelledby="bh-betaling-titel">
              <h2 id="bh-betaling-titel" className="bh-kaart-titel">
                {ingediend.teBetalen >= 0 ? 'Betaling' : 'Teruggaaf'}
              </h2>
              {ingediend.teBetalen === 0 ? (
                <p className="bh-kaart-sub">Er hoeft niets te worden betaald of ontvangen.</p>
              ) : (
                <>
                  <div className="bh-betaal-voortgang">
                    <span>
                      {formatCenten(Math.abs(v.betaald))} van {formatCenten(Math.abs(ingediend.teBetalen))} {ingediend.teBetalen > 0 ? 'betaald' : 'ontvangen'}
                    </span>
                    <span className="bh-ouderdom-balk" aria-hidden="true">
                      <span className="bh-ouderdom-deel is-vers" style={{ flexGrow: Math.min(1, Math.abs(v.betaald) / Math.abs(ingediend.teBetalen)) }} />
                      <span className="bh-ouderdom-deel" style={{ flexGrow: Math.max(0, 1 - Math.abs(v.betaald) / Math.abs(ingediend.teBetalen)) }} />
                    </span>
                  </div>
                  {v.betalingen.length > 0 && (
                    <ul className="bh-koppel-lijst">
                      {v.betalingen.map((b) => (
                        <li key={b.id} className="bh-koppel-item is-gekoppeld">
                          <span className="bh-koppel-tekst">
                            <span className="bh-koppel-titel">{b.omschrijving}</span>
                            <span className="bh-koppel-sub">
                              {b.bank} · {korteDatum(b.datum)}
                            </span>
                          </span>
                          <span className="bh-koppel-bedrag">{formatCenten(Math.abs(b.bedrag))}</span>
                          <button type="button" className="ag-link-knop" onClick={() => ontkoppel(b.id)} disabled={bezig}>
                            Ontkoppelen
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {v.status !== 'betaald' &&
                    (v.betaalSuggesties.length ? (
                      <ul className="bh-koppel-lijst">
                        {v.betaalSuggesties.map((s) => (
                          <li key={s.boekingId} className="bh-koppel-item">
                            <span className="bh-koppel-tekst">
                              <span className="bh-koppel-titel">{s.omschrijving}</span>
                              <span className="bh-koppel-sub">
                                {s.bank} · {korteDatum(s.datum)}
                                {s.exact ? ' · zelfde bedrag' : ''}
                              </span>
                            </span>
                            <span className="bh-koppel-bedrag">{formatCenten(s.bedrag)}</span>
                            <button type="button" className="db-knop bh-koppel-knop" onClick={() => koppel(s.boekingId)} disabled={bezig}>
                              Koppelen
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="bh-koppel-noot">
                        Nog geen betaling gevonden. Boek de {ingediend.teBetalen > 0 ? 'betaling aan' : 'teruggaaf van'} de Belastingdienst bij Bank &amp; boekingen met de soort
                        &ldquo;Btw-aangifte&rdquo; en koppel hem hier.
                      </p>
                    ))}
                </>
              )}
              <p className="bh-koppel-noot">
                Bij indienen gaat de btw van dit kwartaal naar &ldquo;af te dragen btw&rdquo; (1530); de betaling boekt die weer af.
                {ingediend.opmerking ? ` Opmerking: ${ingediend.opmerking}` : ''}
              </p>
              {v.eigenaar &&
                (!intrekken ? (
                  <button type="button" className="ag-link-knop ag-link-gevaar bh-intrekken" onClick={() => setIntrekken(true)} disabled={v.jaarDicht}>
                    Indiening intrekken…
                  </button>
                ) : (
                  <div className="bh-bevestig">
                    <p className="bh-kaart-sub">Het kwartaal wordt weer opengezet en de koppeling met de betaling vervalt. Alleen doen als de aangifte (nog) niet echt is ingediend.</p>
                    <div className="bh-bevestig-knoppen">
                      <button type="button" className="db-knop" onClick={() => setIntrekken(false)} disabled={bezig}>
                        Annuleren
                      </button>
                      <button type="button" className="db-knop ag-knop-gevaar" onClick={trekIn} disabled={bezig}>
                        Intrekken
                      </button>
                    </div>
                  </div>
                ))}
              {fout && <p className="ag-fout">{fout}</p>}
            </section>
          )}

          <section className="bh-kaart bh-btw-controles" aria-labelledby="bh-controles-titel">
            <h2 id="bh-controles-titel" className="bh-kaart-titel">
              Controles
            </h2>
            <ul className="bh-btw-controle-lijst">
              {v.controles.map((c) => (
                <li key={c.id} className={`bh-btw-controle is-${c.soort}`}>
                  <span className="bh-btw-controle-icoon" aria-hidden="true">
                    {c.soort === 'ok' ? '✓' : c.soort === 'let_op' ? '!' : 'i'}
                  </span>
                  <div className="bh-btw-controle-tekst">
                    <p className="bh-btw-controle-titel">
                      {c.href ? <Link href={c.href}>{c.titel}</Link> : c.titel}
                      {c.aantal ? <span className="bh-subnav-teller">{c.aantal}</span> : null}
                    </p>
                    <p className="bh-kaart-sub">{c.tekst}</p>
                    {c.regels && c.regels.length > 0 && (
                      <ul className="bh-btw-controle-regels">
                        {c.regels.map((r, i) => (
                          <li key={i}>
                            <span className="bh-btw-controle-regel" title={r.sub ? `${r.titel} · ${r.sub}` : r.titel}>
                              {r.href ? <Link href={r.href}>{r.titel}</Link> : r.titel}
                              {r.sub && <span className="bh-zacht"> · {r.sub}</span>}
                            </span>
                            {r.bedrag !== undefined && <span className="bh-koppel-bedrag">{formatCenten(r.bedrag)}</span>}
                            {r.actie && !ingediend && (
                              <button type="button" className="db-knop bh-koppel-knop" onClick={() => zetRubriek(r.actie!.bron, r.actie!.id, r.actie!.btwCode)} disabled={bezig}>
                                {r.actie.label}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

interface RijContext {
  v: AangifteView;
  open: string | null;
  setOpen: (c: string | null) => void;
  nuVan: (r: FormulierRubriek | '5b', soort: 'grondslag' | 'btw') => number | undefined;
  postenVan: (r: FormulierRubriek | '5b') => PostRij[];
  correctieVan: (r: FormulierRubriek | '5b', soort: 'grondslag' | 'btw') => number;
  ingediend: boolean;
}

const metTeken = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatCenten(Math.abs(c))}`;

/** De correcties van eerdere kwartalen die in deze aangifte zitten, per kwartaal en rubriek. */
function CorrectieBlok({ correcties, ingediend }: { correcties: Correctie[]; ingediend: boolean }) {
  return (
    <div className="bh-rubriek-groep bh-correcties">
      <h3 className="bh-rubriek-groep-titel">Correcties eerdere kwartalen</h3>
      <p className="bh-kaart-sub bh-correcties-uitleg">
        {ingediend ? 'Meegenomen in deze aangifte' : 'Al verwerkt in de bedragen hierboven'}: wat het volgens de boekingen had moeten zijn min wat is aangegeven. Een
        verschil tot € 1.000 btw verwerk je volgens de Belastingdienst in de eerstvolgende aangifte, bij de rubriek waar het hoort.
      </p>
      <ul className="bh-correcties-lijst">
        {correcties.map((c) => (
          <li key={`${c.jaar}-${c.kwartaal}`} className="bh-correctie">
            <Link className="bh-correctie-kw" href={`/boekhouding/btw/${c.jaar}/${c.kwartaal}`}>
              {kwartaalLabel(c.jaar, c.kwartaal)}
            </Link>
            <ul className="bh-correctie-regels">
              {(Object.entries(c.rubrieken) as [FormulierRubriek, { grondslag: number; btw: number }][]).map(([r, d]) => (
                <li key={r}>
                  <span className="bh-rubriek-code">{r}</span>
                  <span>omzet {metTeken(d.grondslag)}</span>
                  {MET_BTW.has(r) && <span>btw {metTeken(d.btw)}</span>}
                </li>
              ))}
              {c.voorbelasting !== 0 && (
                <li>
                  <span className="bh-rubriek-code">5b</span>
                  <span>voorbelasting {metTeken(c.voorbelasting)}</span>
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RubriekRij({
  ctx,
  code,
  titel,
  uitleg,
  bedragen,
  alleenBtw
}: {
  ctx: RijContext;
  code: FormulierRubriek | '5a' | '5b' | '5c';
  titel: string;
  uitleg?: string;
  bedragen: { grondslag?: number | null; btw?: number | null };
  alleenBtw?: boolean;
}) {
  const kanOpen = code !== '5a' && code !== '5c';
  const lijst = kanOpen ? ctx.postenVan(code) : [];
  const isOpen = ctx.open === code && lijst.length > 0;
  const leeg = !alleenBtw && !bedragen.grondslag && !bedragen.btw && lijst.length === 0;
  const nuG = kanOpen && code !== '5b' ? ctx.nuVan(code, 'grondslag') : undefined;
  const nuB = kanOpen ? ctx.nuVan(code, 'btw') : undefined;
  const corG = kanOpen && code !== '5b' ? ctx.correctieVan(code, 'grondslag') : 0;
  const corB = kanOpen ? ctx.correctieVan(code, 'btw') : 0;
  const inhoud = (
    <>
      <span className="bh-rubriek-code">{code}</span>
      <span className="bh-rubriek-tekst">
        <span className="bh-rubriek-titel">{titel}</span>
        {uitleg && <span className="bh-rubriek-uitleg">{uitleg}</span>}
      </span>
      <span className="bh-rubriek-bedrag">
        {bedragen.grondslag === null || bedragen.grondslag === undefined ? '' : formatHeleEuro(bedragen.grondslag)}
        {nuG !== undefined && <span className="bh-rubriek-nu">nu {formatHeleEuro(nuG)}</span>}
        {corG !== 0 && (
          <span className="bh-rubriek-nu is-correctie">
            <span>waarvan correctie</span> <span>{metTeken(corG)}</span>
          </span>
        )}
      </span>
      <span className="bh-rubriek-bedrag is-btw">
        {bedragen.btw === null || bedragen.btw === undefined ? '' : formatHeleEuro(bedragen.btw)}
        {nuB !== undefined && <span className="bh-rubriek-nu">nu {formatHeleEuro(nuB)}</span>}
        {corB !== 0 && (
          <span className="bh-rubriek-nu is-correctie">
            <span>waarvan correctie</span> <span>{metTeken(corB)}</span>
          </span>
        )}
      </span>
      <span className="bh-rubriek-pijl" aria-hidden="true">
        {lijst.length > 0 ? (isOpen ? '−' : '+') : ''}
      </span>
    </>
  );
  return (
    <li className={`bh-rubriek${leeg ? ' is-leeg' : ''}${code === '5c' ? ' is-totaal' : ''}`}>
      {lijst.length > 0 ? (
        <button type="button" className="bh-rubriek-rij" aria-expanded={isOpen} onClick={() => ctx.setOpen(isOpen ? null : code)}>
          {inhoud}
        </button>
      ) : (
        <div className="bh-rubriek-rij">{inhoud}</div>
      )}
      {isOpen && kanOpen && <PostenLijst ctx={ctx} code={code} lijst={lijst} />}
    </li>
  );
}

function PostenLijst({ ctx, code, lijst }: { ctx: RijContext; code: FormulierRubriek | '5b'; lijst: PostRij[] }) {
  const isVb = code === '5b';
  const h = ctx.v.huidig;
  const bedragen: RubriekBedragen | null = isVb ? null : h.rubrieken[code];
  return (
    <div className="bh-posten">
      <ul className="bh-posten-lijst">
        {lijst.map((p) => {
          const inhoud = (
            <>
              <span className="bh-rij-datum">{korteDatum(p.datum, false)}</span>
              <span className="bh-rij-hoofd">
                <span className="bh-rij-titel">{p.titel}</span>
                <span className="bh-rij-meta">{p.sub}</span>
              </span>
              <span className="bh-posten-bedrag">{isVb ? '' : formatCenten(p.grondslag)}</span>
              <span className="bh-posten-bedrag">{isVb ? formatCenten(p.voorbelasting) : MET_BTW.has(code) ? formatCenten(p.verschuldigd) : ''}</span>
            </>
          );
          return (
            <li key={p.id}>
              {p.href ? (
                <Link className="bh-posten-rij" href={p.href}>
                  {inhoud}
                </Link>
              ) : (
                <div className="bh-posten-rij">{inhoud}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="bh-posten-voet">
        {isVb
          ? `Exact ${formatCenten(h.voorbelasting.centen)} voorbelasting → op het formulier ${formatHeleEuro(h.voorbelasting.euro)} (naar boven afgerond).`
          : bedragen
            ? `Exact: omzet ${formatCenten(bedragen.grondslag.centen)}${MET_BTW.has(code) ? `, btw ${formatCenten(bedragen.btw.centen)}` : ''} → op het formulier naar beneden afgerond.`
            : ''}
        {ctx.ingediend && ' De posten zijn de huidige stand.'}
      </p>
    </div>
  );
}
