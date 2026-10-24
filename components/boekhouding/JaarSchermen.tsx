import 'server-only';
import Link from 'next/link';
import { BoekhoudingKop } from './BoekhoudingKop';
import { Demo } from './Schermen';
import { JaarafsluitingApp } from './JaarafsluitingApp';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { jaarVan, korteDatum, langeDatum, vandaagNL } from '@/lib/boekhouding/kern/periode';
import { rekeningInfo, resultaatVan } from '@/lib/boekhouding/kern/rapporten';
import { factuurPosten, uitgavePosten } from '@/lib/boekhouding/kern/afletteren';
import { kwartaalOverzicht, volgendeAangifte } from '@/lib/boekhouding/kern/aangifte';
import { activastaat } from '@/lib/boekhouding/kern/afschrijving';
import { saldoPerRekening } from '@/lib/boekhouding/model';
import { administratieStart, afsluitStatus, rapportTot } from '@/lib/boekhouding/jaarwerk';
import { journaalVan, laadAlles, type BoekhoudRepo } from '@/lib/boekhouding/repo/types';
import { administratieBegin, vanafStart } from '@/lib/boekhouding/kern/journaal';

// De jaarafsluiting van één boekjaar en de kerncijfers op het Overzicht.

export async function JaarafsluitingScherm({ repo, jaar, eigenaar, demoReden }: { repo: BoekhoudRepo; jaar: number; eigenaar: boolean; demoReden: 'env' | 'migratie' }) {
  const data = await laadAlles(repo);
  const vandaag = vandaagNL();
  const posten = journaalVan(data);
  const st = afsluitStatus(data, posten, jaar, vandaag, {});
  const bj = data.boekjaren.find((x) => x.jaar === jaar) ?? null;
  const info = rekeningInfo(data.stam.grootboek);
  // Afgesloten: de geboekte afsluitpost tonen (niet een nieuwe berekening).
  const geboekt = bj?.memoriaalId ? data.memoriaal.find((m) => m.id === bj.memoriaalId) : null;
  const regels = (geboekt?.regels ?? st.voorstel?.regels ?? []).map((r) => ({ grootboek: r.grootboek, naam: info(r.grootboek).naam, debet: r.debet, credit: r.credit, omschrijving: r.omschrijving ?? null }));
  const samenvatting = (bj?.samenvatting ?? {}) as { resultaat?: number; verdeling?: { vennoot: string; aandeel: number; winst: number; prive: number }[] };
  const vennootId = new Map(data.stam.vennoten.map((v) => [v.naam, v.id]));
  return (
    <div className="bh">
      <BoekhoudingKop titel={`Jaarafsluiting ${jaar}`} />
      <Demo repo={repo} reden={demoReden} />
      <JaarafsluitingApp
        v={{
          jaar,
          afgesloten: st.afgesloten,
          afgeslotenOp: bj ? langeDatum(bj.afgeslotenOp.slice(0, 10)) : null,
          eigenaar,
          demo: repo.modus === 'demo',
          controles: st.controles.filter((c) => c.id !== 'bank'),
          banksaldi: st.banksaldi.map((s) => ({ rekeningId: s.rekeningId, naam: s.naam, berekend: s.berekend, opgegeven: null })),
          resultaat: st.afgesloten && typeof samenvatting.resultaat === 'number' ? samenvatting.resultaat : st.voorstel?.resultaat ?? null,
          resultaatEerder: st.afgesloten ? 0 : st.voorstel?.resultaatEerder ?? 0,
          verdeling:
            st.afgesloten && samenvatting.verdeling
              ? samenvatting.verdeling.map((x) => ({ vennootId: vennootId.get(x.vennoot) ?? x.vennoot, naam: x.vennoot, aandeel: x.aandeel, bedrag: x.winst, prive: x.prive }))
              : st.voorstel?.verdeling ?? [],
          regels,
          fout: st.afgesloten ? null : st.fout
        }}
      />
    </div>
  );
}

/** De cijfers voor het Overzicht (gewone data, zodat de pagina een storing kan opvangen). */
export async function overzichtData(repo: BoekhoudRepo) {
  const data = await laadAlles(repo);
  const vandaag = vandaagNL();
  const jaar = jaarVan(vandaag);
  const posten = journaalVan(data);
  const saldi = saldoPerRekening(data.boekingen, data.stam.rekeningen);
  const rekeningen = data.stam.rekeningen.filter((r) => r.actief).map((r) => ({ naam: r.naam, saldo: saldi.get(r.id) ?? 0 }));
  const rijen = kwartaalOverzicht({ posten, aangiften: data.aangiften, betalingen: data.aangifteBetalingen, vanaf: administratieStart(data, vandaag), vandaag });
  const btw = volgendeAangifte(rijen);
  const start = administratieBegin(data.stam);
  const deb = factuurPosten(vanafStart(data.facturen, start), data.koppelingen, vandaag).filter((p) => p.open > 0);
  const cred = uitgavePosten(vanafStart(data.uitgaven, start), data.koppelingen, vandaag).filter((p) => p.open > 0);
  return {
    jaar,
    rekeningen,
    totaal: rekeningen.reduce((t, r) => t + r.saldo, 0),
    resultaat: resultaatVan(posten, data.stam.grootboek, jaar, rapportTot(jaar, vandaag)),
    btw: btw ? { jaar: btw.jaar, kwartaal: btw.kwartaal, teBetalen: btw.teBetalen, status: btw.status, deadline: btw.deadline } : null,
    teVerwerken: data.boekingen.filter((b) => b.status === 'te_verwerken').length,
    debAantal: deb.length,
    debOpen: deb.reduce((t, p) => t + p.open, 0),
    vervallen: deb.filter((p) => p.vervallen).length,
    credAantal: cred.length,
    afschrijving: activastaat(data.activa, jaar).totaal.afschrijving,
    vorigJaarOpen: jaar - 1 >= jaarVan(administratieStart(data, vandaag)) && !data.stam.vergrendeling.boekjaren.includes(jaar - 1)
  };
}
export type OverzichtData = Awaited<ReturnType<typeof overzichtData>>;

/**
 * De cijferrij boven de tegels op het Overzicht: saldo per bank, resultaat dit jaar, de
 * volgende btw-aangifte, openstaande posten en wat er nog te doen is.
 */
export function OverzichtCijfers({ d }: { d: OverzichtData }) {
  const { jaar, btw } = d;
  return (
    <section className="bh-overzicht" aria-label="Kerncijfers boekhouding">
      <div className="bh-saldi">
        <Link className="bh-saldo" href="/boekhouding/bank">
          <span className="bh-saldo-naam">Op de bank</span>
          <span className="bh-saldo-bedrag">{formatCenten(d.totaal)}</span>
          <span className="bh-saldo-sub">{d.rekeningen.map((r) => `${r.naam} ${formatCenten(r.saldo)}`).join(' · ')}</span>
        </Link>
        <Link className="bh-saldo" href={`/boekhouding/rapporten?jaar=${jaar}`}>
          <span className="bh-saldo-naam">Resultaat {jaar}</span>
          <span className={`bh-saldo-bedrag${d.resultaat < 0 ? ' is-let-op' : ''}`}>{formatCenten(d.resultaat)}</span>
          <span className="bh-saldo-sub">tot nu toe · excl. btw · afschrijving {formatCenten(d.afschrijving)}/jaar</span>
        </Link>
        {btw ? (
          <Link className="bh-saldo" href={`/boekhouding/btw/${btw.jaar}/${btw.kwartaal}`}>
            <span className="bh-saldo-naam">
              Btw Q{btw.kwartaal} {btw.jaar}
            </span>
            <span className={`bh-saldo-bedrag${btw.status === 'te_laat' ? ' is-let-op' : ''}`}>{formatCenten(Math.abs(btw.teBetalen))}</span>
            <span className="bh-saldo-sub">
              {btw.teBetalen < 0 ? 'terug' : 'te betalen'}
              {btw.status === 'lopend' ? ' (tot nu toe)' : ''} · uiterlijk {korteDatum(btw.deadline)}
            </span>
          </Link>
        ) : (
          <Link className="bh-saldo" href="/boekhouding/btw">
            <span className="bh-saldo-naam">Btw</span>
            <span className="bh-saldo-bedrag">—</span>
            <span className="bh-saldo-sub">alles ingediend</span>
          </Link>
        )}
        <Link className="bh-saldo" href="/boekhouding/openstaand">
          <span className="bh-saldo-naam">Te ontvangen</span>
          <span className={`bh-saldo-bedrag${d.vervallen ? ' is-let-op' : ''}`}>{formatCenten(d.debOpen)}</span>
          <span className="bh-saldo-sub">
            {d.debAantal} {d.debAantal === 1 ? 'factuur' : 'facturen'}
            {d.vervallen ? ` · ${d.vervallen} over de termijn` : ''} · {d.credAantal} te betalen
          </span>
        </Link>
      </div>
      {(d.teVerwerken > 0 || d.vorigJaarOpen) && (
        <ul className="bh-overzicht-taken">
          {d.teVerwerken > 0 && (
            <li>
              <Link href="/boekhouding/bank?jaar=alle&status=te_verwerken">
                <span className="bh-stip" aria-hidden="true" /> {d.teVerwerken} {d.teVerwerken === 1 ? 'bankregel' : 'bankregels'} te verwerken
              </Link>
            </li>
          )}
          {d.vorigJaarOpen && (
            <li>
              <Link href={`/boekhouding/rapporten/jaarafsluiting/${jaar - 1}`}>
                <span className="bh-stip" aria-hidden="true" /> Boekjaar {jaar - 1} afsluiten
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
