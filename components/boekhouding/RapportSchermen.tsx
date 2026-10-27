import 'server-only';
import Link from 'next/link';
import { BoekhoudingKop } from './BoekhoudingKop';
import { Demo, type Zoekparams } from './Schermen';
import { formatBedrag, formatCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import { korteDatum, langeDatum, vandaagNL } from '@/lib/boekhouding/kern/periode';
import { grootboekkaart, jaarBegin, proefbalansRapport, type BalansGroep, type WVBedragen } from '@/lib/boekhouding/kern/rapporten';
import type { JournaalPost } from '@/lib/boekhouding/kern/journaal';
import { afsluitStatus, boekjarenLijst, jaarrapport } from '@/lib/boekhouding/jaarwerk';
import { journaalVan, laadAlles, type BoekhoudRepo } from '@/lib/boekhouding/repo/types';

// Rapporten & jaarrekening: per boekjaar de winst-en-verliesrekening (per kwartaal en t.o.v.
// vorig jaar), de balans (begin en eind), het kapitaal per vennoot met de winstverdeling, de
// proefbalans en de grootboekkaart, plus de exports voor de boekhouder en de jaarafsluiting.

const een = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const RAPPORTEN = [
  { id: 'wv', label: 'Winst & verlies' },
  { id: 'balans', label: 'Balans' },
  { id: 'vennoten', label: 'Vennoten' },
  { id: 'proef', label: 'Proefbalans' },
  { id: 'grootboek', label: 'Grootboekkaart' }
] as const;
type RapportId = (typeof RAPPORTEN)[number]['id'];

const b = (c: Centen) => (c === 0 ? '—' : formatBedrag(c));

const BRON_LABEL: Record<JournaalPost['bron'], string> = {
  boeking: 'Bank',
  factuur: 'Factuur',
  uitgave: 'Bonnetje',
  memoriaal: 'Memoriaal',
  beginsaldo: 'Beginsaldo',
  activum: 'Activum',
  afschrijving: 'Afschrijving',
  btw_afsluiting: 'Btw-aangifte'
};

function bronHref(bron: JournaalPost['bron'], id: string): string | null {
  if (bron === 'boeking') return `/boekhouding/bank?jaar=alle&open=${id}`;
  if (bron === 'factuur') return `/facturen/${id}/bewerken`;
  if (bron === 'uitgave') return `/boekhouding/bonnetjes?uitgave=${id}`;
  if (bron === 'activum' || bron === 'afschrijving') return `/boekhouding/activa/${id}`;
  if (bron === 'memoriaal') return '/boekhouding/instellingen#memoriaal';
  return null;
}

export async function RapportenScherm({ repo, sp }: { repo: BoekhoudRepo; sp: Zoekparams }) {
  const data = await laadAlles(repo);
  const vandaag = vandaagNL();
  const jaren = boekjarenLijst(data, vandaag);
  const gevraagd = Number(een(sp.jaar));
  const jaar = jaren.includes(gevraagd) ? gevraagd : jaren[0];
  const rapport: RapportId = RAPPORTEN.some((r) => r.id === een(sp.r)) ? (een(sp.r) as RapportId) : 'wv';
  const posten = journaalVan(data);
  const r = jaarrapport(data, posten, jaar, vandaag);
  const st = afsluitStatus(data, posten, jaar, vandaag, {});
  const bj = data.boekjaren.find((x) => x.jaar === jaar);
  const href = (o: { r?: RapportId; jaar?: number; code?: string }) => {
    const q = new URLSearchParams({ r: o.r ?? rapport, jaar: String(o.jaar ?? jaar) });
    if (o.code) q.set('code', o.code);
    return `/boekhouding/rapporten?${q}`;
  };
  const omzet = r.wv.groepen.find((g) => g.id === 'omzet')?.jaar ?? 0;
  const openBlokkades = st.controles.filter((c) => c.blokkeert && !c.ok && c.id !== 'bank');

  return (
    <div className="bh">
      <BoekhoudingKop titel="Rapporten & jaarrekening" />
      <Demo repo={repo} />
      <div className="bh-inhoud bh-rap">
        <nav className="bh-rek-tabs bh-rap-jaren" aria-label="Boekjaar">
          {jaren.map((j) => (
            <Link key={j} href={href({ jaar: j })} className={`bh-rek-tab${j === jaar ? ' is-aan' : ''}`} aria-current={j === jaar ? 'page' : undefined}>
              {j}
              {data.stam.vergrendeling.boekjaren.includes(j) ? <span className="bh-slot" aria-label="afgesloten"> ·  afgesloten</span> : null}
            </Link>
          ))}
        </nav>

        <section className="bh-saldi" aria-label={`Kerncijfers ${jaar}`}>
          <div className="bh-saldo">
            <span className="bh-saldo-naam">Omzet {jaar}</span>
            <span className="bh-saldo-bedrag">{formatCenten(omzet)}</span>
            <span className="bh-saldo-sub">excl. btw{r.lopend ? ` · t/m ${korteDatum(r.tot)}` : ''}</span>
          </div>
          <div className="bh-saldo">
            <span className="bh-saldo-naam">Kosten {jaar}</span>
            <span className="bh-saldo-bedrag">{formatCenten(r.wv.kosten.jaar)}</span>
            <span className="bh-saldo-sub">incl. afschrijvingen</span>
          </div>
          <div className="bh-saldo">
            <span className="bh-saldo-naam">Resultaat {jaar}</span>
            <span className={`bh-saldo-bedrag${r.wv.resultaat.jaar < 0 ? ' is-let-op' : ''}`}>{formatCenten(r.wv.resultaat.jaar)}</span>
            <span className="bh-saldo-sub">{r.wv.resultaat.vorigJaar ? `${jaar - 1}: ${formatCenten(r.wv.resultaat.vorigJaar)}` : r.wv.resultaat.jaar >= 0 ? 'winst vóór belasting' : 'verlies'}</span>
          </div>
          <div className="bh-saldo">
            <span className="bh-saldo-naam">Balanstotaal</span>
            <span className="bh-saldo-bedrag">{formatCenten(r.balansEind.totaalActiva)}</span>
            <span className="bh-saldo-sub">per {korteDatum(r.balansEind.datum)}{r.balansEind.verschil === 0 ? ' · sluit' : ''}</span>
          </div>
        </section>

        <section className={`bh-kaart bh-rap-status${st.afgesloten ? ' is-dicht' : ''}`} aria-labelledby="bh-rap-status">
          <div className="bh-rap-status-tekst">
            <p className="bh-label">Jaarafsluiting</p>
            <h2 id="bh-rap-status" className="bh-kaart-titel">
              Boekjaar {jaar}{' '}
              {st.afgesloten ? (
                <span className="bh-pil is-koppel">afgesloten</span>
              ) : r.lopend ? (
                <span className="bh-pil is-zacht">loopt nog</span>
              ) : openBlokkades.length ? (
                <span className="bh-pil is-let-op">nog {openBlokkades.length} {openBlokkades.length === 1 ? 'punt' : 'punten'}</span>
              ) : (
                <span className="bh-pil is-koppel">klaar om af te sluiten</span>
              )}
            </h2>
            <p className="bh-kaart-sub">
              {st.afgesloten && bj
                ? `Afgesloten op ${langeDatum(bj.afgeslotenOp.slice(0, 10))}: het resultaat en de privé-opnamen staan op de kapitaalrekeningen en het jaar is vergrendeld.`
                : r.lopend
                  ? `Na 31 december sluit je het jaar af: de checklist controleert btw-aangiften, bankregels en banksaldi, daarna gaat het resultaat naar de vennoten.`
                  : openBlokkades.length
                    ? openBlokkades.map((c) => c.titel).join(' · ')
                    : 'Alle controles zijn in orde. Vul de banksaldi per 31 december in en sluit het jaar af.'}
            </p>
          </div>
          <Link className={`db-knop${!st.afgesloten && !r.lopend ? ' db-knop-primair' : ''}`} href={`/boekhouding/rapporten/jaarafsluiting/${jaar}`}>
            {st.afgesloten ? 'Bekijk afsluiting' : 'Naar de jaarafsluiting'}
          </Link>
        </section>

        <div className="bh-rap-grid">
          <section className="bh-kaart bh-rap-kaart" aria-label="Rapport">
            <nav className="bh-rek-tabs" aria-label="Rapport">
              {RAPPORTEN.map((x) => (
                <Link key={x.id} href={href({ r: x.id })} className={`bh-rek-tab${x.id === rapport ? ' is-aan' : ''}`} aria-current={x.id === rapport ? 'page' : undefined}>
                  {x.label}
                </Link>
              ))}
            </nav>
            {rapport === 'wv' && <WinstVerlies r={r} href={(code) => href({ r: 'grootboek', code })} />}
            {rapport === 'balans' && <BalansView r={r} href={(code) => href({ r: 'grootboek', code })} />}
            {rapport === 'vennoten' && <Vennoten r={r} />}
            {rapport === 'proef' && <Proef posten={posten} data={data} jaar={jaar} tot={r.tot} href={(code) => href({ r: 'grootboek', code })} />}
            {rapport === 'grootboek' && <Kaart posten={posten} data={data} jaar={jaar} tot={r.tot} code={een(sp.code)} />}
          </section>

          <aside className="bh-kaart bh-rap-zij" aria-labelledby="bh-rap-export">
            <header className="bh-kaart-kop">
              <h2 id="bh-rap-export" className="bh-kaart-titel">
                Voor de boekhouder
              </h2>
              <p className="bh-kaart-sub">Exports van {jaar}{repo.modus === 'demo' ? ' (demo: voorbeeldgegevens)' : ''}.</p>
            </header>
            <ul className="bh-rap-exports">
              {[
                ['pdf', 'Jaarrapport', 'PDF · W&V, balans, kapitaal, activa'],
                ['xaf', 'Auditfile', 'XAF 3.2 · voor boekhoudpakketten'],
                ['boekingen', 'Bankregels', 'CSV · met btw, kwartaal en categorie'],
                ['journaal', 'Journaal', 'CSV · alle mutaties debet/credit'],
                ['wv', 'Winst & verlies', 'CSV · per kwartaal'],
                ['balans', 'Balans', 'CSV · begin en eind'],
                ['proefbalans', 'Proefbalans', 'CSV · per rekening'],
                ['vennoten', 'Kapitaal vennoten', 'CSV · winstverdeling']
              ].map(([soort, titel, sub]) => (
                <li key={soort}>
                  <a className="bh-rap-export" href={`/api/boekhouding/export?soort=${soort}&jaar=${jaar}`} download>
                    <span className="bh-rap-export-titel">{titel}</span>
                    <span className="bh-rap-export-sub">{sub}</span>
                    <span aria-hidden="true" className="bh-rap-export-pijl">↓</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="bh-kaart-sub">De btw-aangifte per kwartaal staat als PDF bij <Link href="/boekhouding/btw">Btw-aangifte</Link>. Bonnetjes staan als kopie in Drive.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
type Rapport = ReturnType<typeof jaarrapport>;

function WinstVerlies({ r, href }: { r: Rapport; href: (code: string) => string }) {
  const rij = (x: WVBedragen) => (
    <>
      {x.kwartalen.map((k, i) => (
        <td key={i} className="bh-r bh-rt-kw">
          {b(k)}
        </td>
      ))}
      <td className="bh-r bh-rt-jaar">{b(x.jaar)}</td>
      <td className="bh-r bh-rt-vorig">{b(x.vorigJaar)}</td>
    </>
  );
  if (!r.wv.groepen.length) return <p className="bh-leeg">Nog geen opbrengsten of kosten in {r.jaar}.</p>;
  return (
    <div className="bh-rt-wrap">
      <table className="bh-rt">
        <thead>
          <tr>
            <th>Rekening</th>
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
              <th key={q} className="bh-r bh-rt-kw">
                {q}
              </th>
            ))}
            <th className="bh-r bh-rt-jaar">{r.jaar}</th>
            <th className="bh-r bh-rt-vorig">{r.jaar - 1}</th>
          </tr>
        </thead>
        {r.wv.groepen.map((g) => (
          <tbody key={g.id}>
            <tr className="bh-rt-groep">
              <th colSpan={7} scope="rowgroup">
                {g.titel}
              </th>
            </tr>
            {g.regels.map((x) => (
              <tr key={x.code}>
                <td>
                  <Link href={href(x.code)} className="bh-rt-link">
                    <span className="bh-rt-code">{x.code}</span> {x.naam}
                  </Link>
                </td>
                {rij(x)}
              </tr>
            ))}
            <tr className="bh-rt-tot">
              <td>Totaal {g.titel.toLowerCase()}</td>
              {rij(g)}
            </tr>
          </tbody>
        ))}
        <tbody>
          <tr className="bh-rt-groot">
            <td>{r.wv.resultaat.jaar >= 0 ? 'Winst' : 'Verlies'}</td>
            {rij(r.wv.resultaat)}
          </tr>
        </tbody>
      </table>
      <p className="bh-kaart-sub">
        Exclusief btw. Factuurstelsel: omzet en kosten vallen in de periode van de factuur- of bondatum.{r.lopend ? ` Het lopende jaar telt tot en met vandaag.` : ''} Klik op een rekening voor de mutaties.
      </p>
    </div>
  );
}

function BalansZijde({ titel, eind, begin, totaal, totaalBegin, href }: { titel: string; eind: BalansGroep[]; begin: BalansGroep[]; totaal: Centen; totaalBegin: Centen; href: (code: string) => string }) {
  const ids = [...new Set([...begin.map((g) => g.id), ...eind.map((g) => g.id)])];
  return (
    <table className="bh-rt bh-rt-balans">
      <thead>
        <tr>
          <th>{titel}</th>
          <th className="bh-r bh-rt-vorig">begin</th>
          <th className="bh-r">eind</th>
        </tr>
      </thead>
      {ids.map((id) => {
        const ge = eind.find((g) => g.id === id);
        const gb = begin.find((g) => g.id === id);
        const namen = new Map<string, string | null>();
        for (const x of [...(gb?.regels ?? []), ...(ge?.regels ?? [])]) namen.set(x.naam, x.code);
        return (
          <tbody key={id}>
            <tr className="bh-rt-groep">
              <th colSpan={3} scope="rowgroup">
                {(ge ?? gb)!.titel}
              </th>
            </tr>
            {[...namen].map(([naam, code]) => (
              <tr key={naam}>
                <td>
                  {code ? (
                    <Link href={href(code)} className="bh-rt-link">
                      <span className="bh-rt-code">{code}</span> {naam}
                    </Link>
                  ) : (
                    naam
                  )}
                </td>
                <td className="bh-r bh-rt-vorig">{b(gb?.regels.find((x) => x.naam === naam)?.bedrag ?? 0)}</td>
                <td className="bh-r">{b(ge?.regels.find((x) => x.naam === naam)?.bedrag ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        );
      })}
      <tbody>
        <tr className="bh-rt-groot">
          <td>Totaal</td>
          <td className="bh-r bh-rt-vorig">{formatBedrag(totaalBegin)}</td>
          <td className="bh-r">{formatBedrag(totaal)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BalansView({ r, href }: { r: Rapport; href: (code: string) => string }) {
  const e = r.balansEind;
  const s = r.balansBegin;
  return (
    <div className="bh-rt-wrap">
      <p className="bh-kaart-sub">
        Begin: {korteDatum(s.datum)} · eind: {korteDatum(e.datum)}
        {r.lopend ? ' (vandaag)' : ''}.{' '}
        {e.verschil === 0 ? <span className="is-bij">De balans sluit: activa = passiva.</span> : <span className="bh-demo-fout">Verschil {formatCenten(e.verschil)}.</span>}
      </p>
      <div className="bh-rap-balans">
        <BalansZijde titel="Activa" eind={e.activa} begin={s.activa} totaal={e.totaalActiva} totaalBegin={s.totaalActiva} href={href} />
        <BalansZijde titel="Passiva" eind={e.passiva} begin={s.passiva} totaal={e.totaalPassiva} totaalBegin={s.totaalPassiva} href={href} />
      </div>
      <p className="bh-kaart-sub">Btw staat per saldo op één regel. Het resultaat van het boekjaar staat in het eigen vermogen tot de jaarafsluiting het naar de vennoten verdeelt.</p>
    </div>
  );
}

function Vennoten({ r }: { r: Rapport }) {
  const k = r.kapitaal;
  const regels: { label: string; waarde: (x: (typeof k.regels)[number]) => Centen; sterk?: boolean; min?: boolean }[] = [
    { label: `Kapitaal 1 januari ${r.jaar}`, waarde: (x) => x.begin },
    { label: 'Inbreng / correcties', waarde: (x) => x.inbreng },
    { label: `Winstaandeel ${r.jaar}`, waarde: (x) => x.winstaandeel, sterk: true },
    { label: 'Stortingen en voorgeschoten kosten', waarde: (x) => x.stortingen },
    { label: 'Privé-opnamen', waarde: (x) => -x.opnamen, min: true },
    { label: `Kapitaal ${r.lopend ? 'nu' : `31 december ${r.jaar}`}`, waarde: (x) => x.eind, sterk: true }
  ];
  if (!k.regels.length) return <p className="bh-leeg">Geen vennoten ingesteld.</p>;
  return (
    <div className="bh-rt-wrap">
      <p className="bh-kaart-sub">
        Resultaat {r.jaar}: <strong>{formatCenten(k.resultaat)}</strong>, verdeeld naar winstaandeel ({k.regels.map((x) => `${x.naam} ${x.aandeel}%`).join(' · ')}). Het winstaandeel is de basis voor de
        inkomstenbelasting van elke vennoot.
      </p>
      <table className="bh-rt bh-rt-vennoten">
        <thead>
          <tr>
            <th></th>
            {k.regels.map((x) => (
              <th key={x.vennootId} className="bh-r">
                {x.naam}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {regels.map((g) => (
            <tr key={g.label} className={g.sterk ? 'bh-rt-tot' : undefined}>
              <td>{g.label}</td>
              {k.regels.map((x) => (
                <td key={x.vennootId} className="bh-r">
                  {g.sterk ? formatBedrag(g.waarde(x)) : b(g.waarde(x))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {r.afgesloten ? (
        <p className="bh-kaart-sub">Afgesloten: het winstaandeel en de privé-opnamen staan op de kapitaalrekeningen.</p>
      ) : (
        <p className="bh-kaart-sub">Zolang het jaar niet is afgesloten, is dit de verdeling zoals die bij de afsluiting wordt geboekt.</p>
      )}
      {k.onverdeeld !== 0 && (
        <p className="bh-kaart-sub">
          Nog niet aan een vennoot toegerekend: {formatCenten(k.onverdeeld)} (beginvermogen op 0900). Verdeel het met een memoriaalpost bij{' '}
          <Link href="/boekhouding/instellingen#memoriaal">Instellingen</Link>.
        </p>
      )}
    </div>
  );
}

function Proef({ posten, data, jaar, tot, href }: { posten: JournaalPost[]; data: Awaited<ReturnType<typeof laadAlles>>; jaar: number; tot: string; href: (code: string) => string }) {
  const p = proefbalansRapport(posten, data.stam.grootboek, jaarBegin(jaar), tot);
  return (
    <div className="bh-rt-wrap">
      <table className="bh-rt bh-rt-proef">
        <thead>
          <tr>
            <th>Rekening</th>
            <th className="bh-r bh-rt-kw">1 jan</th>
            <th className="bh-r bh-rt-kw">Debet</th>
            <th className="bh-r bh-rt-kw">Credit</th>
            <th className="bh-r">Saldo {korteDatum(tot, false)}</th>
          </tr>
        </thead>
        <tbody>
          {p.regels.map((x) => (
            <tr key={x.code}>
              <td>
                <Link href={href(x.code)} className="bh-rt-link">
                  <span className="bh-rt-code">{x.code}</span> {x.naam}
                </Link>
              </td>
              <td className="bh-r bh-rt-kw">{b(x.begin)}</td>
              <td className="bh-r bh-rt-kw">{b(x.debet)}</td>
              <td className="bh-r bh-rt-kw">{b(x.credit)}</td>
              <td className="bh-r">{b(x.eind)}</td>
            </tr>
          ))}
          <tr className="bh-rt-groot">
            <td>Totaal</td>
            <td className="bh-r bh-rt-kw">{formatBedrag(p.totaal.begin)}</td>
            <td className="bh-r bh-rt-kw">{formatBedrag(p.totaal.debet)}</td>
            <td className="bh-r bh-rt-kw">{formatBedrag(p.totaal.credit)}</td>
            <td className="bh-r">{formatBedrag(p.totaal.eind)}</td>
          </tr>
        </tbody>
      </table>
      <p className="bh-kaart-sub">
        Saldo = debet − credit (positief = debetsaldo). {p.totaal.debet === p.totaal.credit && p.totaal.eind === 0 ? <span className="is-bij">Debet en credit zijn gelijk.</span> : null}
      </p>
    </div>
  );
}

function Kaart({ posten, data, jaar, tot, code }: { posten: JournaalPost[]; data: Awaited<ReturnType<typeof laadAlles>>; jaar: number; tot: string; code: string }) {
  const gebruikt = new Set(posten.flatMap((p) => p.regels.map((r) => r.grootboek)));
  const rekeningen = data.stam.grootboek.filter((g) => gebruikt.has(g.code));
  const gekozen = rekeningen.some((g) => g.code === code) ? code : (rekeningen.find((g) => g.code === data.stam.rekeningen.find((r) => r.standaard)?.grootboek) ?? rekeningen[0])?.code;
  if (!gekozen) return <p className="bh-leeg">Nog geen boekingen.</p>;
  const k = grootboekkaart(posten, data.stam.grootboek, gekozen, jaarBegin(jaar), tot);
  return (
    <div className="bh-rt-wrap">
      <form className="bh-rap-kies" method="get" action="/boekhouding/rapporten">
        <input type="hidden" name="r" value="grootboek" />
        <input type="hidden" name="jaar" value={jaar} />
        <label className="bh-sr" htmlFor="bh-rap-code">
          Rekening
        </label>
        <select id="bh-rap-code" name="code" className="ag-veld" defaultValue={gekozen}>
          {rekeningen.map((g) => (
            <option key={g.code} value={g.code}>
              {g.code} · {g.naam}
            </option>
          ))}
        </select>
        <button type="submit" className="db-knop">
          Toon
        </button>
      </form>
      <table className="bh-rt bh-rt-kaart">
        <thead>
          <tr>
            <th className="bh-rt-datum">Datum</th>
            <th>Omschrijving</th>
            <th className="bh-r bh-rt-kw">Debet</th>
            <th className="bh-r bh-rt-kw">Credit</th>
            <th className="bh-r">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bh-rt-groep">
            <td className="bh-rt-datum">{korteDatum(jaarBegin(jaar))}</td>
            <td>Beginsaldo</td>
            <td className="bh-rt-kw" />
            <td className="bh-rt-kw" />
            <td className="bh-r">{formatBedrag(k.begin)}</td>
          </tr>
          {k.regels.map((x) => {
            const h = bronHref(x.bron, x.bronId);
            return (
              <tr key={x.postId}>
                <td className="bh-rt-datum">{korteDatum(x.datum)}</td>
                <td>
                  <span className="bh-rt-bron">{BRON_LABEL[x.bron]}</span>{' '}
                  {h ? (
                    <Link href={h} className="bh-rt-link">
                      {x.omschrijving}
                    </Link>
                  ) : (
                    x.omschrijving
                  )}
                </td>
                <td className="bh-r bh-rt-kw">{b(x.debet)}</td>
                <td className="bh-r bh-rt-kw">{b(x.credit)}</td>
                <td className="bh-r">{formatBedrag(x.saldo)}</td>
              </tr>
            );
          })}
          <tr className="bh-rt-groot">
            <td className="bh-rt-datum">{korteDatum(tot)}</td>
            <td>Eindsaldo · {k.regels.length} mutaties</td>
            <td className="bh-r bh-rt-kw">{formatBedrag(k.debet)}</td>
            <td className="bh-r bh-rt-kw">{formatBedrag(k.credit)}</td>
            <td className="bh-r">{formatBedrag(k.eind)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
